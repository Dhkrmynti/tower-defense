import { ethers } from 'ethers';
import { PONS_V2_CONFIG } from '../contracts';
import { WINDOW_BLOCKS, cachedLogs } from './logscan';

/** One defender on the leaderboard: a wallet and what it has traded against the curve. */
export interface Defender {
  address: string;
  /** Tokens traded against the curve (buys + sells), the contribution to the war chest. */
  volume: number;
  buys: number;
  sells: number;
  trades: number;
  lastBlock: number;
  /** Share of all defender volume, 0..100. */
  share: number;
}

export interface Board {
  defenders: Defender[];
  totalVolume: number;
  totalTrades: number;
  fromBlock: number;
  toBlock: number;
  updatedAt: number;
}

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ZERO = ethers.ZeroAddress.toLowerCase();

/**
 * Builds the leaderboard from the token's Transfer logs against the bonding curve: a transfer out of
 * the curve is a buy, a transfer into it is a sell. Every trade pays a creator fee into the war chest,
 * so volume is the contribution. The engine's own wallet, the dead address and the curve are excluded.
 */
export async function fetchDefenders(
  tokenAddress: string,
  curveAddress: string,
  excluded: string[],
  rpcUrl = 'https://rpc.mainnet.chain.robinhood.com',
  blocksBack = WINDOW_BLOCKS,
): Promise<Board | null> {
  if (!ethers.isAddress(tokenAddress) || !ethers.isAddress(curveAddress)) return null;
  const activeRpc = rpcUrl && rpcUrl.includes('chain.robinhood.com') ? rpcUrl : 'https://rpc.mainnet.chain.robinhood.com';
  const provider = new ethers.JsonRpcProvider(activeRpc);

  const toBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, toBlock - blocksBack);
  const topicCurve = ethers.zeroPadValue(curveAddress, 32);

  const [buyLogs, sellLogs] = await Promise.all([
    cachedLogs(`lb-buys:${tokenAddress}`, provider, { address: tokenAddress, topics: [TRANSFER_TOPIC, topicCurve, null] }, toBlock, blocksBack),
    cachedLogs(`lb-sells:${tokenAddress}`, provider, { address: tokenAddress, topics: [TRANSFER_TOPIC, null, topicCurve] }, toBlock, blocksBack),
  ]);

  const skip = new Set(
    [curveAddress, PONS_V2_CONFIG.contracts.deadAddress, ZERO, PONS_V2_CONFIG.contracts.feeEscrow, ...excluded]
      .filter((a) => a && ethers.isAddress(a))
      .map((a) => a.toLowerCase()),
  );

  const byAddress = new Map<string, Defender>();
  const bump = (addr: string, amount: number, kind: 'buy' | 'sell', block: number) => {
    const key = addr.toLowerCase();
    if (skip.has(key)) return;
    const d = byAddress.get(key) ?? { address: key, volume: 0, buys: 0, sells: 0, trades: 0, lastBlock: 0, share: 0 };
    d.volume += amount;
    d.trades += 1;
    if (kind === 'buy') d.buys += 1;
    else d.sells += 1;
    d.lastBlock = Math.max(d.lastBlock, block);
    byAddress.set(key, d);
  };

  for (const l of buyLogs) {
    const to = ethers.getAddress(ethers.dataSlice(l.topics[2], 12));
    bump(to, parseFloat(ethers.formatUnits(l.data, 18)), 'buy', l.blockNumber);
  }
  for (const l of sellLogs) {
    const from = ethers.getAddress(ethers.dataSlice(l.topics[1], 12));
    bump(from, parseFloat(ethers.formatUnits(l.data, 18)), 'sell', l.blockNumber);
  }

  const defenders = [...byAddress.values()].sort((a, b) => b.volume - a.volume || b.trades - a.trades);
  const totalVolume = defenders.reduce((acc, d) => acc + d.volume, 0);
  const totalTrades = defenders.reduce((acc, d) => acc + d.trades, 0);
  for (const d of defenders) d.share = totalVolume > 0 ? (d.volume / totalVolume) * 100 : 0;

  return { defenders, totalVolume, totalTrades, fromBlock, toBlock, updatedAt: Date.now() };
}
