import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Kurdish Sorani Subtitle Translator",
  description:
    "Translate subtitle files into Kurdish Sorani entirely in your browser. " +
    "No uploads, no API keys, no external translation service.",
  applicationName: "Kurdish Sorani Subtitle Translator",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d65e8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
