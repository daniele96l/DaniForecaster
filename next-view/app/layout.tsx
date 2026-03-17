import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solar & Wind Explorer",
  description: "Visualize Solar.CSV and Wind.csv time series"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

