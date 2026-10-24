/**
 * PONS FAMILY V2 - AUTONOMOUS BUYBACK & BURN BOT
 * Network: Robinhood Chain (EVM Chain ID: 4663)
 * Reference: https://docs.ponsfamily.com/v2
 * 
 * Fitur:
 * 1. Menjalankan Autonomous Cycle (Claim Fee -> Buyback -> Burn) 24/7 di PM2.
 * 2. Uniswap v4 Universal Router integration untuk token yang telah graduated.
 * 3. Token CA & Curve Address terkunci permanen ke $BLAZE.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { buildUniswapV4Buy, findGraduationPool, quoteUniswapV4Buy, type PoolKey } from "./uniswap-v4";

// Native .env parser (tanpa ketergantungan modul eksternal)
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {}

// File konfigurasi persisten
const CONFIG_FILE = path.resolve(process.cwd(), "bot-config.json");

export const OFFICIAL_BLAZE_TOKEN = process.env.TOKEN_ADDRESS || process.env.VITE_TOKEN_ADDRESS || "";
export const OFFICIAL_BLAZE_CURVE = process.env.CURVE_ADDRESS || process.env.VITE_CURVE_ADDRESS || "";

// Default Config (Semua address di-reset dari 0)
let currentConfig = {
  rpcUrl: process.env.RPC_URL || process.env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  privateKey: process.env.CREATOR_PRIVATE_KEY || process.env.PRIVATE_KEY || "",
  treasuryAddress: process.env.TREASURY_ADDRESS || process.env.CREATOR_ADDRESS || process.env.VITE_CREATOR_ADDRESS || "",
  tokenAddress: OFFICIAL_BLAZE_TOKEN,
  curveAddress: OFFICIAL_BLAZE_CURVE,
  claimThresholdETH: process.env.CLAIM_THRESHOLD_ETH || process.env.VITE_CLAIM_THRESHOLD_ETH || "0.01",
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || "10", 10),
  port: parseInt(process.env.PORT || "5015", 10),
  // Loopback by default; set HOST=0.0.0.0 only behind a reverse proxy
  host: process.env.HOST || "127.0.0.1",
  cycleCount: 0
};

// Baca config tersimpan jika ada
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    if (saved.tokenAddress && saved.tokenAddress !== "") currentConfig.tokenAddress = saved.tokenAddress;
    if (saved.curveAddress && saved.curveAddress !== "") currentConfig.curveAddress = saved.curveAddress;
    if (saved.treasuryAddress && saved.treasuryAddress !== "") currentConfig.treasuryAddress = saved.treasuryAddress;
    if (saved.claimThresholdETH) currentConfig.claimThresholdETH = saved.claimThresholdETH;
    if (saved.pollIntervalSeconds) currentConfig.pollIntervalSeconds = saved.pollIntervalSeconds;
    if (typeof saved.cycleCount === "number") currentConfig.cycleCount = saved.cycleCount;
    console.log(`[CONFIG] Konfigurasi dimuat dari bot-config.json (Total Cycles: ${currentConfig.cycleCount})`);
  } catch (e: any) {
    console.error("Gagal membaca bot-config.json, menggunakan environment default:", e.message);
  }
}

// Simpan config ke file
function saveConfigToFile(newCfg: Partial<typeof currentConfig>) {
  if (newCfg.tokenAddress !== undefined) currentConfig.tokenAddress = newCfg.tokenAddress;
  if (newCfg.curveAddress !== undefined) currentConfig.curveAddress = newCfg.curveAddress;
  if (newCfg.treasuryAddress !== undefined) currentConfig.treasuryAddress = newCfg.treasuryAddress;
  if (newCfg.claimThresholdETH) currentConfig.claimThresholdETH = newCfg.claimThresholdETH;
  if (newCfg.pollIntervalSeconds) currentConfig.pollIntervalSeconds = newCfg.pollIntervalSeconds;
  if (newCfg.cycleCount !== undefined) currentConfig.cycleCount = newCfg.cycleCount;
  try {
    const toSave: any = {
      tokenAddress: currentConfig.tokenAddress,
      curveAddress: currentConfig.curveAddress,
      treasuryAddress: currentConfig.treasuryAddress,
      claimThresholdETH: currentConfig.claimThresholdETH,
      pollIntervalSeconds: currentConfig.pollIntervalSeconds,
      cycleCount: currentConfig.cycleCount !== undefined ? currentConfig.cycleCount : botState.totalCyclesExecuted
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), "utf-8");
  } catch (err: any) {
    console.error("Gagal menyimpan bot-config.json:", err.message);
  }
}

// BURN-ONLY mode (set BURN_ONLY=1): the bot never claims fees and never buys back.
// Fees stay in the Pons escrow for the creator to claim manually; any token that lands
// in the operator wallet is burned to the dead address automatically.
const BURN_ONLY = /^(1|true|yes)$/i.test(process.env.BURN_ONLY || "");
let lastBurnOnlyIdleLog = 0;

// A Pons curve holds the trading fees itself; only the creator's sweepFees() moves them into the
// fee escrow, where claim() can reach them. The bot sweeps at most this often while the escrow is short.
const SWEEP_INTERVAL_MS = Math.max(30, parseInt(process.env.SWEEP_INTERVAL_SECONDS || "120", 10)) * 1000;
let lastSweep = 0;
let curveEthAtSweep = -1n;

// SPLIT mode (default): every claim is split on the spot. BURN_SHARE_PCT of it becomes the burn budget,
// spent in buys of at most MAX_BUY_ETH, BUY_SPACING_SECONDS apart; the rest is the dev's wages, sent to
// TREASURY_ADDRESS. CYCLE_MODE=alternate keeps the old odd-burn / even-keep rides.
const CYCLE_MODE = (process.env.CYCLE_MODE || "split").toLowerCase() === "alternate" ? "alternate" : "split";
const pctEnv = (v: string | undefined, d: number) => {
  const n = v === undefined || v.trim() === "" ? d : Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d;
};
const BURN_SHARE_PCT = pctEnv(process.env.BURN_SHARE_PCT, 50);
const MAX_BUY_WEI = ethers.parseEther(process.env.MAX_BUY_ETH || "0.01");
const MIN_BUY_WEI = ethers.parseEther(process.env.MIN_BUY_ETH || "0.001");
const BUY_SPACING_MS = Math.max(10, parseInt(process.env.BUY_SPACING_SECONDS || "90", 10)) * 1000;
const SLIPPAGE_BPS = BigInt(Math.min(5000, Math.max(10, parseInt(process.env.SLIPPAGE_BPS || "300", 10))));
// The operator wallet always keeps this much for gas and stops spending below it
const GAS_RESERVE_WEI = ethers.parseEther(process.env.GAS_RESERVE_ETH || "0.002");
let lastBuy = 0;
let lastGasWarn = 0;

// Fees still inside the curve, for the site's coin box. The curve keeps trading ETH and fees in one
// balance, so right after a sweep (fees = 0) the bot notes balance - quoteReserve as the baseline; what
// grows above it is unswept fees. The creator's cut of those is measured at each sweep.
let curveBaseline: bigint | null = null;
let creatorShareBps = 8500n;
let pendingCreatorWei = 0n;
let lastSyncAt = 0;

/** Split-mode books, persisted so a restart never loses or double-counts the burn budget. */
const LEDGER_FILE = path.resolve(process.cwd(), "bot-ledger.json");
const ledger = (() => {
  const empty = { burnBudgetWei: "0", totalClaimedWei: "0", totalWagesWei: "0", totalBurnSpentWei: "0", totalTokensBurnedWei: "0", claims: 0, burns: 0 };
  try {
    return fs.existsSync(LEDGER_FILE) ? { ...empty, ...JSON.parse(fs.readFileSync(LEDGER_FILE, "utf-8")) } : empty;
  } catch {
    return empty;
  }
})();
const saveLedger = () => {
  try {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2), "utf-8");
  } catch (e: any) {
    console.error("Could not save bot-ledger.json:", e.message);
  }
};
const book = (k: "burnBudgetWei" | "totalClaimedWei" | "totalWagesWei" | "totalBurnSpentWei" | "totalTokensBurnedWei", v: bigint) => {
  ledger[k] = (BigInt(ledger[k]) + v).toString();
};
const wageOf = (claimWei: bigint) => (claimWei * BigInt(Math.round((100 - BURN_SHARE_PCT) * 100))) / 10_000n;

// Kontrak Resmi Pons v2 (docs.ponsfamily.com/v2)
const PONS_FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const UNISWAP_V4_UNIVERSAL_ROUTER = process.env.UNISWAP_ROUTER_ADDRESS || process.env.VITE_UNISWAP_ROUTER_ADDRESS || "0x8876789976dEcBfCbBbe364623C63652db8C0904";

/** The graduation pool, found once the curve has graduated. */
let v4Pool: PoolKey | null = null;

// ABIs
const ESCROW_ABI = [
  "function balanceOf(address recipient) view returns (uint256)",
  "function claim()"
];
const CURVE_ABI = [
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function sellableTokens() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function sweepFees(uint256 maxAmount)"
];
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function curve() view returns (address)"
];

// Memory state & persistent log file untuk monitoring & API
interface BotMemoryLog {
  timestamp: string;
  type: "info" | "success" | "warn" | "error";
  message: string;
}

const LOGS_FILE = path.resolve(process.cwd(), "bot-logs.json");
let initialLogs: BotMemoryLog[] = [];
if (fs.existsSync(LOGS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8"));
    if (Array.isArray(saved)) initialLogs = saved;
  } catch (e) {}
}

const botState = {
  online: true,
  status: "standby" as "standby" | "active" | "error" | "claiming" | "buyback" | "burning",
  walletAddress: "",
  tokenAddress: currentConfig.tokenAddress,
  curveAddress: currentConfig.curveAddress,
  claimThresholdETH: currentConfig.claimThresholdETH,
  escrowBalanceETH: "0.0",
  totalFeesClaimedETH: "0.0",
  totalFeesRetainedETH: "0.0",
  totalCyclesExecuted: currentConfig.cycleCount,
  lastCycleTime: "",
  logs: initialLogs
};

function addLog(type: "info" | "success" | "warn" | "error", message: string) {
  const timestamp = new Date().toLocaleTimeString();
  const logItem: BotMemoryLog = { timestamp, type, message };
  botState.logs.unshift(logItem);
  if (botState.logs.length > 80) botState.logs.pop();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(botState.logs, null, 2), "utf-8");
  } catch (e) {}
}

// Inisialisasi Wallet Web3
let provider: ethers.JsonRpcProvider | null = null;
let wallet: ethers.Wallet | null = null;

function initWallet() {
  try {
    if (!currentConfig.privateKey) {
      addLog("error", "CREATOR_PRIVATE_KEY not set in .env!");
      return;
    }
    provider = new ethers.JsonRpcProvider(currentConfig.rpcUrl, undefined, { cacheTimeout: -1 });
    wallet = new ethers.Wallet(currentConfig.privateKey, provider);
    botState.walletAddress = wallet.address;
    addLog("info", `Operator Wallet active: ${wallet.address}`);
  } catch (e: any) {
    addLog("error", `Failed to initialize wallet: ${e.message}`);
  }
}

initWallet();

// Validate whether Token Address is valid
function isValidAddress(addr?: string): boolean {
  if (!addr) return false;
  const c = addr.trim().toLowerCase();
  return c !== "none" && c !== "" && ethers.isAddress(c);
}

// The run in progress, saved after every step so a restart resumes it
const RUN_FILE = path.resolve(process.cwd(), "bot-run.json");
interface PendingRun {
  cycle: number;
  kind: "burn" | "keep" | "split" | "drip";
  wageWei?: string;
  budgeted?: boolean;
  buyWei?: string;
  debited?: boolean;
  claimWei: string;
  tokensBefore: string;
  claimTx?: string;
  claimed?: boolean;
  counted?: boolean;
  buyTx?: string;
  bought?: boolean;
  burnTx?: string;
  burned?: boolean;
  sendTx?: string;
  sent?: boolean;
}
let pending: PendingRun | null = (() => {
  try {
    return fs.existsSync(RUN_FILE) ? (JSON.parse(fs.readFileSync(RUN_FILE, "utf-8")) as PendingRun) : null;
  } catch {
    return null;
  }
})();
function savePending(run: PendingRun | null) {
  pending = run;
  try {
    if (run) fs.writeFileSync(RUN_FILE, JSON.stringify(run, null, 2), "utf-8");
    else fs.rmSync(RUN_FILE, { force: true });
  } catch (e: any) {
    addLog("error", `Could not save bot-run.json: ${e.message}`);
  }
}
/** Always the chain's next nonce for the operator, never a cached one. */
const nextNonce = () => provider!.getTransactionCount(wallet!.address, "pending");
/** true: mined and succeeded; false: reverted or never made it (safe to send again). */
async function settle(hash: string): Promise<boolean> {
  const rc = await provider!.getTransactionReceipt(hash);
  if (rc) return rc.status === 1;
  const tx = await provider!.getTransaction(hash);
  if (!tx) return false;
  const mined = await tx.wait().catch(() => null);
  return !!mined && mined.status === 1;
}

// Execution Cycle
let isExecuting = false;

async function executeCycle() {
  if (isExecuting) {
    addLog("warn", "Cycle currently executing, skipping this poll tick.");
    return;
  }

  botState.tokenAddress = currentConfig.tokenAddress;
  botState.curveAddress = currentConfig.curveAddress;

  if (!isValidAddress(currentConfig.tokenAddress)) {
    botState.status = "standby";
    addLog("warn", "STANDBY: Token CA is not configured. Waiting for configuration.");
    return;
  }

  if (!wallet || !provider) {
    botState.status = "error";
    addLog("error", "Wallet or RPC Provider not ready.");
    return;
  }

  // Auto-detect Curve from Token CA if not set or different
  try {
    const tokenContract = new ethers.Contract(currentConfig.tokenAddress, ERC20_ABI, wallet);
    const resolvedCurve = await tokenContract.curve();
    if (resolvedCurve && ethers.isAddress(resolvedCurve) && resolvedCurve !== ethers.ZeroAddress) {
      if (currentConfig.curveAddress.toLowerCase() !== resolvedCurve.toLowerCase()) {
        addLog("info", `[AUTO-SYNC] Connected to detected Pons Curve: ${resolvedCurve}`);
        currentConfig.curveAddress = resolvedCurve;
        botState.curveAddress = resolvedCurve;
        saveConfigToFile({ curveAddress: resolvedCurve });
      }
    }
  } catch (e: any) {
    // Skip if curve query error
  }

  if (!isValidAddress(currentConfig.curveAddress)) {
    botState.status = "standby";
    addLog("warn", "STANDBY: Curve Address is not valid yet.");
    return;
  }

  if (BURN_ONLY) {
    isExecuting = true;
    try {
      const feeEscrow = new ethers.Contract(PONS_FEE_ESCROW, ESCROW_ABI, wallet);
      const token = new ethers.Contract(currentConfig.tokenAddress, ERC20_ABI, wallet);
      botState.escrowBalanceETH = ethers.formatEther(await feeEscrow.balanceOf(wallet.address));
      botState.lastCycleTime = new Date().toLocaleTimeString();

      const tokenBalance: bigint = await token.balanceOf(wallet.address);
      const tokenSymbol = await token.symbol().catch(() => "TOKEN");
      if (tokenBalance > 0n) {
        botState.status = "burning";
        const formattedBalance = ethers.formatUnits(tokenBalance, 18);
        addLog("info", `[BURN-ONLY] Burning ${formattedBalance} $${tokenSymbol} to DEAD_ADDRESS...`);
        const burnNonce = await provider.getTransactionCount(wallet.address, "latest");
        const burnTx = await token.transfer(DEAD_ADDRESS, tokenBalance, { nonce: burnNonce });
        addLog("info", `Burn Tx broadcasted: ${burnTx.hash}`);
        await burnTx.wait();
        addLog("success", `COMPLETED: ${formattedBalance} $${tokenSymbol} PERMANENTLY INCINERATED!`);
      } else if (Date.now() - lastBurnOnlyIdleLog > 60_000) {
        lastBurnOnlyIdleLog = Date.now();
        addLog("info", `[BURN-ONLY] Claim and buyback are off. Waiting for $${tokenSymbol} in the operator wallet to burn. Escrow (claim manually on Pons): ${botState.escrowBalanceETH} ETH`);
      }
    } catch (err: any) {
      addLog("error", `[BURN-ONLY] ${err.message || err}`);
    } finally {
      isExecuting = false;
      botState.status = "standby";
    }
    return;
  }

  if (CYCLE_MODE === "split") {
    isExecuting = true;
    try {
      await runSplit();
    } catch (err: any) {
      addLog("error", `Run error: ${err.shortMessage || err.message || err}`);
    } finally {
      isExecuting = false;
      botState.status = "standby";
    }
    return;
  }

  // Alternating cycle calculation
  // Odd cycle (1, 3, 5...): 0.01 ETH -> Claim -> Buyback -> Burn
  // Even cycle (2, 4, 6...): 0.02 ETH -> Claim -> Keep (retained in wallet)
  const currentCycleNum = botState.totalCyclesExecuted + 1;
  const isBurnCycle = currentCycleNum % 2 === 1;
  const cycleType = isBurnCycle ? "BURN" : "KEEP";
  const cycleThresholdETH = isBurnCycle ? "0.01" : "0.02";

  currentConfig.claimThresholdETH = cycleThresholdETH;
  botState.claimThresholdETH = cycleThresholdETH;

  isExecuting = true;
  botState.status = "active";

  try {
    const feeEscrow = new ethers.Contract(PONS_FEE_ESCROW, ESCROW_ABI, wallet);
    const curve = new ethers.Contract(currentConfig.curveAddress, CURVE_ABI, wallet);
    const token = new ethers.Contract(currentConfig.tokenAddress, ERC20_ABI, wallet);

    // Check Fee Escrow, sweeping the curve's fees into it first when it is short
    let claimableWei: bigint = await feeEscrow.balanceOf(wallet.address);
    const thresholdWeiNow = ethers.parseEther(cycleThresholdETH);
    if (!pending && claimableWei < thresholdWeiNow && Date.now() - lastSweep >= SWEEP_INTERVAL_MS) {
      lastSweep = Date.now();
      try {
        const sweepTx = await curve.sweepFees(0n, { nonce: await nextNonce() });
        const rc = await sweepTx.wait();
        if (!rc || rc.status !== 1) throw new Error(`sweep ${sweepTx.hash} failed`);
        const after: bigint = await feeEscrow.balanceOf(wallet.address);
        if (after > claimableWei) addLog("info", `[SWEEP] Moved ${ethers.formatEther(after - claimableWei)} ETH of curve fees into the escrow. Tx: ${sweepTx.hash}`);
        claimableWei = after;
      } catch (e: any) {
        addLog("warn", `[SWEEP] Could not sweep curve fees (only the token creator can): ${e.shortMessage || e.message}`);
      }
    }
    const claimableETH = ethers.formatEther(claimableWei);
    botState.escrowBalanceETH = claimableETH;
    botState.lastCycleTime = new Date().toLocaleTimeString();

    if (isBurnCycle) {
      addLog("info", `[Cycle #${currentCycleNum} - BURN] Escrow Fee: ${claimableETH} ETH (Target: ${cycleThresholdETH} ETH)`);
    } else {
      addLog("info", `[Cycle #${currentCycleNum} - KEEP] Escrow Fee: ${claimableETH} ETH (Target: ${cycleThresholdETH} ETH)`);
    }

    const thresholdWei = ethers.parseEther(cycleThresholdETH);
    const gasBuffer = ethers.parseEther("0.0008");

    // FIX: Eksekusi HANYA dipicu saat ada fee di Escrow yang mencapai threshold!
    // Jangan gunakan saldo wallet untuk memicu eksekusi, agar dana KEEP dan cadangan gas tidak terpicu buyback sendiri.
    const shouldExecute = claimableWei >= thresholdWei && claimableWei > 0n;

    // A run is saved after every step (bot-run.json), so a crash or restart picks the same run
    // back up: nothing is claimed or bought twice and claimed ETH is never left behind.
    if (!pending) {
      if (!shouldExecute) return;
      const tokensBefore: bigint = await token.balanceOf(wallet.address);
      savePending({ cycle: currentCycleNum, kind: isBurnCycle ? "burn" : "keep", claimWei: claimableWei.toString(), tokensBefore: tokensBefore.toString() });
      addLog("success", `[Cycle #${currentCycleNum} - ${cycleType}] THRESHOLD REACHED (Claimable: ${claimableETH} ETH, Target: ${cycleThresholdETH} ETH). Executing cycle...`);
    } else if (pending.cycle !== currentCycleNum) {
      addLog("warn", `Dropping a saved run for cycle #${pending.cycle}: the bot is on cycle #${currentCycleNum}.`);
      savePending(null);
      return;
    } else {
      addLog("info", `[Cycle #${currentCycleNum} - ${cycleType}] Resuming the saved run...`);
    }
    const run = pending!;

    // 1. CLAIM (Klaim fee dari Escrow ke operator wallet)
    if (!run.claimed && run.claimTx) {
      const settled = await settle(run.claimTx);
      if (settled) run.claimed = true;
      else delete run.claimTx;
      savePending(run);
    }
    if (!run.claimed) {
      const escrowNow: bigint = await feeEscrow.balanceOf(wallet.address);
      if (escrowNow === 0n) {
        addLog("warn", `[1/3] The escrow is empty (claimed outside the bot?). Run #${run.cycle} dropped.`);
        savePending(null);
        return;
      }
      run.claimWei = escrowNow.toString();
      botState.status = "claiming";
      addLog("info", `[1/3] Claiming ${ethers.formatEther(escrowNow)} ETH from Pons Fee Escrow...`);
      const claimTx = await feeEscrow.claim({ nonce: await nextNonce() });
      run.claimTx = claimTx.hash;
      savePending(run);
      addLog("info", `Claim Tx broadcasted: ${claimTx.hash}`);
      const rc = await claimTx.wait();
      if (!rc || rc.status !== 1) throw new Error(`claim ${claimTx.hash} failed`);
      run.claimed = true;
      savePending(run);
      addLog("success", `Fee ${ethers.formatEther(escrowNow)} ETH successfully claimed to operator wallet!`);
    }
    const claimWei = BigInt(run.claimWei);
    const claimedVal = parseFloat(ethers.formatEther(claimWei)) || 0;
    if (!run.counted) {
      botState.totalFeesClaimedETH = (parseFloat(botState.totalFeesClaimedETH || "0.0") + claimedVal).toFixed(4);
      run.counted = true;
      savePending(run);
    }
    botState.escrowBalanceETH = "0.0";

    if (run.kind === "burn") {
      // ODD CYCLE: Buyback & Burn
      if (!run.bought && run.buyTx) {
        const settled = await settle(run.buyTx);
        if (settled) run.bought = true;
        else delete run.buyTx;
        savePending(run);
      }
      if (!run.bought) {
        botState.status = "buyback";
        const isGraduated = await curve.graduated().catch(() => false);
        const walletBal = await provider.getBalance(wallet.address);
        const maxSpendable = walletBal > gasBuffer ? walletBal - gasBuffer : 0n;
        // Only what this run claimed is spent, never the rest of the wallet
        const buyAmountWei = claimWei < maxSpendable ? claimWei : maxSpendable;
        if (buyAmountWei <= 0n) {
          addLog("warn", "[2/3] Insufficient wallet balance for buyback after gas buffer. Will retry.");
          return;
        }
        let buyTx: ethers.TransactionResponse;
        if (isGraduated && !v4Pool) {
          v4Pool = await findGraduationPool(provider, currentConfig.tokenAddress, currentConfig.curveAddress);
          if (!v4Pool) throw new Error("The curve graduated but its Uniswap v4 pool isn't found yet; retrying.");
          addLog("info", `Uniswap v4 pool found: fee ${v4Pool.fee}, tick spacing ${v4Pool.tickSpacing}, hook ${v4Pool.hooks}`);
        }
        if (isGraduated) {
          addLog("info", `[2/3] Token has graduated! Executing Buyback on Uniswap v4 Router (${ethers.formatEther(buyAmountWei)} ETH)...`);
          buyTx = await wallet.sendTransaction({
            to: UNISWAP_V4_UNIVERSAL_ROUTER,
            value: buyAmountWei,
            data: buildUniswapV4Buy(currentConfig.tokenAddress, buyAmountWei, v4Pool!),
            gasLimit: 400000n,
            nonce: await nextNonce()
          });
        } else {
          addLog("info", `[2/3] Token on Bonding Curve. Executing Buyback on Curve DEX (${ethers.formatEther(buyAmountWei)} ETH)...`);
          buyTx = await curve.buy(buyAmountWei, 0n, wallet.address, { value: buyAmountWei, nonce: await nextNonce() });
        }
        run.buyTx = buyTx.hash;
        savePending(run);
        addLog("info", `Buyback Tx broadcasted: ${buyTx.hash}`);
        const rc = await buyTx.wait();
        if (!rc || rc.status !== 1) throw new Error(`buy ${buyTx.hash} failed`);
        run.bought = true;
        savePending(run);
        addLog("success", `Buyback succeeded (${ethers.formatEther(buyAmountWei)} ETH)!`);
      }

      // 3. BURN exactly what this run bought; whatever was already in the wallet stays
      if (!run.burned && run.burnTx) {
        const settled = await settle(run.burnTx);
        if (settled) run.burned = true;
        else delete run.burnTx;
        savePending(run);
      }
      if (!run.burned) {
        botState.status = "burning";
        const tokenSymbol = await token.symbol().catch(() => "TOKEN");
        const tokenBalance: bigint = await token.balanceOf(wallet.address);
        const before = BigInt(run.tokensBefore);
        const toBurn = tokenBalance > before ? tokenBalance - before : 0n;
        const formatted = ethers.formatUnits(toBurn, 18);
        if (toBurn > 0n) {
          addLog("info", `[3/3] Burning ${formatted} $${tokenSymbol} to DEAD_ADDRESS...`);
          const burnTx = await token.transfer(DEAD_ADDRESS, toBurn, { nonce: await nextNonce() });
          run.burnTx = burnTx.hash;
          savePending(run);
          addLog("info", `Burn Tx broadcasted: ${burnTx.hash}`);
          const rc = await burnTx.wait();
          if (!rc || rc.status !== 1) throw new Error(`burn ${burnTx.hash} failed`);
          addLog("success", `COMPLETED: ${formatted} $${tokenSymbol} PERMANENTLY INCINERATED!`);
        } else {
          addLog("warn", `[3/3] No newly bought $${tokenSymbol} to burn.`);
        }
        run.burned = true;
        savePending(run);
      }
    } else {
      // EVEN CYCLE: KEEP (forwarded to the treasury address, or kept in the operator wallet)
      const toTreasury = isValidAddress(currentConfig.treasuryAddress) && currentConfig.treasuryAddress.toLowerCase() !== wallet.address.toLowerCase();
      if (toTreasury && !run.sent && run.sendTx) {
        const settled = await settle(run.sendTx);
        if (settled) run.sent = true;
        else delete run.sendTx;
        savePending(run);
      }
      if (toTreasury && !run.sent) {
        addLog("info", `[2/2 - KEEP] Forwarding ${ethers.formatEther(claimWei)} ETH to Treasury: ${currentConfig.treasuryAddress}...`);
        const transferGasBuffer = ethers.parseEther("0.0003");
        const currentBal = await provider.getBalance(wallet.address);
        let sendWei = claimWei;
        if (currentBal - sendWei < transferGasBuffer) {
          sendWei = currentBal > transferGasBuffer ? currentBal - transferGasBuffer : 0n;
        }
        if (sendWei > 0n) {
          const sendTx = await wallet.sendTransaction({ to: currentConfig.treasuryAddress, value: sendWei, nonce: await nextNonce() });
          run.sendTx = sendTx.hash;
          savePending(run);
          const rc = await sendTx.wait();
          if (!rc || rc.status !== 1) throw new Error(`treasury send ${sendTx.hash} failed`);
          addLog("success", `[KEEP] Successfully forwarded ${ethers.formatEther(sendWei)} ETH to Treasury! Tx: ${sendTx.hash}`);
        }
        run.sent = true;
        savePending(run);
      } else if (!toTreasury) {
        addLog("success", `[2/2 - KEEP] ${ethers.formatEther(claimWei)} ETH successfully kept in operator wallet (will not be touched by buyback).`);
      }
      botState.totalFeesRetainedETH = (parseFloat(botState.totalFeesRetainedETH || "0.0") + claimedVal).toFixed(4);
    }

    botState.totalCyclesExecuted++;
    saveConfigToFile({ cycleCount: botState.totalCyclesExecuted });
    savePending(null);
  } catch (err: any) {
    addLog("error", `Cycle execution error: ${err.message || err}`);
  } finally {
    isExecuting = false;
    botState.status = "standby";
  }
}


/* ───────── SPLIT mode ───────── */

async function runSplit() {
  const feeEscrow = new ethers.Contract(PONS_FEE_ESCROW, ESCROW_ABI, wallet!);
  const curve = new ethers.Contract(currentConfig.curveAddress, CURVE_ABI, wallet!);
  const token = new ethers.Contract(currentConfig.tokenAddress, ERC20_ABI, wallet!);
  const thresholdWei = ethers.parseEther(currentConfig.claimThresholdETH || "0.01");
  botState.claimThresholdETH = ethers.formatEther(thresholdWei);

  // Never dip into the gas reserve
  const gasBal = await provider!.getBalance(wallet!.address);
  if (gasBal < GAS_RESERVE_WEI) {
    if (Date.now() - lastGasWarn > 10 * 60_000) {
      lastGasWarn = Date.now();
      addLog("error", `[GAS] The operator wallet has ${ethers.formatEther(gasBal)} ETH, below the ${ethers.formatEther(GAS_RESERVE_WEI)} ETH gas reserve. Top it up; the bot waits until then.`);
    }
    return;
  }

  // Finish whatever was in flight before a restart
  if (pending?.kind === "split") return finishClaim(feeEscrow, pending);
  if (pending?.kind === "drip") return finishDrip(curve, token, pending);
  if (pending) {
    addLog("warn", `Dropping a saved ${pending.kind} run: the bot runs in split mode now.`);
    savePending(null);
  }

  let owed: bigint = await feeEscrow.balanceOf(wallet!.address);

  // Pull the curve's fees into the escrow, only when there has been trading since the last sweep
  const curveEth = await provider!.getBalance(currentConfig.curveAddress);
  const graduated: boolean = await curve.graduated().catch(() => false);
  const quoteNow = graduated ? 0n : ((await curve.getReserves().catch(() => [0n]))[0] as bigint);
  const unswept = !graduated && curveBaseline !== null && curveEth - quoteNow > curveBaseline ? curveEth - quoteNow - curveBaseline : 0n;
  if (owed < thresholdWei && Date.now() - lastSweep >= SWEEP_INTERVAL_MS && curveEth !== curveEthAtSweep) {
    lastSweep = Date.now();
    try {
      const tx = await curve.sweepFees(0n, { nonce: await nextNonce() });
      const rc = await tx.wait();
      if (!rc || rc.status !== 1) throw new Error(`sweep ${tx.hash} failed`);
      curveEthAtSweep = await provider!.getBalance(currentConfig.curveAddress);
      const after: bigint = await feeEscrow.balanceOf(wallet!.address);
      if (after > owed) addLog("info", `[SWEEP] Moved ${ethers.formatEther(after - owed)} ETH of curve fees into the escrow. Tx: ${tx.hash}`);
      if (unswept > 0n && after > owed) {
        const share = ((after - owed) * 10_000n) / unswept;
        if (share > 0n && share <= 10_000n) creatorShareBps = share;
      }
      if (!graduated) {
        const [q] = (await curve.getReserves()) as [bigint, bigint];
        curveBaseline = curveEthAtSweep - q;
      }
      pendingCreatorWei = 0n;
      owed = after;
    } catch (e: any) {
      curveEthAtSweep = curveEth;
      addLog("warn", `[SWEEP] Could not sweep curve fees (only the token creator can): ${e.shortMessage || e.message}`);
    }
  }
  else pendingCreatorWei = (unswept * creatorShareBps) / 10_000n;
  botState.escrowBalanceETH = ethers.formatEther(owed);
  botState.lastCycleTime = new Date().toLocaleTimeString();
  lastSyncAt = Date.now();

  // 1. Claim and split
  if (owed >= thresholdWei) {
    const run: PendingRun = { cycle: ledger.claims + 1, kind: "split", claimWei: owed.toString(), wageWei: wageOf(owed).toString(), tokensBefore: "0" };
    savePending(run);
    addLog("success", `[CLAIM #${run.cycle}] ${ethers.formatEther(owed)} ETH in the escrow. Split: ${BURN_SHARE_PCT}% burn, ${100 - BURN_SHARE_PCT}% wages.`);
    return finishClaim(feeEscrow, run);
  }

  // 2. Spend the burn budget a little at a time
  const budget = BigInt(ledger.burnBudgetWei);
  if (budget >= MIN_BUY_WEI && Date.now() - lastBuy >= BUY_SPACING_MS) {
    const spend = budget < MAX_BUY_WEI ? budget : MAX_BUY_WEI;
    const tokensBefore: bigint = await token.balanceOf(wallet!.address);
    const run: PendingRun = { cycle: ledger.burns + 1, kind: "drip", claimWei: "0", buyWei: spend.toString(), tokensBefore: tokensBefore.toString() };
    savePending(run);
    return finishDrip(curve, token, run);
  }
}

async function finishClaim(feeEscrow: ethers.Contract, run: PendingRun) {
  if (!run.claimed && run.claimTx) {
    if (await settle(run.claimTx)) run.claimed = true;
    else delete run.claimTx;
    savePending(run);
  }
  if (!run.claimed) {
    const now: bigint = await feeEscrow.balanceOf(wallet!.address);
    if (now === 0n) {
      addLog("warn", `[CLAIM #${run.cycle}] The escrow is empty (claimed outside the bot?). Run dropped.`);
      return savePending(null);
    }
    run.claimWei = now.toString();
    run.wageWei = wageOf(now).toString();
    botState.status = "claiming";
    const tx = await feeEscrow.claim({ nonce: await nextNonce() });
    run.claimTx = tx.hash;
    savePending(run);
    addLog("info", `[CLAIM #${run.cycle}] Claim Tx broadcasted: ${tx.hash}`);
    const rc = await tx.wait();
    if (!rc || rc.status !== 1) throw new Error(`claim ${tx.hash} failed`);
    run.claimed = true;
    savePending(run);
  }
  const claimWei = BigInt(run.claimWei);
  const wageWei = BigInt(run.wageWei || "0");

  // The burn share goes on the books first, exactly once
  if (!run.budgeted) {
    book("totalClaimedWei", claimWei);
    book("burnBudgetWei", claimWei - wageWei);
    book("totalWagesWei", wageWei);
    ledger.claims += 1;
    run.budgeted = true;
    saveLedger();
    savePending(run);
  }

  // Wages to the treasury; with no separate treasury they simply stay in the operator wallet
  const toTreasury = isValidAddress(currentConfig.treasuryAddress) && currentConfig.treasuryAddress.toLowerCase() !== wallet!.address.toLowerCase();
  if (wageWei > 0n && toTreasury && !run.sent) {
    if (run.sendTx) {
      if (await settle(run.sendTx)) run.sent = true;
      else delete run.sendTx;
      savePending(run);
    }
    if (!run.sent) {
      const tx = await wallet!.sendTransaction({ to: currentConfig.treasuryAddress, value: wageWei, nonce: await nextNonce() });
      run.sendTx = tx.hash;
      savePending(run);
      const rc = await tx.wait();
      if (!rc || rc.status !== 1) throw new Error(`wages ${tx.hash} failed`);
      run.sent = true;
      savePending(run);
      addLog("success", `[WAGES] Sent ${ethers.formatEther(wageWei)} ETH to the treasury ${currentConfig.treasuryAddress}. Tx: ${tx.hash}`);
    }
  }
  botState.totalFeesClaimedETH = ethers.formatEther(BigInt(ledger.totalClaimedWei));
  botState.totalFeesRetainedETH = ethers.formatEther(BigInt(ledger.totalWagesWei));
  botState.totalCyclesExecuted = ledger.claims;
  saveConfigToFile({ cycleCount: ledger.claims });
  addLog("success", `[CLAIM #${run.cycle}] Done. Burn budget now ${ethers.formatEther(BigInt(ledger.burnBudgetWei))} ETH.`);
  savePending(null);
}

async function finishDrip(curve: ethers.Contract, token: ethers.Contract, run: PendingRun) {
  const buyWei = BigInt(run.buyWei || "0");
  if (!run.bought && run.buyTx) {
    if (await settle(run.buyTx)) run.bought = true;
    else delete run.buyTx;
    savePending(run);
  }
  if (!run.bought) {
    botState.status = "buyback";
    const bal = await provider!.getBalance(wallet!.address);
    if (bal < buyWei + GAS_RESERVE_WEI) {
      addLog("error", `[BUY #${run.cycle}] The wallet holds ${ethers.formatEther(bal)} ETH, short of a ${ethers.formatEther(buyWei)} ETH buy plus the gas reserve. Waiting for a top-up.`);
      lastBuy = Date.now();
      return savePending(null);
    }
    const isGraduated = await curve.graduated().catch(() => false);
    let tx: ethers.TransactionResponse;
    if (isGraduated) {
      if (!v4Pool) {
        v4Pool = await findGraduationPool(provider!, currentConfig.tokenAddress, currentConfig.curveAddress);
        if (!v4Pool) throw new Error("The curve graduated but its Uniswap v4 pool isn't found yet; retrying.");
      }
      const quote = await quoteUniswapV4Buy(provider!, UNISWAP_V4_UNIVERSAL_ROUTER, wallet!.address, currentConfig.tokenAddress, buyWei, v4Pool);
      if (quote === 0n) throw new Error("The Uniswap v4 buy would fail right now; retrying later.");
      const minOut = (quote * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      addLog("info", `[BUY #${run.cycle}] ${ethers.formatEther(buyWei)} ETH on Uniswap v4, at least ${ethers.formatUnits(minOut, 18)} tokens.`);
      tx = await wallet!.sendTransaction({ to: UNISWAP_V4_UNIVERSAL_ROUTER, value: buyWei, data: buildUniswapV4Buy(currentConfig.tokenAddress, buyWei, v4Pool, 1800, minOut), gasLimit: 400000n, nonce: await nextNonce() });
    } else {
      const quote: bigint = await curve.buy.staticCall(buyWei, 0n, wallet!.address, { value: buyWei });
      const minOut = (quote * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      addLog("info", `[BUY #${run.cycle}] ${ethers.formatEther(buyWei)} ETH on the curve, at least ${ethers.formatUnits(minOut, 18)} tokens.`);
      tx = await curve.buy(buyWei, minOut, wallet!.address, { value: buyWei, nonce: await nextNonce() });
    }
    run.buyTx = tx.hash;
    savePending(run);
    lastBuy = Date.now();
    const rc = await tx.wait().catch(() => null);
    if (!rc || rc.status !== 1) {
      // nothing was spent but gas; the budget is untouched and the next buy tries again
      savePending(null);
      throw new Error(`buy ${tx.hash} reverted (price moved past the ${Number(SLIPPAGE_BPS) / 100}% slippage limit?)`);
    }
    run.bought = true;
    savePending(run);
  }
  if (!run.debited) {
    book("burnBudgetWei", -buyWei);
    book("totalBurnSpentWei", buyWei);
    run.debited = true;
    saveLedger();
    savePending(run);
  }

  // Bury exactly what this buy brought in; the dev bag stays where it is
  if (!run.burned && run.burnTx) {
    if (await settle(run.burnTx)) run.burned = true;
    else delete run.burnTx;
    savePending(run);
  }
  if (!run.burned) {
    botState.status = "burning";
    const now: bigint = await token.balanceOf(wallet!.address);
    const toBurn = now > BigInt(run.tokensBefore) ? now - BigInt(run.tokensBefore) : 0n;
    const symbol = await token.symbol().catch(() => "TOKEN");
    if (toBurn > 0n) {
      const tx = await token.transfer(DEAD_ADDRESS, toBurn, { nonce: await nextNonce() });
      run.burnTx = tx.hash;
      savePending(run);
      const rc = await tx.wait();
      if (!rc || rc.status !== 1) throw new Error(`burn ${tx.hash} failed`);
      book("totalTokensBurnedWei", toBurn);
      addLog("success", `[BURN #${run.cycle}] ${ethers.formatUnits(toBurn, 18)} $${symbol} PERMANENTLY BURIED at 0x…dEaD for ${ethers.formatEther(buyWei)} ETH. Buy: ${run.buyTx} Burn: ${tx.hash}`);
    }
    run.burned = true;
    ledger.burns += 1;
    saveLedger();
  }
  savePending(null);
}

// Loop berulang
setInterval(() => {
  executeCycle().catch((e) => addLog("error", `Loop error: ${e.message}`));
}, currentConfig.pollIntervalSeconds * 1000);

// Pengecekan pertama kali jalan
executeCycle().catch(console.error);

// -------------------------------------------------------------
// NATIVE HTTP API SERVER (Untuk komunikasi langsung dengan /memex)
// -------------------------------------------------------------
function sendJSON(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-secret"
  });
  res.end(JSON.stringify(data));
}

const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const SITE_DIR = process.env.SITE_DIR ? path.resolve(process.cwd(), process.env.SITE_DIR) : "";
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ico": "image/x-icon"
};

function serveStatic(url: string, res: http.ServerResponse) {
  let rel: string;
  try {
    rel = decodeURIComponent(url.split("?")[0]);
  } catch {
    return sendJSON(res, 400, { success: false, error: "Bad path" });
  }
  let file = path.resolve(SITE_DIR, "." + rel);
  if (file !== SITE_DIR && !file.startsWith(SITE_DIR + path.sep)) return sendJSON(res, 404, { success: false, error: "Not Found" });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(SITE_DIR, "index.html"); // SPA fallback
  res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-secret"
    });
    res.end();
    return;
  }

  const url = req.url || "/";

  // Static site (e.g. the archived graveburn build), served from the same port as the API
  if (req.method === "GET" && SITE_DIR && !url.startsWith("/api/")) {
    return serveStatic(url, res);
  }

  // Endpoint 1: GET /api/status
  if (req.method === "GET" && (url === "/api/status" || url === "/api/status/")) {
    return sendJSON(res, 200, {
      success: true,
      data: {
        online: true,
        status: botState.status,
        walletAddress: botState.walletAddress,
        tokenAddress: currentConfig.tokenAddress,
        curveAddress: currentConfig.curveAddress,
        treasuryAddress: currentConfig.treasuryAddress,
        claimThresholdETH: currentConfig.claimThresholdETH,
        escrowBalanceETH: botState.escrowBalanceETH,
        totalFeesClaimedETH: botState.totalFeesClaimedETH,
        totalFeesRetainedETH: botState.totalFeesRetainedETH,
        totalCyclesExecuted: botState.totalCyclesExecuted,
        nextCycleType: CYCLE_MODE === "split" ? "burn" : (botState.totalCyclesExecuted + 1) % 2 === 1 ? "burn" : "keep",
        cycleMode: CYCLE_MODE,
        burnSharePct: CYCLE_MODE === "split" ? BURN_SHARE_PCT : null,
        maxBuyETH: ethers.formatEther(MAX_BUY_WEI),
        burnBudgetETH: ethers.formatEther(BigInt(ledger.burnBudgetWei)),
        totalBurnSpentETH: ethers.formatEther(BigInt(ledger.totalBurnSpentWei)),
        totalWagesETH: ethers.formatEther(BigInt(ledger.totalWagesWei)),
        totalTokensBurned: ethers.formatUnits(BigInt(ledger.totalTokensBurnedWei), 18),
        // estimate of the creator fees still in the curve (swept into the escrow every few minutes)
        pendingFeesETH: ethers.formatEther(pendingCreatorWei),
        lastSyncAt,
        lastCycleTime: botState.lastCycleTime,
        pollIntervalSeconds: currentConfig.pollIntervalSeconds,
        logs: botState.logs
      }
    });
  }

  // Endpoint 2: POST /api/config atau POST /api/admin/save
  if (req.method === "POST" && (url === "/api/config" || url === "/api/admin/save" || url === "/api/config/")) {
    // Changing the token, treasury or key redirects where claimed ETH goes, so it needs the secret
    if (!ADMIN_SECRET || req.headers["x-admin-secret"] !== ADMIN_SECRET) {
      return sendJSON(res, 403, { success: false, error: ADMIN_SECRET ? "Forbidden" : "Config API disabled (ADMIN_SECRET not set)" });
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        let updated = false;

        if (data.tokenAddress !== undefined) {
          const cleanToken = data.tokenAddress.trim();
          currentConfig.tokenAddress = cleanToken;
          updated = true;
          addLog("info", `[CONFIG] Token Address diperbarui dari /memex: ${cleanToken || "Dikosongkan"}`);
        }

        if (data.treasuryAddress !== undefined) {
          const cleanTreasury = data.treasuryAddress.trim();
          currentConfig.treasuryAddress = cleanTreasury;
          updated = true;
          addLog("info", `[CONFIG] Treasury Address diperbarui: ${cleanTreasury || "Dikosongkan"}`);
        }

        if (data.privateKey !== undefined && data.privateKey !== "") {
          return sendJSON(res, 400, { success: false, error: "The operator key is set in .env (CREATOR_PRIVATE_KEY) only, never over HTTP." });
        }

        if (updated) {
          saveConfigToFile({
            tokenAddress: currentConfig.tokenAddress,
            treasuryAddress: currentConfig.treasuryAddress
          });
        }

        return sendJSON(res, 200, {
          success: true,
          message: "Konfigurasi bot berhasil diperbarui",
          tokenAddress: currentConfig.tokenAddress,
          treasuryAddress: currentConfig.treasuryAddress,
          walletAddress: botState.walletAddress
        });
      } catch (err: any) {
        return sendJSON(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // Tolak route lain
  return sendJSON(res, 404, { success: false, error: "Not Found" });
});

const PORT = currentConfig.port || 5015;

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[API] Port ${PORT} sedang dipakai. Mencoba port ${PORT + 1}...`);
    try {
      server.listen(PORT + 1, currentConfig.host);
    } catch (e) {
      console.warn("API server dialihkan, proses bot tetap berjalan.");
    }
  } else {
    console.error("[API Error]:", err.message);
  }
});

server.listen(PORT, currentConfig.host, () => {
  console.log("==========================================================");
  console.log(`BLAZE AUTONOMOUS BURN ENGINE & API SERVER ACTIVE`);
  console.log(`   Server Port      : ${PORT}`);
  console.log(`   Status API       : http://${currentConfig.host}:${PORT}/api/status`);
  console.log(`   Config API       : ${ADMIN_SECRET ? "enabled (x-admin-secret)" : "disabled (ADMIN_SECRET not set)"}`);
  if (SITE_DIR) console.log(`   Site             : ${SITE_DIR}`);
  console.log(`   Operator Wallet  : ${botState.walletAddress || "Not ready"}`);
  console.log(`   Initial Status   : ${isValidAddress(currentConfig.tokenAddress) ? "ACTIVE" : "STANDBY (Awaiting CA from /memex)"}`);
  console.log("==========================================================");
});
