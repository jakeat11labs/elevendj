import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const alt = "ElevenDJ — the live AI music request line powered by ElevenLabs Music";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand font (KMR Waldenburg) loaded straight from /public so the OG render
// matches the in-app lockup. The import.meta.url reference lets Next's file
// tracer bundle the .otf files into the serverless function.
async function loadFont(file: string) {
  const path = fileURLToPath(
    new URL(`../../public/fonts/${file}`, import.meta.url)
  );
  return readFile(path);
}

export default async function OpengraphImage() {
  const [buch, normal, halbfett] = await Promise.all([
    loadFont("KMR-Waldenburg-Buch.otf"),
    loadFont("KMR-Waldenburg-Normal.otf"),
    loadFont("KMR-Waldenburg-Halbfett.otf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "76px 80px",
          color: "#FFFFFF",
          fontFamily: "KMR Waldenburg",
          backgroundColor: "#2b0a0d",
          // Deep maroon "creative" wash + a warm orb glow lower-right, matching
          // the live stage background.
          backgroundImage:
            "radial-gradient(135% 135% at 28% 18%, #82242b 0%, #561519 46%, #2b0a0d 100%), radial-gradient(55% 70% at 88% 112%, rgba(224,110,84,0.55) 0%, rgba(224,110,84,0) 60%)",
        }}
      >
        {/* Top — product eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: 10,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.78)",
          }}
        >
          ElevenLabs Music
        </div>

        {/* Center — the || DJ lockup */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            {/* Icon bars (mirrors /brand/icon-white.svg) */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 30,
                marginRight: 34,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 168,
                  borderRadius: 3,
                  backgroundColor: "#FFFFFF",
                }}
              />
              <div
                style={{
                  width: 38,
                  height: 168,
                  borderRadius: 3,
                  backgroundColor: "#FFFFFF",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 230,
                fontWeight: 400,
                lineHeight: 1,
                letterSpacing: 4,
                // Lift the baseline box so the caps sit flush with the bars.
                marginBottom: -14,
              }}
            >
              DJ
            </div>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 46,
              fontWeight: 300,
              letterSpacing: 1,
              color: "rgba(255,255,255,0.92)",
            }}
          >
            The live AI music request line
          </div>
        </div>

        {/* Bottom — usage cue */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 24,
            fontWeight: 500,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.62)",
          }}
        >
          Scan · Request · Hear it on the floor
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "KMR Waldenburg", data: buch, weight: 300, style: "normal" },
        { name: "KMR Waldenburg", data: normal, weight: 400, style: "normal" },
        { name: "KMR Waldenburg", data: halbfett, weight: 500, style: "normal" },
      ],
    }
  );
}
