import type { Tour } from "nextstepjs";

/** localStorage key for "this host has seen the onboarding tour". */
export const HOST_TOUR_KEY = "elevendj:host-onboarded";
/** Tour id used with `startNextStep()`. */
export const HOST_TOUR_ID = "host-onboarding";

/**
 * First-run walkthrough of the host console. Targets `#tour-*` ids rendered by
 * the HostConsole. Keep one idea per step — the UI is the teacher, the card is
 * just the label.
 */
export const tours: Tour[] = [
  {
    tour: HOST_TOUR_ID,
    steps: [
      {
        icon: "👋",
        title: "Welcome to your console",
        content:
          "This is your DJ booth. Here's a 60-second tour of how to run a live AI request line. You can skip anytime.",
        showControls: true,
        showSkip: true,
      },
      {
        icon: "🖥️",
        title: "Open the Stage",
        content:
          "Click Stage to open the Stage tab in a new window. The Stage is the one place audio actually plays — share that tab (with audio) into your Google Meet, Zoom, or Teams call so everyone hears the set. Your controls here drive it.",
        selector: "#tour-stage-button",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 8,
        pointerRadius: 10,
      },
      {
        icon: "🪄",
        title: "Spin your own",
        content:
          "The DJ booth lets you drop your own track straight into the queue — it skips the line and approval, even when requests are paused.",
        selector: "#tour-dj-booth",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 8,
        pointerRadius: 12,
      },
      {
        icon: "🎚️",
        title: "Request line on/off",
        content:
          "Flip this to open or pause the request line. Paused means guests can't submit new tracks — handy between sets or when you want to catch up.",
        selector: "#tour-request-line",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 6,
        pointerRadius: 12,
      },
      {
        icon: "🤖",
        title: "AutoDJ",
        content:
          "AutoDJ is ON by default — every request generates automatically and flows into the queue, hands-free. Turn it OFF when you'd rather screen each request before it generates.",
        selector: "#tour-autodj",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 6,
        pointerRadius: 12,
      },
      {
        icon: "📱",
        title: "Let people request",
        content:
          "The Stage tab shows a big QR code your guests scan to add songs to the queue. This card holds the same link — copy it to drop in chat, or hit New link to rotate it.",
        selector: "#tour-public-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 8,
        pointerRadius: 12,
      },
      {
        icon: "🔑",
        title: "Your ElevenLabs key",
        content:
          "Tracks generate with your own ElevenLabs key, so usage is billed to your account. Manage it here anytime — replace it or remove it.",
        selector: "#tour-api-key",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 8,
        pointerRadius: 12,
      },
      {
        icon: "▶️",
        title: "Transport controls",
        content:
          "Play, pause, and skip from here. When a Stage tab is connected these buttons drive its audio, so the crowd hears every move.",
        selector: "#tour-player",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 8,
        pointerRadius: 12,
      },
      {
        icon: "✅",
        title: "Approve requests",
        content:
          "With AutoDJ off, incoming requests wait here for you. Approve them one at a time, or hit Approve all to send the whole batch into the queue at once.",
        selector: "#tour-approvals",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 8,
        pointerRadius: 12,
      },
      {
        icon: "🎵",
        title: "The live queue",
        content:
          "Ready tracks line up here. Drag to reorder, play any track, or remove what you don't want. This is what the Stage plays through.",
        selector: "#tour-queue",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 8,
        pointerRadius: 12,
      },
      {
        icon: "💾",
        title: "Your files",
        content:
          "Every generated track is saved here. Download tracks, re-add them to the queue, or browse past sessions.",
        selector: "#tour-files",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 8,
        pointerRadius: 12,
      },
      {
        icon: "🎉",
        title: "You're set",
        content:
          "Open the Stage, share that tab into your call, and let the requests roll in. Replay this tour anytime from Take a tour in the header.",
        showControls: true,
        showSkip: false,
      },
    ],
  },
];
