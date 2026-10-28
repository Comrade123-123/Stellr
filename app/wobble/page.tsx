import type { Metadata } from "next";
import Wobble from "@/components/Wobble";

export const metadata: Metadata = {
  title: "Wobble — Stellr",
  description:
    "Investigate the unknown: Stellr's research agent searches real TESS starlight for planets every day, re-examining planet candidates and searching stars nobody has checked, and records what it finds.",
};

export default function WobblePage() {
  return <Wobble />;
}
