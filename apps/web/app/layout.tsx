import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "B2500 Energy",
  description: "Energiemonitoring für Balkonkraftwerk + Marstek B2500",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "B2500",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
