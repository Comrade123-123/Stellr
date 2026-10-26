import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
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

const title = "Stellr — From your backyard to the edge of the observable universe";
const description =
  "Stellr is a family of browser-based space tools: live satellites, asteroids, sky events and space weather, rendered in real-time 3D.";

// Share images come from app/opengraph-image.jpg and app/twitter-image.jpg; on Vercel their
// absolute URLs are built from the production domain, so no base URL is hard-coded here.
export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, siteName: "Stellr", type: "website", locale: "en" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} antialiased`}>
      <body>
        {children}
        {/* Page views only, no cookies; collects nothing in development. */}
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
      </body>
    </html>
  );
}
