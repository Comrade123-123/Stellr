import type { Metadata } from "next";
import ExoplanetLab from "@/components/ExoplanetLab";

export const metadata: Metadata = {
  title: "Exoplanet Lab — Stellr",
  description:
    "Research other worlds: search real NASA TESS starlight for transiting planets with Box Least Squares, check what you find, and compare it with every confirmed exoplanet.",
};

export default function ExoplanetLabPage() {
  return <ExoplanetLab />;
}
