import type { Metadata } from "next";
import { Agentation } from "agentation";

import { NextStepShell } from "@/components/nextstep-shell";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://eleven-dj.vercel.app";
const ogDescription =
  "Request any track in plain words and hear it generated live on the floor — powered by ElevenLabs Music.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ElevenDJ — live AI music request line",
    template: "%s · ElevenDJ",
  },
  description:
    "Scan the code, request any track in plain words, and hear it generated live on the floor — powered by ElevenLabs Music.",
  applicationName: "ElevenDJ",
  openGraph: {
    type: "website",
    siteName: "ElevenDJ",
    url: siteUrl,
    title: "ElevenDJ — live AI music request line",
    description: ogDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: "ElevenDJ — live AI music request line",
    description: ogDescription,
  },
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
        <NextStepShell>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            {children}
          </div>
        </NextStepShell>
        {process.env.NODE_ENV === "development" && (
          <Agentation endpoint="http://localhost:4747" />
        )}
      </body>
    </html>
  );
}
