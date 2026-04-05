import type { Metadata } from "next";
import { Space_Grotesk, Manrope } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KOI",
  description: "On-chain agent performance dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${manrope.variable} dark`}
    >
      <head>
        {/* Favicon — KOI logo */}
        <link rel="icon" href="/koi-logo.svg" type="image/svg+xml" />
        {/* Material Symbols icon font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        />
      </head>
      <body className="min-h-full bg-[#0e0e0e] text-[#e5e2e1] font-[family-name:var(--font-manrope)] antialiased selection:bg-[#00e5ff] selection:text-[#00363d]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
