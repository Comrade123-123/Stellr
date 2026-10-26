"use client";

import { type FormEvent, useId, useState } from "react";
import ScrambleText from "@/components/ui/ScrambleText";

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

type Status = "idle" | "invalid" | "sending" | "joined" | "already" | "rate_limited" | "unavailable" | "error";

const DONE: Partial<Record<Status, string>> = {
  joined: "You're on the list. We'll write when it's your turn.",
  already: "You're already on the list. We'll write when it's your turn.",
};

const PROBLEM: Partial<Record<Status, string>> = {
  invalid: "Enter a valid email address.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  unavailable: "Sign-ups open shortly. Please try again in a little while.",
  error: "Something went wrong. Please try again.",
};

/** Email sign-up, posted to /api/waitlist. */
export default function WaitlistForm({ className = "" }: { className?: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    if (!EMAIL.test(email.trim())) {
      setStatus("invalid");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), website }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: Status };
      setStatus(data.status && data.status in { ...DONE, ...PROBLEM } ? data.status : "error");
    } catch {
      setStatus("error");
    }
  };

  const done = DONE[status];
  if (done) {
    return (
      <p className={`caps text-center text-sm text-ink ${className}`} role="status">
        <span className="text-gold">●</span>&nbsp;&nbsp;{done}
      </p>
    );
  }
  const problem = PROBLEM[status];

  return (
    <form onSubmit={submit} noValidate className={`w-full max-w-[460px] ${className}`}>
      <label htmlFor={id} className="sr-only">
        Email address
      </label>
      <div className="flex h-14 items-center rounded-full border border-ink/30 p-1.5 transition-colors focus-within:border-ink/70">
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Your email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (problem) setStatus("idle");
          }}
          aria-invalid={status === "invalid"}
          aria-describedby={problem ? `${id}-error` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent pl-5 text-[15px] text-ink placeholder:text-ink/40 outline-none"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="h-full shrink-0 rounded-full bg-ink px-5 text-[12px] font-semibold tracking-[0.08em] text-void transition-colors hover:bg-gold focus-visible:bg-gold focus-visible:outline-none disabled:opacity-60 sm:px-6"
        >
          <ScrambleText text={status === "sending" ? "JOINING…" : "JOIN THE WAITLIST"} />
        </button>
      </div>
      {/* Honeypot: off-screen and skipped by keyboard and screen readers, so only bots fill it. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute -left-[9999px] h-px w-px opacity-0"
      />
      <p
        id={`${id}-error`}
        role={problem ? "alert" : undefined}
        className={`mt-3 text-center font-mono text-xs text-gold ${problem ? "" : "invisible"}`}
      >
        {problem ?? "Enter a valid email address."}
      </p>
    </form>
  );
}
