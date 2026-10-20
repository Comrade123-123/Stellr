import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

// Variable weight + width: headings use it extended and light.
const display = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Stellr — From your backyard to the edge of the observable universe",
  description:
    "Stellr is a family of browser-based space tools: live satellites, asteroids, sky events and space weather, rendered in real-time 3D.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
