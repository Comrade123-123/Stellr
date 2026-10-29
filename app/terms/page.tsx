import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms — Stellr",
  description: "The terms for using Stellr's space tools.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      updated="29 OCT 2026"
      sections={[
        [
          "USING STELLR",
          <p key="a">
            Stellr is a free set of space tools for learning and curiosity. Use them as you like for personal, educational or research
            purposes. Please don&apos;t try to break the site, overload its servers or get around its limits.
          </p>,
        ],
        [
          "THE DATA",
          <p key="b">
            Positions, forecasts and catalogues come from public sources such as NASA, JPL, NOAA and CelesTrak, and Stellr&apos;s own
            calculations. They are shown as accurately as Stellr can, but without any guarantee. Don&apos;t rely on Stellr for navigation,
            safety or operational decisions.
          </p>,
        ],
        [
          "RESEARCH RESULTS",
          <p key="c">
            A planet candidate found in Exoplanet Lab or Wobble is a signal that passed automated checks, not a confirmed planet. Treat it
            as a lead for proper follow-up.
          </p>,
        ],
        [
          "ACCOUNTS",
          <p key="d">
            Signing in is optional. You can delete your account at any time from the{" "}
            <Link href="/account" className="text-gold">
              account page
            </Link>
            . What Stellr stores is described in the{" "}
            <Link href="/privacy" className="text-gold">
              privacy policy
            </Link>
            . Stellr may close accounts that abuse the service.
          </p>,
        ],
        [
          "NO WARRANTY",
          <p key="e">
            Stellr is provided as is. Tools may change, pause or stop. To the extent the law allows, Stellr is not liable for losses arising
            from using it.
          </p>,
        ],
      ]}
    />
  );
}
