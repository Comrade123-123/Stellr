/**
 * Turion-style section marker: ■ 03 ■ LIVE TOOLS. Split across the row above left-aligned
 * copy; `centered` keeps the pair together over centred copy.
 */
export default function IndexBar({
  index,
  label,
  className = "",
  centered = false,
}: {
  index: string;
  label: string;
  className?: string;
  centered?: boolean;
}) {
  return (
    <div
      className={`reveal-fade font-mono text-[11px] tracking-[0.2em] text-ink/60 ${
        centered ? "flex items-center justify-center gap-10" : "grid grid-cols-2"
      } ${className}`}
    >
      <span className="flex items-center gap-3">
        <span className="block h-[7px] w-[7px] bg-gold" />
        {index}
      </span>
      <span className="flex items-center gap-3">
        <span className="block h-[7px] w-[7px] bg-ink/70" />
        {label}
      </span>
    </div>
  );
}
