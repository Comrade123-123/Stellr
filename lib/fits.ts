/**
 * Just enough FITS to read a TESS or Kepler light-curve file on the server: walks the
 * header-data units, finds the first binary table, and pulls named columns out of it.
 * FITS is big-endian, in 2880-byte blocks, with 80-character header cards.
 * Spec: https://fits.gsfc.nasa.gov/fits_standard.html
 */

const BLOCK = 2880;
const CARD = 80;

type Header = Map<string, string | number>;

function readHeader(bytes: Uint8Array, start: number): { header: Header; end: number } {
  const header: Header = new Map();
  const text = new TextDecoder("ascii");
  for (let at = start; at + CARD <= bytes.length; at += CARD) {
    const card = text.decode(bytes.subarray(at, at + CARD));
    const key = card.slice(0, 8).trim();
    if (key === "END") return { header, end: Math.ceil((at + CARD) / BLOCK) * BLOCK };
    if (card[8] !== "=") continue;
    let raw = card.slice(10);
    // Strings are quoted (with '' for a quote); anything else ends at a comment slash.
    if (raw.trimStart().startsWith("'")) {
      const m = raw.match(/'((?:[^']|'')*)'/);
      header.set(key, (m?.[1] ?? "").replace(/''/g, "'").trim());
    } else {
      raw = raw.split("/")[0].trim();
      const n = Number(raw.replace(/D/i, "E"));
      header.set(key, Number.isFinite(n) && raw !== "" ? n : raw);
    }
  }
  throw new Error("FITS: header has no END");
}

const num = (h: Header, k: string) => {
  const v = h.get(k);
  return typeof v === "number" ? v : 0;
};

/** Bytes per element for each binary-table type code. */
const SIZES: Record<string, number> = { L: 1, X: 1, B: 1, I: 2, J: 4, K: 8, A: 1, E: 4, D: 8, C: 8, M: 16 };

/**
 * The named numeric columns (first element of each) of the first binary table in the file,
 * as Float64Arrays, plus that table's header.
 */
export function readTable(buffer: ArrayBuffer, names: string[]) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let at = 0;
  while (at < bytes.length) {
    const { header, end } = readHeader(bytes, at);
    const naxis = num(header, "NAXIS");
    let size = naxis > 0 ? Math.abs(num(header, "BITPIX")) / 8 : 0;
    for (let i = 1; i <= naxis; i++) size *= num(header, `NAXIS${i}`);
    size += num(header, "PCOUNT");
    if (header.get("XTENSION") === "BINTABLE") {
      const rowBytes = num(header, "NAXIS1");
      const rows = num(header, "NAXIS2");
      const fields = num(header, "TFIELDS");
      const columns = new Map<string, { offset: number; type: string }>();
      let offset = 0;
      for (let i = 1; i <= fields; i++) {
        const form = String(header.get(`TFORM${i}`) ?? "");
        const m = form.match(/^(\d*)([LXBIJKAEDCMPQ])/);
        if (!m) throw new Error(`FITS: unknown column format ${form}`);
        const repeat = m[1] === "" ? 1 : Number(m[1]);
        const type = m[2];
        const width = type === "X" ? Math.ceil(repeat / 8) : type === "P" ? 8 : type === "Q" ? 16 : repeat * SIZES[type];
        columns.set(String(header.get(`TTYPE${i}`) ?? "").trim().toUpperCase(), { offset, type });
        offset += width;
      }
      const out: Record<string, Float64Array> = {};
      for (const name of names) {
        const col = columns.get(name.toUpperCase());
        if (!col) throw new Error(`FITS: no ${name} column`);
        const values = new Float64Array(rows);
        for (let r = 0; r < rows; r++) {
          const p = end + r * rowBytes + col.offset;
          switch (col.type) {
            case "D":
              values[r] = view.getFloat64(p, false);
              break;
            case "E":
              values[r] = view.getFloat32(p, false);
              break;
            case "J":
              values[r] = view.getInt32(p, false);
              break;
            case "I":
              values[r] = view.getInt16(p, false);
              break;
            case "K":
              values[r] = Number(view.getBigInt64(p, false));
              break;
            case "B":
              values[r] = view.getUint8(p);
              break;
            default:
              values[r] = NaN;
          }
        }
        out[name] = values;
      }
      return { header, columns: out };
    }
    at = end + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error("FITS: no binary table");
}
