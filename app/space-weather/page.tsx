import type { Metadata } from "next";
import SpaceWeather from "@/components/SpaceWeather";

export const metadata: Metadata = {
  title: "Space Weather — Stellr",
  description:
    "The solar wind, Earth's magnetic shield, solar flares and tonight's aurora, live from NOAA in real-time 3D, with the aurora chance for where you are.",
};

export default function SpaceWeatherPage() {
  return <SpaceWeather />;
}
