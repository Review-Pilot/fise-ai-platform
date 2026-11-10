import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fise Outreach Studio",
  description: "Find, research and reach small businesses for the Fise AI website chatbot.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
