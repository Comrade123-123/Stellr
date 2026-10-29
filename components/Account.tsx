"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ScrambleText from "@/components/ui/ScrambleText";

interface Me {
  name: string;
  email: string;
  picture: string;
  joined: string;
}

const ERRORS: Record<string, string> = {
  cancelled: "SIGN-IN WAS CANCELLED.",
  expired: "THAT SIGN-IN TOOK TOO LONG OR CAME FROM ANOTHER TAB. TRY AGAIN.",
  google: "GOOGLE DIDN'T CONFIRM THE ACCOUNT. TRY AGAIN.",
  off: "SIGN-IN ISN'T SWITCHED ON YET.",
};

const TOOLS: [string, string][] = [
  ["COSMOSCOPE", "/cosmoscope"],
  ["EXOPLANET LAB", "/exoplanet-lab"],
  ["ORBIT WATCH", "/orbit-watch"],
  ["ASTEROID SENTINEL", "/asteroid-sentinel"],
  ["SKY EVENTS", "/sky-events"],
  ["SPACE WEATHER", "/space-weather"],
];

const SAVED_KEY = "stellr.exoplanet-lab.investigations";

const since = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="h-5 w-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Sign in with Google, and once in: who you are, what's saved, sign out or delete the account. */
export default function Account() {
  const [state, setState] = useState<"checking" | "off" | "out" | "in" | "error">("checking");
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("error");
    // The error and saved count live in the URL and localStorage, which only exist after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code) setError(ERRORS[code] ?? ERRORS.google);
    try {
      const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
      setSaved(Array.isArray(list) ? list.length : 0);
    } catch {
      // Storage blocked; nothing to count.
    }
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ enabled: boolean; user: Me | null; error?: string }>)
      .then((d) => {
        if (!d.enabled) return setState("off");
        if (d.error) return setState("error");
        setMe(d.user);
        setState(d.user ? "in" : "out");
      })
      .catch(() => setState("error"));
  }, []);

  const signOut = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
    setState("out");
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    const res = await fetch("/api/auth/me", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("COULDN'T DELETE THE ACCOUNT. TRY AGAIN.");
    setMe(null);
    setConfirming(false);
    setError("");
    setState("out");
  };

  return (
    <main className="relative min-h-svh bg-void px-5 pb-24 pt-8 text-ink sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[880px]">
        <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
          <ScrambleText text="← STELLR" />
        </Link>
        <h1 className="display mt-8 text-[clamp(2rem,4.4vw,4rem)] text-ink">{state === "in" ? "Your Stellr" : "Sign in"}</h1>

        {state !== "in" && (
          <section className="frame mt-10 max-w-[480px] bg-void/70 p-6">
            <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">STELLR ACCOUNT</p>
            {state === "checking" ? (
              <p className="mt-4 font-mono text-[11px] tracking-[0.16em] text-ink/55">CHECKING…</p>
            ) : state === "off" ? (
              <p className="caps mt-4 text-[12px] leading-relaxed text-ink/65">Sign-in isn&apos;t switched on yet. Every tool works without an account.</p>
            ) : state === "error" ? (
              <p className="caps mt-4 text-[12px] leading-relaxed text-ink/65">Couldn&apos;t reach accounts just now. Try again shortly.</p>
            ) : (
              <>
                <p className="caps mt-4 text-[12px] leading-relaxed text-ink/65">
                  Every tool is free and works without an account. Sign in to keep a Stellr profile.
                </p>
                <a
                  id="google-sign-in"
                  href="/api/auth/google?next=/account"
                  className="mt-6 flex h-12 items-center justify-center gap-3 rounded-full bg-ink px-6 text-[13px] font-semibold tracking-[0.04em] text-void transition-colors hover:bg-gold"
                >
                  <GoogleMark />
                  Continue with Google
                </a>
                <p className="mt-4 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-ink/40">
                  STELLR KEEPS YOUR NAME, EMAIL AND PICTURE FROM GOOGLE, NOTHING ELSE. DELETE THE ACCOUNT ANY TIME.{" "}
                  <Link href="/privacy" className="text-ink/70 underline underline-offset-2 hover:text-gold">
                    PRIVACY
                  </Link>{" "}
                  ·{" "}
                  <Link href="/terms" className="text-ink/70 underline underline-offset-2 hover:text-gold">
                    TERMS
                  </Link>
                </p>
              </>
            )}
            <p className={`mt-4 font-mono text-[10px] tracking-[0.14em] text-gold ${error ? "" : "hidden"}`} role="alert">
              {error}
            </p>
          </section>
        )}

        {state === "in" && me && (
          <div className="mt-10 grid gap-6 md:grid-cols-[1fr_1fr]">
            <section className="frame bg-void/70 p-6 md:col-span-2">
              <div className="flex flex-wrap items-center gap-5">
                {me.picture ? (
                  // Google's avatar host; a plain img keeps it out of the image optimiser.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.picture} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full border border-ink/20" />
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border border-ink/25 font-mono text-xl text-gold">
                    {me.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <h2 className="display break-words text-2xl text-ink">{me.name}</h2>
                  <p className="mt-1 break-all font-mono text-[11px] tracking-[0.08em] text-ink/60">{me.email}</p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-ink/40">MEMBER SINCE {since(me.joined)}</p>
                </div>
              </div>
            </section>

            <section className="frame bg-void/70 p-6">
              <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">SAVED ON THIS DEVICE</p>
              <p className="mt-4 font-mono text-3xl text-ink">{saved}</p>
              <p className="caps mt-2 text-[11px] leading-relaxed text-ink/55">
                Exoplanet Lab investigation{saved === 1 ? "" : "s"}, kept in this browser.
              </p>
              <Link href="/exoplanet-lab" className="mt-4 inline-block font-mono text-[10px] tracking-[0.18em] text-ink/75 hover:text-gold">
                OPEN EXOPLANET LAB →
              </Link>
            </section>

            <section className="frame bg-void/70 p-6">
              <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">JUMP BACK IN</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {TOOLS.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className="block rounded-full border border-ink/25 px-3.5 py-1.5 font-mono text-[10px] tracking-[0.14em] text-ink/80 hover:border-gold hover:text-gold">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="md:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={signOut}
                  disabled={busy}
                  className="rounded-full border border-ink/30 px-5 py-2.5 font-mono text-[10px] tracking-[0.16em] text-ink/85 hover:border-ink/70 disabled:opacity-50"
                >
                  SIGN OUT
                </button>
                {confirming ? (
                  <>
                    <span className="font-mono text-[10px] tracking-[0.14em] text-ink/60">DELETE YOUR ACCOUNT FOR GOOD?</span>
                    <button
                      type="button"
                      onClick={remove}
                      disabled={busy}
                      className="rounded-full border border-red-400/60 px-5 py-2.5 font-mono text-[10px] tracking-[0.16em] text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                    >
                      YES, DELETE
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="px-2 font-mono text-[10px] tracking-[0.16em] text-ink/55 hover:text-ink">
                      KEEP IT
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirming(true)} className="px-2 font-mono text-[10px] tracking-[0.16em] text-ink/45 hover:text-red-300">
                    DELETE ACCOUNT
                  </button>
                )}
              </div>
              <p className={`mt-3 font-mono text-[10px] tracking-[0.14em] text-gold ${error ? "" : "hidden"}`} role="alert">
                {error}
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
