import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "Host Agent — Qloo Powered Party Planner",
  description: "Group taste-consensus party planner powered by Qloo Taste AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
