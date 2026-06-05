"use client";

import { useState } from "react";
import {
  Check,
  Disc3,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  X,
} from "lucide-react";

const API_KEYS_URL = "https://elevenlabs.io/app/developers/api-keys";

interface ApiKeySetupModalProps {
  /**
   * "gate" — first-run, non-dismissible: the host can't use the console until a
   * valid key is saved. "manage" — replacing an existing key; dismissible.
   */
  mode: "gate" | "manage";
  /** Called after a key is saved successfully (parent should refresh state). */
  onSaved: () => void | Promise<void>;
  /** Dismiss handler — only used in "manage" mode. */
  onClose?: () => void;
}

export function ApiKeySetupModal({ mode, onSaved, onClose }: ApiKeySetupModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismissible = mode === "manage";

  async function save() {
    const trimmed = apiKey.trim();
    if (trimmed.length < 20 || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Couldn't verify that key. Try again.");
        return;
      }
      setApiKey("");
      await onSaved();
      onClose?.();
    } catch {
      setError("Network error saving your key.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className="card rise w-full max-w-md p-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Connect your ElevenLabs API key"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <KeyRound size={16} />
            Connect your ElevenLabs key
          </h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost inline-flex size-8 items-center justify-center"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <p className="text-sm leading-6 text-[var(--dark-gray)]">
          ElevenDJ generates each track with your own ElevenLabs account, so
          usage is billed to you. Create a key, paste it below, and we&rsquo;ll
          store it securely.
        </p>

        <ol className="mt-4 space-y-2 text-sm text-[var(--dark-gray)]">
          <li className="flex items-start gap-2">
            <span className="mono mt-0.5 text-xs text-[var(--mid-gray)]">1</span>
            <span>
              Open the ElevenLabs API keys page and create a new key.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mono mt-0.5 text-xs text-[var(--mid-gray)]">2</span>
            <span>Copy it and paste it here — we verify it before saving.</span>
          </li>
        </ol>

        <a
          href={API_KEYS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost mt-3 inline-flex h-10 w-full items-center justify-center gap-2 text-sm"
        >
          <ExternalLink size={15} />
          Generate a key at elevenlabs.io
        </a>

        <label className="mt-4 block">
          <span className="eyebrow mb-1.5 block">API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk_…"
            autoComplete="off"
            spellCheck={false}
            className="control h-11 w-full px-3 font-mono text-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
          />
        </label>

        {error && (
          <p className="mt-2.5 text-sm text-[var(--destructive)]">{error}</p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={apiKey.trim().length < 20 || submitting}
          className="btn-primary mt-3 inline-flex h-11 w-full items-center justify-center gap-2 text-sm"
        >
          {submitting ? (
            <>
              <Disc3 size={16} className="animate-spin" />
              Verifying…
            </>
          ) : (
            <>
              <Check size={16} />
              Verify &amp; save
            </>
          )}
        </button>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-[var(--mid-gray)]">
          <ShieldCheck size={12} />
          Encrypted at rest. Only you can use or remove it.
        </p>
      </div>
    </div>
  );
}
