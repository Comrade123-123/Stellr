"use client";

import { type FormEvent, useId, useState } from "react";
import ScrambleText from "@/components/ui/ScrambleText";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Front-end only for now: validates and confirms, no backend yet. */
export default function WaitlistForm({ className = "" }: { className?: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "invalid" | "done">("idle");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatus(EMAIL.test(email.trim()) ? "done" : "invalid");
  };

  if (status === "done") {
    return (
      <p className={`caps text-center text-sm text-ink ${className}`} role="status">
        <span className="text-gold">●</span>&nbsp;&nbsp;You&apos;re on the list. We&apos;ll write when it&apos;s your turn.
      </p>
    );
  }

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
            if (status === "invalid") setStatus("idle");
          }}
          aria-invalid={status === "invalid"}
          aria-describedby={status === "invalid" ? `${id}-error` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent pl-5 text-[15px] text-ink placeholder:text-ink/40 outline-none"
        />
        <button
          type="submit"
          className="h-full shrink-0 rounded-full bg-ink px-5 text-[12px] font-semibold tracking-[0.08em] text-void transition-colors hover:bg-gold focus-visible:bg-gold focus-visible:outline-none sm:px-6"
        >
          <ScrambleText text="JOIN THE WAITLIST" />
        </button>
      </div>
      <p
        id={`${id}-error`}
        className={`mt-3 text-center font-mono text-xs text-gold ${status === "invalid" ? "" : "invisible"}`}
      >
        Enter a valid email address.
      </p>
    </form>
  );
}
