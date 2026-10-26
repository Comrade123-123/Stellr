import type { Metadata } from "next";
import AsteroidSentinel from "@/components/AsteroidSentinel";

export const metadata: Metadata = {
  title: "Asteroid Sentinel — Stellr",
  description:
    "Every asteroid passing within about twenty Moon-distances of Earth in the next two months: miss distance, speed and size, with its real path past Earth in 3D.",
};

export default function AsteroidSentinelPage() {
  return <AsteroidSentinel />;
}
