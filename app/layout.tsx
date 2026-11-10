import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "driver.js/dist/driver.css";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "VitalSwitch",
  description:
    "When ransomware takes a hospital lab offline, VitalSwitch uses Clocked to read the incident, verify the downtime procedure and reroute urgent blood tests.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
