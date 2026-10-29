import Link from "next/link";
import ScrambleText from "@/components/ui/ScrambleText";

/** A plain reading page for Stellr's privacy policy and terms. */
export default function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: [string, React.ReactNode][] }) {
  return (
    <main className="relative min-h-svh bg-void px-5 pb-24 pt-8 text-ink sm:px-8 lg:px-12">
      <article className="mx-auto max-w-[760px]">
        <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
          <ScrambleText text="← STELLR" />
        </Link>
        <h1 className="display mt-8 text-[clamp(2rem,4.4vw,4rem)] text-ink">{title}</h1>
        <p className="mt-3 font-mono text-[10px] tracking-[0.2em] text-ink/45">LAST UPDATED {updated}</p>
        {sections.map(([heading, body]) => (
          <section key={heading} className="mt-10">
            <h2 className="font-mono text-[11px] tracking-[0.22em] text-gold">{heading}</h2>
            <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink/75">{body}</div>
          </section>
        ))}
      </article>
    </main>
  );
}
