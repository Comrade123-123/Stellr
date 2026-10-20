/** Turion-style section marker: ■ 03 ■ LIVE TOOLS, split across the row. */
export default function IndexBar({ index, label, className = "" }: { index: string; label: string; className?: string }) {
  return (
    <div className={`reveal-fade grid grid-cols-2 font-mono text-[11px] tracking-[0.2em] text-ink/60 ${className}`}>
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
