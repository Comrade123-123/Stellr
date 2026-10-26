import type { Metadata } from "next";
import OrbitWatch from "@/components/OrbitWatch";

export const metadata: Metadata = {
  title: "Orbit Watch — Stellr",
  description:
    "The ISS, Tiangong, Hubble and the brightest satellites on a live 3D globe, with the next passes over your sky.",
};

export default function OrbitWatchPage() {
  return <OrbitWatch />;
}
