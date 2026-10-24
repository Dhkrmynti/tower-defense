import { ethers } from "ethers";

export const UNISWAP_V4_POOL_MANAGER = process.env.UNISWAP_POOL_MANAGER || "0x8366a39CC670B4001A1121B8F6A443A643e40951";

export type PoolKey = { fee: number; tickSpacing: number; hooks: string };

const INITIALIZE = ethers.id("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");
const coder = ethers.AbiCoder.defaultAbiCoder();

/**
 * The ETH pool the curve opened when the token graduated, searched backwards from the chain head
 * (the bot notices graduation soon after it happens). Anyone can initialize a pool for any token,
 * so only a pool born in a transaction the curve itself took part in counts.
 */
export async function findGraduationPool(provider: ethers.Provider, token: string, curve: string, maxChunks = 40): Promise<PoolKey | null> {
  const head = await provider.getBlockNumber();
  const step = 500_000;
  for (let to = head, n = 0; to > 0 && n < maxChunks; to -= step, n++) {
    const logs = await provider.getLogs({
      address: UNISWAP_V4_POOL_MANAGER,
      topics: [INITIALIZE, null, ethers.zeroPadValue(ethers.ZeroAddress, 32), ethers.zeroPadValue(token, 32)],
      fromBlock: Math.max(0, to - step + 1),
      toBlock: to,
    });
    for (const l of logs.reverse()) {
      const receipt = await provider.getTransactionReceipt(l.transactionHash);
      if (!receipt?.logs.some((x) => x.address.toLowerCase() === curve.toLowerCase())) continue;
      const [fee, tickSpacing, hooks] = coder.decode(["uint24", "int24", "address", "uint160", "int24"], l.data);
      return { fee: Number(fee), tickSpacing: Number(tickSpacing), hooks: ethers.getAddress(hooks) };
    }
  }
  return null;
}

/**
 * Universal Router calldata that swaps exactly `buyAmountWei` of native ETH for the token in
 * the given pool: V4_SWAP with SWAP_EXACT_IN_SINGLE, SETTLE_ALL (pay the ETH), TAKE_ALL.
 * Checked on 2026-10-15 by simulating a buy of a graduated Pons token on mainnet.
 */
export function buildUniswapV4Buy(targetToken: string, buyAmountWei: bigint, key: PoolKey, deadlineSeconds = 1800, minTokensOut = 1n) {
  const token = ethers.getAddress(targetToken);
  const poolKey = [ethers.ZeroAddress, token, key.fee, key.tickSpacing, key.hooks];
  const swap = coder.encode(
    ["tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)"],
    [[poolKey, true, buyAmountWei, minTokensOut, "0x"]],
  );
  const settle = coder.encode(["address", "uint256"], [ethers.ZeroAddress, buyAmountWei]);
  const take = coder.encode(["address", "uint256"], [token, minTokensOut]);
  const input = coder.encode(["bytes", "bytes[]"], ["0x060c0f", [swap, settle, take]]);
  const router = new ethers.Interface(["function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable"]);
  return router.encodeFunctionData("execute", ["0x10", [input], Math.floor(Date.now() / 1000) + deadlineSeconds]);
}

/**
 * How many tokens `buyAmountWei` buys right now, found by simulating the router call with a rising
 * minimum out: the swap reverts once the minimum is above what the pool gives. Read-only (eth_call).
 */
export async function quoteUniswapV4Buy(provider: ethers.Provider, router: string, from: string, targetToken: string, buyAmountWei: bigint, key: PoolKey): Promise<bigint> {
  const fits = async (min: bigint) =>
    provider.call({ from, to: router, value: buyAmountWei, data: buildUniswapV4Buy(targetToken, buyAmountWei, key, 1800, min) }).then(
      () => true,
      () => false,
    );
  if (!(await fits(1n))) return 0n;
  let lo = 1n;
  let hi = 2n;
  while (await fits(hi)) {
    lo = hi;
    hi *= 2n;
  }
  // 1 part in 10,000 is close enough for a slippage floor
  while (hi - lo > lo / 10_000n + 1n) {
    const mid = (lo + hi) / 2n;
    if (await fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
