"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The landing splash (/) and the fullscreen stage (/stage) are chrome-free.
const HIDDEN_PREFIXES = ["/stage"];

export function SiteHeader() {
  const pathname = usePathname();

  if (pathname === "/" || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) {
    return null;
  }

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-6 sm:px-8">
      <Link href="/" className="flex items-end gap-1.5">
        <Image
          src="/brand/icon-black.svg"
          alt="ElevenLabs"
          width={101}
          height={160}
          priority
          unoptimized
          className="h-[22px] w-auto"
        />
        <span className="brand-dj" aria-hidden>
          DJ
        </span>
      </Link>
    </header>
  );
}
