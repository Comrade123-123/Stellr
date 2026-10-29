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

const TOOLS: { name: string; href: string; line: string }[] = [
  { name: "COSMOSCOPE", href: "/cosmoscope", line: "Every planet, moon and spacecraft, where it really is." },
  { name: "EXOPLANET LAB", href: "/exoplanet-lab", line: "Search real TESS starlight for other worlds." },
  { name: "ORBIT WATCH", href: "/orbit-watch", line: "Satellites and the ISS, live, with passes overhead." },
  { name: "ASTEROID SENTINEL", href: "/asteroid-sentinel", line: "Near-Earth asteroids and their closest passes." },
  { name: "SKY EVENTS", href: "/sky-events", line: "Showers, eclipses, conjunctions and launches." },
  { name: "SPACE WEATHER", href: "/space-weather", line: "Flares, storms and aurora odds as they happen." },
];

const PERKS: [string, string][] = [
  ["01", "One profile, any device. Sign in wherever you open Stellr."],
  ["02", "Every tool one tap away from your own page."],
  ["03", "Leave whenever you like. One click deletes everything."],
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

/** The avatar inside a slowly turning orbit, with a gold moon riding it. */
function Avatar({ me, size = 112 }: { me: Me; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size + 40, height: size + 40 }}>
      <div className="orbit-spin absolute inset-0 rounded-full border border-dashed border-ink/20">
        <span className="absolute left-1/2 top-0 block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold shadow-[0_0_12px_rgb(201_164_106/0.9)]" />
      </div>
      <div className="absolute inset-[20px] overflow-hidden rounded-full border border-ink/25 bg-gradient-to-br from-ink/10 to-void shadow-[0_0_60px_rgb(201_164_106/0.18)]">
        {me.picture ? (
          // Google's avatar host; a plain img keeps it out of the image optimiser.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <span className="display flex h-full w-full items-center justify-center text-[2.6rem] text-gold">{me.name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
    </div>
  );
}

/** Sign in with Google, and once in: a profile, what's saved, the tools, sign out or delete the account. */
export default function Account() {
  const [state, setState] = useState<"checking" | "off" | "out" | "in" | "error">("checking");
  const [me, setMe] = useState<Me | null>(null);
  const [days, setDays] = useState(1);
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
        if (d.user) setDays(Math.max(1, Math.ceil((Date.now() - Date.parse(d.user.joined)) / 86_400_000)));
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

  const alert = (
    <p className={`mt-4 font-mono text-[10px] tracking-[0.14em] text-gold ${error ? "" : "hidden"}`} role="alert">
      {error}
    </p>
  );

  return (
    <main className="relative min-h-svh overflow-hidden bg-void text-ink">
      {/* Backdrop: stars, and a planet's lit rim rising from the bottom of the page. */}
      <div aria-hidden className="starfield pointer-events-none absolute inset-0 opacity-70" />
      {state === "in" ? (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[900px] max-w-full -translate-x-1/2 -translate-y-1/3 rounded-full bg-gold/10 blur-3xl" />
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[max(78svh,720px)] h-[170vw] w-[170vw] -translate-x-1/2 rounded-full bg-void shadow-[0_-2px_0_rgb(201_164_106/0.55),0_-30px_120px_rgb(201_164_106/0.22)] md:top-[max(74svh,660px)] md:h-[140vw] md:w-[140vw]"
        />
      )}

      <div className="relative mx-auto max-w-[1120px] px-5 pb-28 pt-8 sm:px-8 lg:px-12">
        <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
          <ScrambleText text="← STELLR" />
        </Link>

        {state !== "in" && (
          <div className="mt-14 grid items-center gap-12 lg:mt-20 lg:grid-cols-[1fr_420px]">
            <div>
              <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.24em] text-ink/50">
                <span className="block h-[7px] w-[7px] bg-gold" />
                STELLR ACCOUNT
              </p>
              <h1 className="display mt-6 max-w-[14ch] text-[clamp(2.1rem,4.2vw,3.8rem)] leading-[1.04] text-ink">Your seat in the observatory.</h1>
              <p className="caps mt-6 max-w-[46ch] text-[12px] leading-relaxed text-ink/60 sm:text-[13px]">
                Every tool is free and works without an account. Sign in for a profile of your own.
              </p>
              <ul className="mt-10 space-y-4">
                {PERKS.map(([n, text]) => (
                  <li key={n} className="flex items-baseline gap-4 border-t border-ink/10 pt-4">
                    <span className="font-mono text-[10px] tracking-[0.2em] text-gold">{n}</span>
                    <span className="text-[14px] text-ink/75">{text}</span>
                  </li>
                ))}
              </ul>
            </div>

            <section className="frame bg-void/60 p-7 backdrop-blur-xl sm:p-9">
              <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">{state === "out" ? "SIGN IN" : "STATUS"}</p>
              {state === "checking" ? (
                <p className="mt-5 font-mono text-[11px] tracking-[0.16em] text-ink/55">CHECKING…</p>
              ) : state === "off" ? (
                <p className="caps mt-5 text-[12px] leading-relaxed text-ink/65">Sign-in isn&apos;t switched on yet. Every tool works without an account.</p>
              ) : state === "error" ? (
                <p className="caps mt-5 text-[12px] leading-relaxed text-ink/65">Couldn&apos;t reach accounts just now. Try again shortly.</p>
              ) : (
                <>
                  <p className="display mt-5 text-2xl text-ink">Welcome aboard.</p>
                  <p className="mt-2 text-[14px] text-ink/60">One tap with your Google account. No passwords to remember.</p>
                  <a
                    id="google-sign-in"
                    href="/api/auth/google?next=/account"
                    className="group mt-8 flex h-14 items-center whitespace-nowrap justify-center gap-3 rounded-full bg-ink px-6 text-[14px] font-semibold tracking-[0.02em] text-void shadow-[0_0_40px_rgb(236_238_242/0.12)] transition-all hover:bg-gold hover:shadow-[0_0_50px_rgb(201_164_106/0.35)]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
                      <GoogleMark />
                    </span>
                    Continue with Google
                    <span className="transition-transform group-hover:translate-x-1">→</span>
                  </a>
                  <p className="mt-6 border-t border-ink/10 pt-5 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-ink/40">
                    STELLR KEEPS YOUR NAME, EMAIL AND PICTURE FROM GOOGLE, NOTHING ELSE.{" "}
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
              {alert}
            </section>
          </div>
        )}

        {state === "in" && me && (
          <>
            <section className="mt-12 flex flex-col items-center gap-6 text-center md:mt-16 md:flex-row md:items-center md:gap-10 md:text-left">
              <Avatar me={me} />
              <div className="min-w-0">
                <p className="flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.24em] text-ink/50 md:justify-start">
                  <span className="live-dot block h-1.5 w-1.5 rounded-full bg-gold" />
                  SIGNED IN · YOUR STELLR
                </p>
                <h1 className="display mt-4 break-words text-[clamp(1.9rem,3.6vw,3.2rem)] leading-[1.05] text-ink">{me.name}</h1>
                <p className="mt-3 break-all font-mono text-[12px] tracking-[0.06em] text-ink/55">{me.email}</p>
              </div>
            </section>

            <section className="mt-14 grid grid-cols-3 border-y border-ink/10">
              {[
                ["DAYS IN ORBIT", String(days), `SINCE ${since(me.joined)}`],
                ["SAVED", String(saved), "INVESTIGATIONS HERE"],
                ["TOOLS", String(TOOLS.length), "ALL LIVE"],
              ].map(([label, value, note], i) => (
                <div key={label} className={`px-3 py-6 sm:px-6 ${i ? "border-l border-ink/10" : ""}`}>
                  <p className="font-mono text-[9px] tracking-[0.2em] text-ink/45 sm:text-[10px]">{label}</p>
                  <p className="display mt-3 text-[clamp(1.8rem,4vw,3rem)] leading-none text-ink">{value}</p>
                  <p className="mt-2 font-mono text-[8px] tracking-[0.14em] text-ink/35 sm:text-[9px]">{note}</p>
                </div>
              ))}
            </section>

            <section className="mt-16">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-mono text-[11px] tracking-[0.22em] text-ink/60">JUMP BACK IN</h2>
                <span className="font-mono text-[10px] tracking-[0.16em] text-ink/35">06 TOOLS</span>
              </div>
              <ul className="mt-6 grid gap-px overflow-hidden border border-ink/10 bg-ink/10 sm:grid-cols-2 lg:grid-cols-3">
                {TOOLS.map((t, i) => (
                  <li key={t.href} className="bg-void">
                    <Link href={t.href} className="group flex h-full flex-col gap-8 p-6 transition-colors hover:bg-ink/[0.04]">
                      <span className="font-mono text-[10px] tracking-[0.2em] text-ink/35">{String(i + 1).padStart(2, "0")}</span>
                      <span>
                        <span className="flex items-center justify-between gap-3 font-mono text-[12px] tracking-[0.18em] text-ink transition-colors group-hover:text-gold">
                          {t.name}
                          <span className="transition-transform group-hover:translate-x-1">→</span>
                        </span>
                        <span className="mt-2 block text-[13px] leading-relaxed text-ink/55">{t.line}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="frame mt-16 bg-void/60 p-6 backdrop-blur-xl sm:p-8">
              <h2 className="font-mono text-[11px] tracking-[0.22em] text-ink/60">ACCOUNT</h2>
              <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
                <p className="text-[14px] leading-relaxed text-ink/60">
                  Signed in with Google as <span className="text-ink/85">{me.email}</span>. Stellr keeps your name, email and picture, nothing else.{" "}
                  <Link href="/privacy" className="text-gold hover:underline">
                    Privacy
                  </Link>
                </p>
                <button
                  type="button"
                  onClick={signOut}
                  disabled={busy}
                  className="rounded-full border border-ink/30 px-6 py-3 font-mono text-[10px] tracking-[0.18em] text-ink/90 transition-colors hover:border-ink hover:bg-ink hover:text-void disabled:opacity-50"
                >
                  SIGN OUT
                </button>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-ink/10 pt-6">
                {confirming ? (
                  <>
                    <span className="font-mono text-[10px] tracking-[0.14em] text-ink/60">DELETE YOUR ACCOUNT FOR GOOD? THIS CAN&apos;T BE UNDONE.</span>
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
                  <button type="button" onClick={() => setConfirming(true)} className="font-mono text-[10px] tracking-[0.16em] text-ink/40 transition-colors hover:text-red-300">
                    DELETE ACCOUNT
                  </button>
                )}
              </div>
              {alert}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
