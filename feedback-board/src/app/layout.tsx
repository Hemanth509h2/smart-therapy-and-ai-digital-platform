import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import Overlays from "@/components/Overlays";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#eceff3", colorScheme: "light" };

export const metadata: Metadata = {
  title: "STAAD Feedback",
  description: "Anonymous feedback on STAAD - Smart Therapy & AI Digital Platform. No sign-in, no identity stored.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={sans.className}>
        <div className="app">
          {children}
          <Overlays />
        </div>
      </body>
    </html>
  );
}
