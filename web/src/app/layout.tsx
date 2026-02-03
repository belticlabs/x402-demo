import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "x402 + KYA Demo | Verified AI Agent Payments",
  description:
    "Experience the difference between anonymous and verified AI agents with x402 payment protocol and Beltic KYA credentials.",
  keywords: ["x402", "KYA", "AI agents", "payments", "crypto", "verification"],
  authors: [{ name: "Beltic Labs" }],
  openGraph: {
    title: "x402 + KYA Demo",
    description: "Verified AI Agent Payments",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
