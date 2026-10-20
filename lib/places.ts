export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** IANA zone used to print local times; undefined means the browser's own zone. */
  timeZone?: string;
}

export const CITIES: Place[] = [
  { name: "New Delhi", lat: 28.61, lon: 77.21, timeZone: "Asia/Kolkata" },
  { name: "Mumbai", lat: 19.08, lon: 72.88, timeZone: "Asia/Kolkata" },
  { name: "London", lat: 51.51, lon: -0.13, timeZone: "Europe/London" },
  { name: "Berlin", lat: 52.52, lon: 13.4, timeZone: "Europe/Berlin" },
  { name: "Nairobi", lat: -1.29, lon: 36.82, timeZone: "Africa/Nairobi" },
  { name: "New York", lat: 40.71, lon: -74.01, timeZone: "America/New_York" },
  { name: "Los Angeles", lat: 34.05, lon: -118.24, timeZone: "America/Los_Angeles" },
  { name: "São Paulo", lat: -23.55, lon: -46.63, timeZone: "America/Sao_Paulo" },
  { name: "Tokyo", lat: 35.68, lon: 139.69, timeZone: "Asia/Tokyo" },
  { name: "Sydney", lat: -33.87, lon: 151.21, timeZone: "Australia/Sydney" },
];

/** Best guess from the browser's time zone, without asking for location. */
export function guessCity(): Place {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const alias = zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
  return (
    CITIES.find((c) => c.timeZone === alias) ??
    CITIES.find((c) => c.timeZone?.split("/")[0] === alias.split("/")[0]) ??
    CITIES[2]
  );
}
