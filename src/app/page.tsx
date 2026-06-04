import Image from "next/image";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="rise flex items-end gap-4 sm:gap-5">
        <Image
          src="/brand/logo-black.png"
          alt="ElevenLabs"
          width={420}
          height={72}
          priority
          className="h-12 w-auto sm:h-16"
        />
        <span className="display translate-y-[0.12em] text-4xl text-[var(--graphite)] sm:text-5xl">
          DJ
        </span>
      </div>
    </main>
  );
}
