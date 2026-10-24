import { ethers } from 'ethers';

/** How much of the token a wallet holds. Read-only. */
export async function fetchHolding(address: string, tokenAddress: string, rpcUrl = 'https://rpc.mainnet.chain.robinhood.com'): Promise<{ balance: number; heldPct: number }> {
  if (!ethers.isAddress(address) || !ethers.isAddress(tokenAddress)) return { balance: 0, heldPct: 0 };
  const activeRpc = rpcUrl && rpcUrl.includes('chain.robinhood.com') ? rpcUrl : 'https://rpc.mainnet.chain.robinhood.com';
  const provider = new ethers.JsonRpcProvider(activeRpc);
  const token = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)'], provider);
  const [bal, ts] = await Promise.all([token.balanceOf(address).catch(() => 0n), token.totalSupply().catch(() => 0n)]);
  const balance = parseFloat(ethers.formatUnits(bal, 18));
  const supply = parseFloat(ethers.formatUnits(ts, 18));
  return { balance, heldPct: supply > 0 ? (balance / supply) * 100 : 0 };
}
