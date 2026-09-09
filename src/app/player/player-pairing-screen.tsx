"use client";

import { useCallback, useEffect, useState } from "react";

type PairingCreated = {
  pairingId: string;
  displayCode: string;
  deviceName: string;
  expiresAt: string;
  secret: string;
};

const SECRET_KEY = "elevendj-player-pairing-secret";
const PAIRING_ID_KEY = "elevendj-player-pairing-id";

export function PlayerPairingScreen({
  onApproved,
}: {
  onApproved: () => void;
}) {
  const [deviceName, setDeviceName] = useState("Main Hall player");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingCreated | null>(null);

  const startPairing = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/player/pairings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || "Could not start pairing.");
        return;
      }
      const created = body as PairingCreated;
      window.sessionStorage.setItem(SECRET_KEY, created.secret);
      window.sessionStorage.setItem(PAIRING_ID_KEY, created.pairingId);
      setPairing(created);
    } catch {
      setError("Network error starting pairing.");
    } finally {
      setBusy(false);
    }
  }, [deviceName]);

  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    const poll = async () => {
      const secret =
        pairing.secret || window.sessionStorage.getItem(SECRET_KEY);
      if (!secret) return;
      try {
        const res = await fetch(`/api/player/pairings/${pairing.pairingId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret }),
          cache: "no-store",
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || cancelled) return;
        if (body?.status === "approved") {
          window.sessionStorage.removeItem(SECRET_KEY);
          window.sessionStorage.removeItem(PAIRING_ID_KEY);
          onApproved();
        } else if (body?.status === "expired" || body?.status === "rejected") {
          setError(
            body.status === "expired"
              ? "This pairing code expired. Start again."
              : "Pairing was rejected. Start again."
          );
          setPairing(null);
        }
      } catch {
        /* keep polling */
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pairing, onApproved]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--cream)] p-6">
      <div className="card w-full max-w-md p-6">
        <h1
          className="text-2xl text-[var(--graphite)]"
          style={{ fontFamily: "var(--font-brand)" }}
        >
          Pair this player
        </h1>
        <p className="mt-2 text-sm text-[var(--mid-gray)]">
          Give this device a name, then approve the code in the Offsite admin
          console. Audio stays locked until you tap Enable audio after pairing.
        </p>

        {error && (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--destructive)] bg-[rgba(180,35,24,0.06)] p-3 text-sm text-[var(--destructive)]">
            {error}
          </div>
        )}

        {!pairing ? (
          <div className="mt-5 space-y-3">
            <label className="block text-sm text-[var(--graphite)]">
              Device name
              <input
                className="control mt-1 h-10 w-full px-3 text-sm"
                value={deviceName}
                maxLength={60}
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-primary inline-flex h-11 w-full items-center justify-center text-sm"
              disabled={busy || !deviceName.trim()}
              onClick={() => void startPairing()}
            >
              {busy ? "Starting…" : "Show pairing code"}
            </button>
          </div>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--mid-gray)]">
              Pairing code
            </p>
            <p
              className="mt-3 text-5xl tracking-[0.2em] text-[var(--graphite)]"
              style={{ fontFamily: "var(--font-brand)" }}
            >
              {pairing.displayCode}
            </p>
            <p className="mt-3 text-sm text-[var(--mid-gray)]">
              Waiting for an Offsite admin to approve…
            </p>
            <button
              type="button"
              className="btn-ghost mt-4 text-sm"
              onClick={() => setPairing(null)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
