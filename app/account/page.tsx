import type { Metadata } from "next";
import Account from "@/components/Account";

export const metadata: Metadata = {
  title: "Account — Stellr",
  description: "Sign in to Stellr with Google.",
  robots: { index: false },
};

export default function AccountPage() {
  return <Account />;
}
