import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";

import "./globals.css";

export const metadata: Metadata = {
  title: "ElevenDJ — live request line",
  description: "A live AI music request line powered by ElevenLabs Music.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Brand tokens + KMR Waldenburg @font-face are served statically from
            /public so the stylesheet's relative url() refs resolve at runtime.
            Importing it through the bundler would try (and fail) to resolve them. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/tokens.css" />
      </head>
      <body className="antialiased">
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
