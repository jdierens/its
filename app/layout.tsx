import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ITS Inventory",
  description: "Create and edit inventory items",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/">ITS</Link>
          <span>Inventory</span>
        </header>
        {children}
      </body>
    </html>
  );
}
