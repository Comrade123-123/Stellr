import Link from "next/link";
import ScrambleText from "@/components/ui/ScrambleText";

/** The two ways in from the landing page: the tools, or straight to Cosmoscope. */
export default function StartLinks({ toolsHref = "#tools" }: { toolsHref?: string }) {
  return (
    <div className="flex w-full max-w-[460px] flex-wrap justify-center gap-3">
      <a
        href={toolsHref}
        className="flex h-14 items-center rounded-full bg-ink px-7 text-[12px] font-semibold tracking-[0.08em] text-void transition-colors hover:bg-gold focus-visible:bg-gold focus-visible:outline-none"
      >
        <ScrambleText text="EXPLORE THE TOOLS" />
      </a>
      <Link
        href="/cosmoscope"
        className="flex h-14 items-center rounded-full border border-ink/40 px-7 text-[12px] font-semibold tracking-[0.08em] text-ink transition-colors hover:border-ink hover:bg-ink hover:text-void focus-visible:outline-none"
      >
        <ScrambleText text="OPEN COSMOSCOPE" />
      </Link>
    </div>
  );
}
