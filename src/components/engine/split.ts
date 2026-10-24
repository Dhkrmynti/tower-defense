import { useEffect, useState } from 'react';

/**
 * Extra engine readings from /api/status that the main engine hook does not carry: the claim split,
 * the per-buy cap, the creator fees still waiting in the curve, and whether the bot is in sync.
 */
export interface Split {
  burnPct: number;
  wagePct: number;
  maxBuyETH: number;
  /** Estimate of the creator fees still in the curve, not yet swept into the escrow. */
  pendingFeesETH: number;
  /** The engine API answered and the bot read the chain within the last 90 seconds. */
  inSync: boolean;
}

const FALLBACK: Split = { burnPct: 35, wagePct: 65, maxBuyETH: 0.01, pendingFeesETH: 0, inSync: true };
const SYNC_WINDOW_MS = 90_000;
let cached: Split = FALLBACK;
let inflight: Promise<Split> | null = null;
let fetchedAt = 0;

async function load(): Promise<Split> {
  if (Date.now() - fetchedAt < 12_000) return cached;
  inflight ??= fetch('/api/status', { signal: AbortSignal.timeout(8000) })
    .then((r) => r.json())
    .then((j) => {
      const d = j?.data ?? {};
      const burn = Number(d.burnSharePct);
      const hasBurn = Number.isFinite(burn) && d.burnSharePct !== null;
      const lastSync = Number(d.lastSyncAt) || 0;
      cached = {
        burnPct: hasBurn ? burn : cached.burnPct,
        wagePct: hasBurn ? 100 - burn : cached.wagePct,
        maxBuyETH: Number(d.maxBuyETH) || cached.maxBuyETH,
        pendingFeesETH: Number(d.pendingFeesETH) || 0,
        // an engine without the field (older bot) is treated as in sync
        inSync: d.lastSyncAt === undefined ? true : lastSync > 0 && Date.now() - lastSync < SYNC_WINDOW_MS,
      };
      return cached;
    })
    .catch(() => {
      cached = { ...cached, inSync: false };
      return cached;
    })
    .finally(() => {
      fetchedAt = Date.now();
      inflight = null;
    });
  return inflight;
}

/** Live engine extras, shared by every section that uses them. */
export function useSplit(): Split {
  const [split, setSplit] = useState(cached);
  useEffect(() => {
    let alive = true;
    const tick = () => load().then((s) => alive && setSplit(s));
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return split;
}
