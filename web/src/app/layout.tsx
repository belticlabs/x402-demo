import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
