import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy — Stellr",
  description: "What Stellr collects, why, and how to delete it.",
};

const ISSUES = "https://github.com/Comrade123-123/Stellr/issues";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="29 OCT 2026"
      sections={[
        [
          "THE SHORT VERSION",
          <p key="a">
            Every Stellr tool works without an account and without handing over anything about you. If you choose to sign in, Stellr keeps
            your name, email address and profile picture from Google, and nothing else. It never sells or shares them.
          </p>,
        ],
        [
          "SIGNING IN WITH GOOGLE",
          <>
            <p>
              When you sign in, Google tells Stellr your account id, name, email address and profile picture. Stellr stores them, with the
              date you joined, so it can show your account page. It asks Google for nothing more: no contacts, no files, no calendar.
            </p>
            <p>
              Signing in sets one cookie, <code>stellr_session</code>, which keeps you signed in for up to 30 days. Signing out removes it.
              You can delete your account at any time from the <Link href="/account" className="text-gold">account page</Link>; that
              erases what Stellr stored about you straight away.
            </p>
          </>,
        ],
        [
          "WHAT STAYS IN YOUR BROWSER",
          <p key="b">
            Your location, if you share it for the sky tools, is used in your browser to work out what is overhead and is not sent to
            Stellr. Exoplanet Lab investigations you save are kept in your browser&apos;s local storage, on that device only.
          </p>,
        ],
        [
          "ANALYTICS",
          <p key="c">
            Stellr counts page views with Vercel Web Analytics, which uses no cookies and does not identify you. The site is hosted on
            Vercel, whose servers see standard request information such as your IP address, as any website host does.
          </p>,
        ],
        [
          "DATA FROM SPACE AGENCIES",
          <p key="d">
            The tools load public data from NASA, JPL, NOAA, CelesTrak and others through Stellr&apos;s own servers. Those requests carry
            nothing about you.
          </p>,
        ],
        [
          "WHERE IT IS KEPT",
          <p key="e">
            Account records are stored with Upstash (Redis), the site runs on Vercel, and sign-in is handled by Google. Each processes data
            only to provide its service.
          </p>,
        ],
        [
          "QUESTIONS",
          <p key="f">
            Ask anything about this policy, or about your data, by opening an issue on{" "}
            <a href={ISSUES} className="text-gold" target="_blank" rel="noreferrer">
              Stellr&apos;s GitHub
            </a>
            . If this policy changes, the date above will change with it.
          </p>,
        ],
      ]}
    />
  );
}
