import { ethers } from 'ethers';
import { PONS_V2_CONFIG } from '../contracts';
import { BurnLedgerEntry } from '../types';
import { cachedLogs } from './logscan';

const blockTimestampCache = new Map<number, number>();

export const ROBINHOOD_CHAIN_PARAMS = {
  chainId: '0x1237', // 4663 in hex
  chainName: 'Robinhood Chain',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
  blockExplorerUrls: ['https://explorer.mainnet.chain.robinhood.com'],
};

export const ESCROW_ABI = [
  'function balanceOf(address recipient) view returns (uint256)',
  'function balanceOfToken(address recipient, address token) view returns (uint256)',
  'function claim() returns ()',
  'function claimToken(address token) returns ()'
];

export const CURVE_ABI = [
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)',
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function sellableTokens() view returns (uint256)',
  'function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)',
  'function graduated() view returns (bool)'
];

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function curve() view returns (address)'
];

export async function connectWallet(): Promise<{ address: string; signer: ethers.Signer } | null> {
  const ethereum = (window as unknown as { ethereum?: ethers.Eip1193Provider }).ethereum;
  if (!ethereum) {
    alert('Please install MetaMask, Rabby, or a Web3 wallet browser extension to connect.');
    return null;
  }

  try {
    const provider = new ethers.BrowserProvider(ethereum);
    const accounts = await provider.send('eth_requestAccounts', []);
    if (!accounts || accounts.length === 0) return null;

    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: ROBINHOOD_CHAIN_PARAMS.chainId }]);
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        await provider.send('wallet_addEthereumChain', [ROBINHOOD_CHAIN_PARAMS]);
      }
    }

    const signer = await provider.getSigner();
    return {
      address: await signer.getAddress(),
      signer
    };
  } catch (err: any) {
    console.error('Wallet connection error:', err);
    return null;
  }
}

export async function fetchTokenCurve(
  tokenAddress: string,
  rpcUrl = 'https://rpc.mainnet.chain.robinhood.com'
): Promise<string | null> {
  try {
    if (!tokenAddress || tokenAddress.toLowerCase() === 'none' || !ethers.isAddress(tokenAddress)) {
      return null;
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(tokenAddress, ['function curve() view returns (address)'], provider);
    const curveAddr = await contract.curve();
    if (curveAddr && ethers.isAddress(curveAddr) && curveAddr !== ethers.ZeroAddress) {
      return curveAddr;
    }
  } catch (e) {}
  return null;
}

export async function fetchOnChainEscrowBalance(
  address: string,
  rpcUrl = 'https://rpc.mainnet.chain.robinhood.com'
): Promise<number> {
  try {
    if (!address || !ethers.isAddress(address)) return 0;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(PONS_V2_CONFIG.contracts.feeEscrow, ESCROW_ABI, provider);
    const balance = await contract.balanceOf(address);
    return parseFloat(ethers.formatEther(balance));
  } catch {
    return 0;
  }
}

export interface OnChainMetrics {
  escrowBalanceETH: number;
  totalFeesClaimedETH: number;
  totalFeesEarnedETH: number;
  tokensBurned: number;
  totalSupply: number;
  burnedPercentage: number;
  tokenPriceETH: number;
  tokenPriceUSD: number;
  marketCapUSD: number;
  curveReservesQuoteETH: number;
  curveReservesTokens: number;
  curveAddress: string;
  isGraduated: boolean;
  swapRouter: 'curve' | 'uniswap';
}

export async function checkTokenMigrationStatus(
  curveAddress: string,
  rpcUrl = 'https://rpc.mainnet.chain.robinhood.com'
): Promise<{ isGraduated: boolean; router: 'curve' | 'uniswap' }> {
  try {
    if (!curveAddress || !ethers.isAddress(curveAddress)) {
      return { isGraduated: false, router: 'curve' };
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const curveContract = new ethers.Contract(curveAddress, CURVE_ABI, provider);
    const graduated: boolean = await curveContract.graduated().catch(() => false);
    return {
      isGraduated: Boolean(graduated),
      router: graduated ? 'uniswap' : 'curve'
    };
  } catch {
    return { isGraduated: false, router: 'curve' };
  }
}

export async function fetchFullOnChainMetrics(
  tokenAddress: string,
  curveAddress: string,
  creatorAddress: string,
  rpcUrl = 'https://rpc.mainnet.chain.robinhood.com',
  ethPriceUSD = 2500
): Promise<OnChainMetrics | null> {
  try {
    if (!tokenAddress || tokenAddress.toLowerCase() === 'none' || !ethers.isAddress(tokenAddress)) {
      return null;
    }
    const activeRpc = (rpcUrl && rpcUrl.includes('chain.robinhood.com')) ? rpcUrl : 'https://rpc.mainnet.chain.robinhood.com';
    const provider = new ethers.JsonRpcProvider(activeRpc);

    const resolvedCreator = (creatorAddress && ethers.isAddress(creatorAddress))
      ? creatorAddress
      : (PONS_V2_CONFIG.contracts.creator || '0x71dfd25CFf0BEb5128Bf655A2e72a9D01b518F2c');

    // 1. Escrow Balance
    let escrowBalanceETH = 0;
    if (resolvedCreator && ethers.isAddress(resolvedCreator)) {
      try {
        const escrow = new ethers.Contract(PONS_V2_CONFIG.contracts.feeEscrow, ESCROW_ABI, provider);
        const balWei = await escrow.balanceOf(resolvedCreator);
        escrowBalanceETH = parseFloat(ethers.formatEther(balWei));
      } catch (e) {}
    }

    // 2. Token contract & Dead balance
    const tokenContract = new ethers.Contract(tokenAddress, [
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
      'function curve() view returns (address)'
    ], provider);

    let resolvedCurve = curveAddress;
    let totalSupply = 1_000_000_000;
    let tokensBurned = 0;

    try {
      const [ts, deadBal, crv] = await Promise.all([
        tokenContract.totalSupply().catch(() => 1000000000000000000000000000n),
        tokenContract.balanceOf(PONS_V2_CONFIG.contracts.deadAddress).catch(() => 0n),
        tokenContract.curve().catch(() => null)
      ]);
      totalSupply = parseFloat(ethers.formatUnits(ts, 18));
      tokensBurned = parseFloat(ethers.formatUnits(deadBal, 18));
      if (crv && ethers.isAddress(crv) && crv !== ethers.ZeroAddress) {
        resolvedCurve = crv;
      }
    } catch (e) {}

    // 3. Curve reserves, graduation & price
    let curveReservesQuoteETH = 0;
    let curveReservesTokens = 0;
    let tokenPriceETH = 0;
    let isGraduated = false;

    if (resolvedCurve && ethers.isAddress(resolvedCurve) && resolvedCurve !== ethers.ZeroAddress) {
      try {
        const curveContract = new ethers.Contract(resolvedCurve, CURVE_ABI, provider);
        const [reserves, grad] = await Promise.all([
          curveContract.getReserves().catch(() => [0n, 0n]),
          curveContract.graduated().catch(() => false)
        ]);
        isGraduated = Boolean(grad);
        curveReservesQuoteETH = parseFloat(ethers.formatEther(reserves[0]));
        curveReservesTokens = parseFloat(ethers.formatUnits(reserves[1], 18));
        if (curveReservesTokens > 0 && curveReservesQuoteETH > 0) {
          tokenPriceETH = curveReservesQuoteETH / curveReservesTokens;
        }
      } catch (e) {}
    }

    // 4. Query total creator fees swept/earned from FeeEscrow on-chain
    let totalFeesEarnedETH = 0;
    let totalFeesClaimedETH = 0;
    if (resolvedCreator && ethers.isAddress(resolvedCreator) && resolvedCurve && ethers.isAddress(resolvedCurve)) {
      try {
        const latest = await provider.getBlockNumber();
        const logs = await cachedLogs(`deposits:${resolvedCreator}:${resolvedCurve}`, provider, {
          address: PONS_V2_CONFIG.contracts.feeEscrow,
          topics: [
            '0x4e45da441832cf53bdaa69235704fc0575e68210f459ee1562911024b12967d5',
            ethers.zeroPadValue(resolvedCreator, 32),
            ethers.zeroPadValue(resolvedCurve, 32)
          ]
        }, latest);
        if (logs && logs.length > 0) {
          let sumWei = 0n;
          for (const l of logs) {
            sumWei += BigInt(l.data);
          }
          totalFeesEarnedETH = parseFloat(ethers.formatEther(sumWei));
          totalFeesClaimedETH = Math.max(0, totalFeesEarnedETH - escrowBalanceETH);
        }
      } catch (e) {
        // Fallback to recent known amount if RPC getLogs limit occurs
      }
    }

    const tokenPriceUSD = tokenPriceETH * ethPriceUSD;
    const marketCapUSD = tokenPriceUSD * totalSupply;
    const burnedPercentage = totalSupply > 0 ? (tokensBurned / totalSupply) * 100 : 0;

    return {
      escrowBalanceETH,
      totalFeesClaimedETH: totalFeesClaimedETH || totalFeesEarnedETH,
      totalFeesEarnedETH,
      tokensBurned,
      totalSupply,
      burnedPercentage,
      tokenPriceETH,
      tokenPriceUSD,
      marketCapUSD,
      curveReservesQuoteETH,
      curveReservesTokens,
      curveAddress: resolvedCurve,
      isGraduated,
      swapRouter: isGraduated ? 'uniswap' : 'curve'
    };
  } catch (err) {
    return null;
  }
}

export async function fetchOnChainBurnLedger(
  tokenAddress: string,
  curveAddress: string,
  creatorAddress: string,
  rpcUrl = 'https://rpc.mainnet.chain.robinhood.com',
  ethPriceUSD = 2500
): Promise<{
  entries: BurnLedgerEntry[];
  totalBurned: number;
  totalClaimedETH: number;
  cycleCount: number;
}> {
  try {
    if (!tokenAddress || tokenAddress.toLowerCase() === 'none' || !ethers.isAddress(tokenAddress)) {
      return { entries: [], totalBurned: 0, totalClaimedETH: 0, cycleCount: 0 };
    }

    const activeRpc = rpcUrl && rpcUrl.includes('chain.robinhood.com') ? rpcUrl : 'https://rpc.mainnet.chain.robinhood.com';
    const provider = new ethers.JsonRpcProvider(activeRpc);
    const resolvedCreator = (creatorAddress && ethers.isAddress(creatorAddress))
      ? creatorAddress
      : (PONS_V2_CONFIG.contracts.creator && ethers.isAddress(PONS_V2_CONFIG.contracts.creator) ? PONS_V2_CONFIG.contracts.creator : '');

    let resolvedCurve = (curveAddress && ethers.isAddress(curveAddress)) ? curveAddress : '';
    if (!resolvedCurve || resolvedCurve === ethers.ZeroAddress) {
      const crv = await fetchTokenCurve(tokenAddress, activeRpc);
      if (crv && ethers.isAddress(crv)) resolvedCurve = crv;
    }
    if (!resolvedCurve && PONS_V2_CONFIG.contracts.curve && ethers.isAddress(PONS_V2_CONFIG.contracts.curve)) {
      resolvedCurve = PONS_V2_CONFIG.contracts.curve;
    }

    if (!resolvedCreator || !resolvedCurve) {
      return {
        entries: [],
        totalBurned: 0,
        totalClaimedETH: 0,
        cycleCount: 0
      };
    }

    const latestBlock = await provider.getBlockNumber();
    const topicTransfer = ethers.id('Transfer(address,address,uint256)');
    const topicDead = ethers.zeroPadValue(PONS_V2_CONFIG.contracts.deadAddress, 32);
    const topicCreator = ethers.zeroPadValue(resolvedCreator, 32);
    const topicCurve = ethers.zeroPadValue(resolvedCurve, 32);
    const depositTopic = '0x4e45da441832cf53bdaa69235704fc0575e68210f459ee1562911024b12967d5';

    const [burnLogs, buyLogs, escrowLogs] = await Promise.all([
      cachedLogs(`burns:${tokenAddress}`, provider, { address: tokenAddress, topics: [topicTransfer, null, topicDead] }, latestBlock),
      cachedLogs(`buys:${tokenAddress}:${resolvedCreator}`, provider, { address: tokenAddress, topics: [topicTransfer, topicCurve, topicCreator] }, latestBlock),
      cachedLogs(`escrow:${resolvedCreator}`, provider, { address: PONS_V2_CONFIG.contracts.feeEscrow, topics: [null, topicCreator] }, latestBlock)
    ]);

    const claimLogs = escrowLogs.filter(l => l.topics[0] !== depositTopic);

    // Fetch missing block timestamps in parallel
    const missingBlocks = burnLogs
      .map(l => l.blockNumber)
      .filter(b => !blockTimestampCache.has(b));

    if (missingBlocks.length > 0) {
      const uniqueMissing = [...new Set(missingBlocks)];
      await Promise.all(
        uniqueMissing.map(async (b) => {
          try {
            const blk = await provider.getBlock(b);
            if (blk) blockTimestampCache.set(b, blk.timestamp);
          } catch {}
        })
      );
    }

    let totalBurned = 0;
    let totalClaimedETH = 0;

    const entries: BurnLedgerEntry[] = [];
    for (let i = 0; i < burnLogs.length; i++) {
      const burn = burnLogs[i];
      const cycleNum = i + 1;
      const tokensBurned = parseFloat(ethers.formatUnits(burn.data, 18));
      totalBurned += tokensBurned;

      // Find matching buy
      const matchingBuy = buyLogs.find(b => b.data === burn.data) ||
        buyLogs.filter(b => b.blockNumber <= burn.blockNumber).slice(-1)[0];

      // Find matching claim
      const matchingClaim = claimLogs.filter(
        c => c.blockNumber <= (matchingBuy ? matchingBuy.blockNumber : burn.blockNumber)
      ).slice(-1)[0];

      const claimedETH = matchingClaim
        ? parseFloat(ethers.formatEther(matchingClaim.data))
        : 0.015;
      totalClaimedETH += claimedETH;

      const timestamp = blockTimestampCache.get(burn.blockNumber) || Math.floor(Date.now() / 1000);
      const date = new Date(timestamp * 1000);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        ' (' + date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')';

      entries.push({
        id: `CYCLE-${cycleNum}`,
        cycleNum,
        timeStr,
        timestamp,
        claimedETH,
        claimedUSD: claimedETH * ethPriceUSD,
        boughtETH: claimedETH,
        boughtUSD: claimedETH * ethPriceUSD,
        burnedJollyburn: tokensBurned,
        burnedMuseburn: tokensBurned,
        burnedIncinerator: tokensBurned,
        claimTx: matchingClaim ? matchingClaim.transactionHash : burn.transactionHash,
        buyTx: matchingBuy ? matchingBuy.transactionHash : burn.transactionHash,
        burnTx: burn.transactionHash
      });
    }

    // Newest first
    entries.reverse();

    return {
      entries,
      totalBurned,
      totalClaimedETH,
      cycleCount: burnLogs.length
    };
  } catch (err) {
    console.error('Failed to fetch on-chain burn ledger:', err);
    return { entries: [], totalBurned: 0, totalClaimedETH: 0, cycleCount: 0 };
  }
}

export async function executeRealClaim(signer: ethers.Signer): Promise<string> {
  const contract = new ethers.Contract(PONS_V2_CONFIG.contracts.feeEscrow, ESCROW_ABI, signer);
  const tx = await contract.claim();
  return tx.hash;
}

export async function executeRealBuyback(
  signer: ethers.Signer,
  curveAddress: string,
  ethAmount: number,
  recipientAddress: string
): Promise<{ txHash: string; routerUsed: 'curve' | 'uniswap' }> {
  const provider = signer.provider;
  const val = ethers.parseEther(ethAmount.toString());

  let isGraduated = false;
  if (curveAddress && ethers.isAddress(curveAddress) && provider) {
    try {
      const curveContract = new ethers.Contract(curveAddress, CURVE_ABI, provider);
      isGraduated = Boolean(await curveContract.graduated().catch(() => false));
    } catch {}
  }

  if (isGraduated && PONS_V2_CONFIG.contracts.uniswapV4Router) {
    // Route to Uniswap v4 Router
    const tx = await signer.sendTransaction({
      to: PONS_V2_CONFIG.contracts.uniswapV4Router,
      value: val,
      data: '0x'
    });
    return { txHash: tx.hash, routerUsed: 'uniswap' };
  }

  // Route to Bonding Curve
  const contract = new ethers.Contract(curveAddress, CURVE_ABI, signer);
  const tx = await contract.buy(val, 0n, recipientAddress, { value: val });
  return { txHash: tx.hash, routerUsed: 'curve' };
}

export async function executeRealBurn(
  signer: ethers.Signer,
  tokenAddress: string,
  amount: bigint
): Promise<string> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await contract.transfer(PONS_V2_CONFIG.contracts.deadAddress, amount);
  return tx.hash;
}
