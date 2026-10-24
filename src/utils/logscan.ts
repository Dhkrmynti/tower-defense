import { ethers } from 'ethers';

/**
 * Robinhood Chain mints a block every ~0.1 s, so a 600k-block lookback is only 17 hours. Logs are
 * scanned in chunks the RPC accepts, over a window of weeks, and cached so each poll only reads the
 * blocks minted since the last one.
 */
export const CHUNK_BLOCKS = 3_000_000;
/** ~70 days at 0.105 s per block. */
export const WINDOW_BLOCKS = 60_000_000;

interface Cache {
  logs: ethers.Log[];
  last: number;
  first: number;
}
const caches = new Map<string, Cache>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chunks are read one after another (the RPC rate-limits bursts), each retried once on failure. */
export async function scanLogs(provider: ethers.JsonRpcProvider, filter: { address: string; topics: (string | null)[] }, fromBlock: number, toBlock: number, chunk = CHUNK_BLOCKS): Promise<ethers.Log[]> {
  const out: ethers.Log[] = [];
  for (let from = fromBlock; from <= toBlock; from += chunk) {
    const to = Math.min(toBlock, from + chunk - 1);
    let logs: ethers.Log[] | null = null;
    for (let attempt = 0; attempt < 3 && !logs; attempt++) {
      try {
        logs = await provider.getLogs({ ...filter, fromBlock: from, toBlock: to });
      } catch {
        await sleep(400 * (attempt + 1));
      }
    }
    if (!logs) throw new Error(`log scan failed for blocks ${from}-${to}`);
    out.push(...logs);
  }
  return out;
}

/** Logs for a filter over the window ending at `head`, read incrementally and kept in memory. */
export async function cachedLogs(key: string, provider: ethers.JsonRpcProvider, filter: { address: string; topics: (string | null)[] }, head: number, window = WINDOW_BLOCKS): Promise<ethers.Log[]> {
  const start = Math.max(0, head - window);
  let c = caches.get(key);
  if (!c || c.first > start + CHUNK_BLOCKS) {
    const logs = await scanLogs(provider, filter, start, head);
    c = { logs, last: head, first: start };
    caches.set(key, c);
    return c.logs;
  }
  if (head > c.last) {
    const fresh = await scanLogs(provider, filter, c.last + 1, head);
    if (fresh.length) c.logs.push(...fresh);
    c.last = head;
  }
  return c.logs;
}
