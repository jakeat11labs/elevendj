"use client";

import {
  Check,
  Copy,
  KeyRound,
  QrCode,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { QRCodeSVG } from "qrcode.react";

import { formatDate } from "./format";

/**
 * Left-column host controls: request-line / AutoDJ / Station-ID / crossfade
 * toggles, master volume, the public request link + QR, and the ElevenLabs key
 * card. Purely presentational — the overview-derived display booleans plus the
 * settings, session-link, and api-key hook returns come from props.
 */
export function HostControlsPanel({
  requestsOpen,
  autoDj,
  stationIdEnabled,
  crossfadeEnabled,
  stationIdPersonalize,
  stationIdHostName,
  settings,
  sessionLink,
  apiKey,
  removeApiKey,
  removingKey,
  onAddKey,
  isAdmin,
}: {
  requestsOpen: boolean;
  autoDj: boolean;
  stationIdEnabled: boolean;
  crossfadeEnabled: boolean;
  stationIdPersonalize: boolean;
  stationIdHostName: string;
  settings: ReturnType<typeof import("./use-host-settings").useHostSettings>;
  sessionLink: ReturnType<typeof import("./use-session-link").useSessionLink>;
  apiKey:
    | { hasKey: boolean; hint: string | null; addedAt: string | null }
    | undefined;
  removeApiKey: () => void;
  removingKey: boolean;
  onAddKey: () => void;
  isAdmin: boolean;
}) {
  return (
    <section className="card rise p-4 sm:p-5">
      {/* Request line toggle */}
      <div
        id="tour-request-line"
        className="card-soft flex items-center justify-between gap-3 p-4"
      >
        <div className="min-w-0">
          <p className="eyebrow">Request line</p>
          <p className="mt-1 text-sm text-[var(--dark-gray)]">
            {requestsOpen
              ? "Open — visitors can submit new tracks."
              : "Paused — new requests are blocked."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={requestsOpen}
          disabled={settings.togglingRequests}
          onClick={settings.toggleRequests}
          title={requestsOpen ? "Pause requests" : "Open requests"}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            requestsOpen ? "bg-[var(--graphite)]" : "bg-[var(--light-gray)]"
          }`}
        >
          <span
            className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
              requestsOpen ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* AutoDJ toggle */}
      <div
        id="tour-autodj"
        className="card-soft mt-3 flex items-center justify-between gap-3 p-4"
      >
        <div className="min-w-0">
          <p className="eyebrow">AutoDJ</p>
          <p className="mt-1 text-sm text-[var(--dark-gray)]">
            {autoDj
              ? "On — requests generate automatically."
              : "Off — you approve each request before it generates."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoDj}
          disabled={settings.togglingAutoDj}
          onClick={settings.toggleAutoDj}
          title={autoDj ? "Switch to approval mode" : "Turn AutoDJ on"}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            autoDj ? "bg-[var(--graphite)]" : "bg-[var(--light-gray)]"
          }`}
        >
          <span
            className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
              autoDj ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Station ID — auto radio-ID jingle every couple of songs */}
      <div className="card-soft mt-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Station ID</p>
            <p className="mt-1 text-sm text-[var(--dark-gray)]">
              {stationIdEnabled
                ? "On — a ~10s radio ID plays every 2 songs."
                : "Off — no station IDs between songs."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={stationIdEnabled}
            disabled={settings.togglingStationId}
            onClick={settings.toggleStationId}
            title={
              stationIdEnabled ? "Turn Station ID off" : "Turn Station ID on"
            }
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              stationIdEnabled
                ? "bg-[var(--graphite)]"
                : "bg-[var(--light-gray)]"
            }`}
          >
            <span
              className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
                stationIdEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {stationIdEnabled ? (
          <div className="mt-4 border-t border-[var(--light-gray)] pt-4">
            <label className="flex items-center gap-2 text-sm text-[var(--dark-gray)]">
              <input
                type="checkbox"
                checked={stationIdPersonalize}
                onChange={settings.toggleStationIdPersonalize}
                className="size-4 accent-[var(--graphite)]"
              />
              Personalize with my name
            </label>
            <input
              type="text"
              // Re-keyed on the saved value so it re-seeds when the server
              // value changes, but stays uncontrolled while typing.
              key={stationIdHostName}
              defaultValue={stationIdHostName}
              disabled={!stationIdPersonalize || settings.savingStationName}
              maxLength={60}
              placeholder="e.g. DJ Jake, or your room name"
              onBlur={(event) =>
                settings.saveStationIdHostName(event.currentTarget.value.trim())
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="mt-2 w-full rounded-lg border border-[var(--light-gray)] bg-white px-3 py-2 text-sm disabled:opacity-50"
            />
            <p className="mt-2 text-xs text-[var(--mid-gray)]">
              {stationIdPersonalize
                ? "Woven into the jingle, e.g. “DJ Jake on ElevenDJ Radio, powered by ElevenLabs.”"
                : "Off — stays the high-level “ElevenDJ Radio, powered by ElevenLabs.”"}
            </p>
          </div>
        ) : null}
      </div>

      {/* Crossfade — radio-style overlap between tracks on the stage */}
      <div className="card-soft mt-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Crossfade</p>
            <p className="mt-1 text-sm text-[var(--dark-gray)]">
              {crossfadeEnabled
                ? "On — tracks blend into each other on the stage."
                : "Off — tracks hard-cut to the next."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={crossfadeEnabled}
            disabled={settings.togglingCrossfade}
            onClick={settings.toggleCrossfade}
            title={
              crossfadeEnabled ? "Turn crossfade off" : "Turn crossfade on"
            }
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              crossfadeEnabled
                ? "bg-[var(--graphite)]"
                : "bg-[var(--light-gray)]"
            }`}
          >
            <span
              className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
                crossfadeEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Master volume — host-controlled room level; the stage obeys it */}
      <div
        id="tour-master-volume"
        className="card-soft mt-3 flex items-center gap-4 p-4"
      >
        <button
          type="button"
          onClick={() =>
            settings.commitMasterVolume(settings.masterVolume === 0 ? 1 : 0)
          }
          className="text-[var(--dark-gray)] transition-colors hover:text-[var(--graphite)]"
          aria-label={settings.masterVolume === 0 ? "Unmute room" : "Mute room"}
          title={settings.masterVolume === 0 ? "Unmute room" : "Mute room"}
        >
          {settings.masterVolume === 0 ? (
            <VolumeX size={20} />
          ) : settings.masterVolume < 0.5 ? (
            <Volume1 size={20} />
          ) : (
            <Volume2 size={20} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Master volume</p>
            <span className="text-sm tabular-nums text-[var(--dark-gray)]">
              {settings.masterVolumePct}%
            </span>
          </div>
          <SliderPrimitive.Root
            className="relative mt-2 flex h-5 w-full touch-none select-none items-center"
            value={[settings.masterVolume]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(vals) => settings.setPendingVolume(vals[0] ?? 0)}
            onValueCommit={(vals) => settings.commitMasterVolume(vals[0] ?? 0)}
            aria-label="Master volume"
          >
            <SliderPrimitive.Track className="relative h-1.5 grow rounded-full bg-[var(--light-gray)]">
              <SliderPrimitive.Range className="absolute h-full rounded-full bg-[var(--graphite)]" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb className="block size-4 rounded-full bg-white shadow ring-1 ring-[var(--light-gray)] transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--graphite)]" />
          </SliderPrimitive.Root>
          <p className="mt-1 text-xs text-[var(--dark-gray)]">
            Sets the playback level on the stage screen.
          </p>
        </div>
      </div>

      {/* Public request link + QR (unique to this session) */}
      <div
        id="tour-public-link"
        className="card-soft mt-3 flex flex-col gap-3 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Public request link</p>
            <p className="mono mt-1 truncate text-sm text-[var(--dark-gray)]">
              {sessionLink.requestLink || "Starting your session…"}
            </p>
          </div>
          {sessionLink.requestLink ? (
            <div className="shrink-0 rounded-[var(--radius-md)] bg-white p-1.5 ring-1 ring-[var(--light-gray)]">
              <QRCodeSVG
                value={sessionLink.requestLink}
                size={84}
                marginSize={0}
              />
            </div>
          ) : null}
        </div>
        <p className="text-[11px] text-[var(--mid-gray)]">
          Unique to this session — scanning the QR opens your request line.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={sessionLink.copyLink}
            disabled={!sessionLink.requestLink}
            className="btn-ghost inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm"
          >
            {sessionLink.copied ? <Check size={16} /> : <Copy size={16} />}
            {sessionLink.copied ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={sessionLink.regenerateLink}
            disabled={sessionLink.regenerating || !sessionLink.requestLink}
            className="btn-ghost inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm"
            title="Issue a new link + QR (the old one stops working)"
          >
            <QrCode size={16} />
            {sessionLink.regenerating ? "Regenerating…" : "New link"}
          </button>
        </div>
      </div>

      {/* ElevenLabs API key — host brings their own; generation is billed
          to their account. Admins fall back to the shared app key. */}
      <div
        id="tour-api-key"
        className="card-soft mt-3 flex flex-col gap-3 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5">
              <KeyRound size={12} />
              ElevenLabs key
            </p>
            {apiKey?.hasKey ? (
              <p className="mt-1 text-sm text-[var(--dark-gray)]">
                Connected <span className="mono">{apiKey.hint}</span>
                {apiKey.addedAt ? (
                  <span className="text-[var(--mid-gray)]">
                    {" · added "}
                    {formatDate(apiKey.addedAt)}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-sm text-[var(--dark-gray)]">
                {isAdmin
                  ? "Using the shared app key. Add your own to bill generation to your account."
                  : "Connect your key to generate tracks."}
              </p>
            )}
          </div>
          {apiKey?.hasKey && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--light-gray)] bg-[var(--cream)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--graphite)]">
              <span className="size-1.5 rounded-full bg-[var(--graphite)]" />
              Connected
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddKey}
            className="btn-ghost inline-flex h-10 items-center justify-center gap-2 px-4 text-sm"
          >
            <KeyRound size={15} />
            {apiKey?.hasKey ? "Replace key" : "Add key"}
          </button>
          {apiKey?.hasKey && (
            <button
              type="button"
              onClick={removeApiKey}
              disabled={removingKey}
              className="btn-danger inline-flex h-10 items-center justify-center gap-2 px-4 text-sm"
            >
              <Trash2 size={15} />
              {removingKey ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
