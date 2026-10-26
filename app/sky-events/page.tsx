import type { Metadata } from "next";
import SkyEvents from "@/components/SkyEvents";

export const metadata: Metadata = {
  title: "Sky Events — Stellr",
  description:
    "Eclipses, meteor showers, planets, the Moon, bright ISS passes and rocket launches for the next year, in your time zone and marked by what you can see.",
};

export default function SkyEventsPage() {
  return <SkyEvents />;
}
