import type { Metadata } from "next";
import "./globals.css";
import { validatePublicConfig } from "@/lib/config";
validatePublicConfig({
  NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK,
  NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
});
export const metadata: Metadata = {
  title: "Pactlance | Work with confidence",
  description:
    "Milestone payment protection for independent work. Development preview.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
