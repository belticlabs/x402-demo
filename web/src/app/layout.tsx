import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Analytics } from "@vercel/analytics/next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "x402 + KYA Demo | Verified AI Agent Payments",
  description:
    "Experience the difference between anonymous and verified AI agents with x402 payment protocol and Beltic KYA credentials.",
  keywords: ["x402", "KYA", "AI agents", "payments", "crypto", "verification"],
  authors: [{ name: "Beltic Labs" }],
  openGraph: {
    title: "x402 + KYA Demo",
    description: "Verified AI Agent Payments",
    type: "website",
    images: [
      {
        url: "/preview.jpg",
        width: 1200,
        height: 630,
        alt: "x402 Proof-of-Concept",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
