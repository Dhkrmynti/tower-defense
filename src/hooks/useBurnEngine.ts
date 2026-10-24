import { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { EnginePhase, FlywheelState, ActivityLog, MachineConfig, BurnLedgerEntry } from '../types';
import { PONS_V2_CONFIG } from '../contracts';
import { sounds } from '../utils/audio';
// ethers is the heaviest part of the page; it loads only once there is a token to read
const loadWeb3 = () => import('../utils/web3');

// Build-time fallback only. At runtime the bot (/api/status) is the source of truth,
// so a CA saved in /memex reaches every visitor without a rebuild.
export const OFFICIAL_TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || '';
export const OFFICIAL_CURVE_ADDRESS = import.meta.env.VITE_CURVE_ADDRESS || '';
export const OFFICIAL_CREATOR_ADDRESS = import.meta.env.VITE_CREATOR_ADDRESS || '';
export const OFFICIAL_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';

const ENV_CYCLE_INTERVAL = parseInt(import.meta.env.VITE_CYCLE_INTERVAL_SECONDS || '300', 10);
const ENV_TOKEN_NAME = import.meta.env.VITE_TOKEN_NAME || 'BASTION';
const ENV_TOKEN_SYMBOL = import.meta.env.VITE_TOKEN_SYMBOL || 'BASTION';
const ENV_CLAIM_THRESHOLD = parseFloat(import.meta.env.VITE_CLAIM_THRESHOLD_ETH || '0.01');

export const INITIAL_CONFIG: MachineConfig = {
  networkName: 'Robinhood Chain',
  chainId: PONS_V2_CONFIG.chainId,
  rpcUrl: OFFICIAL_RPC_URL,
  tokenName: ENV_TOKEN_NAME,
  tokenSymbol: ENV_TOKEN_SYMBOL,
  tokenAddress: OFFICIAL_TOKEN_ADDRESS,
  curveAddress: OFFICIAL_CURVE_ADDRESS,
  factoryAddress: PONS_V2_CONFIG.contracts.factory,
  feeEscrowAddress: PONS_V2_CONFIG.contracts.feeEscrow,
  deadAddress: PONS_V2_CONFIG.contracts.deadAddress,
  creatorAddress: OFFICIAL_CREATOR_ADDRESS,
  claimThresholdETH: ENV_CLAIM_THRESHOLD,
  slippageBps: 200,
  cycleIntervalSeconds: ENV_CYCLE_INTERVAL,
  soundEnabled: true,
};

export const isConfiguredAddress = (addr?: string): boolean => {
  if (!addr) return false;
  const cleaned = addr.trim().toLowerCase();
  if (cleaned === 'none' || cleaned === '' || cleaned === '0x...') return false;
  return cleaned.startsWith('0x') && cleaned.length === 42;
};

const getStoredConfig = (): MachineConfig => ({ ...INITIAL_CONFIG });

const getInitialState = (cfg: MachineConfig): FlywheelState => {
  return {
    isWheelSpinning: false,
    currentPhase: 'accumulate',
    phaseProgress: 0,
    cycleCount: 0,
    nextCycleType: 'burn',
    currentThresholdETH: 0.01,
    isTokenMigrated: false,
    swapRouter: 'curve',
    totalFeesClaimedETH: 0,
    totalFeesClaimedUSD: 0,
    totalFeesRetainedETH: 0,
    totalTokensBoughtBack: 0,
    totalTokensBurned: 0,
    burnedPercentageOfSupply: 0,
    currentEscrowBalanceETH: 0,
    claimThresholdETH: 0.01,
    tokenPriceETH: 0,
    tokenPriceUSD: 0,
    marketCapUSD: 0,
    totalSupply: 1_000_000_000,
    deadAddressBalance: 0,
    lastActionText: 'Engine Ready: Waiting for token deployment and first volume cycle.',
    connectedWallet: null,
    isOnChainMode: true,
  };
};

const getInitialLogs = (cfg: MachineConfig): ActivityLog[] => {
  try {
    const stored = localStorage.getItem('jollyburn_activity_logs') || localStorage.getItem('museburn_activity_logs') || localStorage.getItem('incinerator_activity_logs');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    // ignore
  }
  return [];
};

const getInitialLedger = (): BurnLedgerEntry[] => {
  try {
    const stored = localStorage.getItem('jollyburn_burn_ledger') || localStorage.getItem('museburn_burn_ledger') || localStorage.getItem('incinerator_burn_ledger');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    // ignore
  }
  return [];
};

const RANDOM_TX_HASH = () =>
  '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export function useFlywheelEngine() {
  const [config, setConfigState] = useState<MachineConfig>(getStoredConfig);

  const setConfig = useCallback((newConfig: MachineConfig | ((prev: MachineConfig) => MachineConfig)) => {
    setConfigState((prev) => {
      const resolved = typeof newConfig === 'function' ? newConfig(prev) : newConfig;

      // If token address was changed to none or not valid, stop everything
      if (!isConfiguredAddress(resolved.tokenAddress)) {
        setState((st) => ({
          ...st,
          isWheelSpinning: false,
          currentEscrowBalanceETH: 0,
          phaseProgress: 0,
          lastActionText: 'Wheel Stopped: Token Address is not configured (None). Waiting for contract deployment.',
        }));
      }

      return resolved;
    });
  }, []);

  const resetConfigToDefaults = useCallback(() => {
    try {
      localStorage.removeItem('hot_flywheel_config');
      localStorage.removeItem('jevburn_flywheel_config');
      localStorage.removeItem('incinerator_engine_config');
      localStorage.removeItem('incinerator_activity_logs');
      localStorage.removeItem('incinerator_burn_ledger');
      localStorage.removeItem('museburn_engine_config');
      localStorage.removeItem('museburn_activity_logs');
      localStorage.removeItem('museburn_burn_ledger');
      localStorage.removeItem('jollyburn_engine_config');
      localStorage.removeItem('jollyburn_activity_logs');
      localStorage.removeItem('jollyburn_burn_ledger');
    } catch (e) {
      // ignore
    }
    setConfigState(INITIAL_CONFIG);
  }, []);

  const [state, setState] = useState<FlywheelState>(() => getInitialState(config));
  const [logs, setLogs] = useState<ActivityLog[]>(() => getInitialLogs(config));
  const [burnLedger, setBurnLedger] = useState<BurnLedgerEntry[]>(getInitialLedger);

  // Helper to update and persist logs to localStorage
  const updateLogsWithStorage = useCallback((updater: ActivityLog[] | ((prev: ActivityLog[]) => ActivityLog[])) => {
    setLogs((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('jollyburn_activity_logs', JSON.stringify(next.slice(0, 80)));
      } catch (e) {}
      return next;
    });
  }, []);

  // Helper to update and persist burnLedger to localStorage
  const updateLedgerWithStorage = useCallback((updater: BurnLedgerEntry[] | ((prev: BurnLedgerEntry[]) => BurnLedgerEntry[])) => {
    setBurnLedger((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('jollyburn_burn_ledger', JSON.stringify(next.slice(0, 100)));
      } catch (e) {}
      return next;
    });
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;

  const configRef = useRef(config);
  configRef.current = config;

  const isExecutingRef = useRef(false);

  // Token CA and creator wallet come from the bot, so whatever is saved in /memex
  // shows up for every visitor. Falls back to build-time env when the bot is offline.
  useEffect(() => {
    let cancelled = false;

    const syncFromBot = async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.success || !json.data) return;
        const botToken: string = (json.data.tokenAddress || '').trim();
        const botWallet: string = (json.data.walletAddress || '').trim();
        const tokenAddress = isConfiguredAddress(botToken) ? botToken : OFFICIAL_TOKEN_ADDRESS;
        const creatorAddress = isConfiguredAddress(botWallet) ? botWallet : OFFICIAL_CREATOR_ADDRESS;
        setConfigState((prev) =>
          prev.tokenAddress === tokenAddress && prev.creatorAddress === creatorAddress
            ? prev
            : { ...prev, tokenAddress, creatorAddress }
        );
      } catch {
        // bot unreachable: keep current config
      }
    };

    syncFromBot();
    const interval = setInterval(syncFromBot, 5000);
    window.addEventListener('memex_config_updated', syncFromBot);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('memex_config_updated', syncFromBot);
    };
  }, []);

  // Add transaction log with deduplication protection and localStorage persistence
  const addLog = useCallback((log: Omit<ActivityLog, 'id' | 'timestamp'>) => {
    updateLogsWithStorage((prev) => {
      if (prev.length > 0 && prev[0].action === log.action && prev[0].details === log.details) {
        return prev;
      }
      const newEntry: ActivityLog = {
        ...log,
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      return [newEntry, ...prev.slice(0, 79)];
    });
  }, [updateLogsWithStorage]);

  // Poll real on-chain metrics & burn ledger automatically
  useEffect(() => {
    if (!isConfiguredAddress(config.tokenAddress)) return;

    let isCancelled = false;

    const syncOnChain = async () => {
      try {
        const { fetchFullOnChainMetrics, fetchOnChainBurnLedger } = await loadWeb3();
        const [metrics, ledgerRes] = await Promise.all([
          fetchFullOnChainMetrics(
            config.tokenAddress,
            config.curveAddress,
            config.creatorAddress,
            config.rpcUrl
          ),
          fetchOnChainBurnLedger(
            config.tokenAddress,
            config.curveAddress,
            config.creatorAddress,
            config.rpcUrl
          )
        ]);

        if (isCancelled) return;

        // If curve address was resolved to something different, update config
        if (metrics?.curveAddress && metrics.curveAddress.toLowerCase() !== config.curveAddress.toLowerCase()) {
          setConfig((prev) => ({ ...prev, curveAddress: metrics.curveAddress }));
        }

        if (ledgerRes && ledgerRes.entries && ledgerRes.entries.length > 0) {
          updateLedgerWithStorage(ledgerRes.entries);

          // Populate logs if empty so activity telemetry displays real on-chain actions
          updateLogsWithStorage((prevLogs) => {
            if (prevLogs.length === 0) {
              const seedLogs: ActivityLog[] = [];
              for (const entry of ledgerRes.entries.slice(0, 30)) {
                const burnedTokens = entry.burnedJollyburn || entry.burnedMuseburn || entry.burnedIncinerator || 0;
                seedLogs.push({
                  id: `burn-${entry.id}`,
                  timestamp: entry.timeStr.split(' (')[0],
                  phase: 'burn',
                  action: 'BURN TO DEAD',
                  details: `Permanently burned ${new Intl.NumberFormat('en-US').format(Math.round(burnedTokens))} tokens to 0x000...dEaD`,
                  txHash: entry.burnTx || entry.claimTx || '',
                  amountETH: entry.claimedETH,
                  amountToken: Math.round(burnedTokens),
                  status: 'success',
                  contractTarget: '0x000...dEaD'
                });
                if (entry.buyTx && entry.buyTx !== entry.burnTx) {
                  seedLogs.push({
                    id: `buy-${entry.id}`,
                    timestamp: entry.timeStr.split(' (')[0],
                    phase: 'buyback',
                    action: 'AUTO-BUYBACK',
                    details: `Swapped ${entry.claimedETH.toFixed(4)} ETH on DEX -> bought ${new Intl.NumberFormat('en-US').format(Math.round(burnedTokens))} tokens`,
                    txHash: entry.buyTx,
                    amountETH: entry.claimedETH,
                    amountToken: Math.round(burnedTokens),
                    status: 'success',
                    contractTarget: 'DEX.buy()'
                  });
                }
              }
              return seedLogs;
            }
            return prevLogs;
          });
        }

        setState((prev) => {
          const escrow = metrics ? metrics.escrowBalanceETH : prev.currentEscrowBalanceETH;
          const cycles = ledgerRes && ledgerRes.cycleCount > 0 ? ledgerRes.cycleCount : prev.cycleCount;
          const nextCycleNum = cycles + 1;
          const isNextBurn = nextCycleNum % 2 === 1;
          const nextCycleType = isNextBurn ? 'burn' : 'keep';
          const threshold = isNextBurn ? 0.01 : 0.02;
          const isMigrated = metrics ? metrics.isGraduated : prev.isTokenMigrated;
          const router = metrics ? metrics.swapRouter : (isMigrated ? 'uniswap' : 'curve');

          const progress = Math.min(100, Math.round((escrow / threshold) * 100));
          const totalClaimed = (metrics && metrics.totalFeesClaimedETH > 0)
            ? metrics.totalFeesClaimedETH
            : (ledgerRes && ledgerRes.totalClaimedETH > 0 ? ledgerRes.totalClaimedETH : prev.totalFeesClaimedETH);
          const totalBurned = (metrics && metrics.tokensBurned > 0)
            ? metrics.tokensBurned
            : (ledgerRes && ledgerRes.totalBurned > 0 ? ledgerRes.totalBurned : prev.totalTokensBurned);
          const supply = (metrics && metrics.totalSupply > 0) ? metrics.totalSupply : prev.totalSupply;
          const burnedPct = supply > 0 ? (totalBurned / supply) * 100 : prev.burnedPercentageOfSupply;

          return {
            ...prev,
            currentEscrowBalanceETH: escrow,
            cycleCount: cycles,
            nextCycleType,
            currentThresholdETH: threshold,
            claimThresholdETH: threshold,
            isTokenMigrated: isMigrated,
            swapRouter: router,
            totalFeesClaimedETH: totalClaimed,
            totalFeesClaimedUSD: totalClaimed * 2500,
            phaseProgress: prev.isWheelSpinning ? prev.phaseProgress : progress,
            totalTokensBurned: totalBurned,
            deadAddressBalance: totalBurned,
            totalTokensBoughtBack: totalBurned,
            burnedPercentageOfSupply: burnedPct,
            tokenPriceETH: (metrics && metrics.tokenPriceETH > 0) ? metrics.tokenPriceETH : prev.tokenPriceETH,
            tokenPriceUSD: (metrics && metrics.tokenPriceUSD > 0) ? metrics.tokenPriceUSD : prev.tokenPriceUSD,
            marketCapUSD: (metrics && metrics.marketCapUSD > 0) ? metrics.marketCapUSD : prev.marketCapUSD,
            totalSupply: supply,
            lastActionText: prev.isWheelSpinning
              ? prev.lastActionText
              : escrow >= threshold
                ? `Cycle #${nextCycleNum} (${nextCycleType.toUpperCase()}): Threshold reached (${escrow.toFixed(4)} / ${threshold} ETH)! Autonomous Bot executing...`
                : `Cycle #${nextCycleNum} (${nextCycleType.toUpperCase()}): Escrow balance ${escrow.toFixed(4)} ETH (Target: ${threshold} ETH). Router: ${router.toUpperCase()}. Standby.`
          };
        });
      } catch (e) {
        // ignore network hiccup
      }
    };

    syncOnChain();
    const interval = setInterval(syncOnChain, 6000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [config.tokenAddress, config.curveAddress, config.creatorAddress, config.rpcUrl, setConfig]);

  // Fire confetti flame effect when burn triggers
  const triggerBurnConfetti = useCallback(() => {
    confetti({
      particleCount: 85,
      spread: 75,
      origin: { y: 0.65 },
      colors: ['#f43f5e', '#fb7185', '#ea580c', '#fbbf24', '#ffffff'],
      shapes: ['circle', 'square'],
      scalar: 1.2,
    });
  }, []);

  // Phase 1: CLAIM FEE
  const executeClaimPhase = useCallback(async (feeToClaim: number, cycleNum: number, cycleType: 'burn' | 'keep') => {
    sounds.playClaimSound();
    if (cycleType === 'burn') {
      addLog({
        phase: 'claim',
        action: 'CLAIM FEE',
        details: `[Cycle #${cycleNum} - BURN] Claiming ${feeToClaim.toFixed(4)} ETH from Pons Fee Escrow (0xd3AFEB...Ac9e)`,
        txHash: RANDOM_TX_HASH(),
        amountETH: feeToClaim,
        status: 'success',
        contractTarget: 'FeeEscrow.claim()'
      });
    }

    setState((prev) => ({
      ...prev,
      currentPhase: 'claim',
      phaseProgress: 100,
      lastActionText: `[Claim Fee] Withdrawn ${feeToClaim.toFixed(4)} ETH from Pons Fee Escrow...`,
    }));
  }, [addLog]);

  // Phase 2: BUYBACK (Curve DEX or Uniswap Router if migrated)
  const executeBuybackPhase = useCallback(async (claimedETH: number) => {
    const cur = stateRef.current;
    const cfg = configRef.current;
    const price = cur.tokenPriceETH > 0 ? cur.tokenPriceETH : 0.00000002;
    const tokensBought = Math.round((claimedETH / price) * (0.98 + Math.random() * 0.04));
    const isMigrated = cur.isTokenMigrated;
    const routerName = isMigrated ? 'Uniswap v4 Router' : 'Bonding Curve DEX';
    const contractTarget = isMigrated ? 'UniswapV4.universalRouter()' : 'Curve.buy()';

    sounds.playBuybackSound();
    addLog({
      phase: 'buyback',
      action: 'AUTO-BUYBACK',
      details: `Swapped ${claimedETH.toFixed(4)} ETH via ${routerName} -> bought ${tokensBought.toLocaleString()} $${cfg.tokenSymbol}`,
      txHash: RANDOM_TX_HASH(),
      amountETH: claimedETH,
      amountToken: tokensBought,
      status: 'success',
      contractTarget
    });

    setState((prev) => ({
      ...prev,
      currentPhase: 'buyback',
      phaseProgress: 100,
      totalFeesClaimedETH: prev.totalFeesClaimedETH + claimedETH,
      totalFeesClaimedUSD: prev.totalFeesClaimedUSD + claimedETH * 2500,
      tokenPriceETH: (prev.tokenPriceETH || 0.00000002) * 1.002,
      tokenPriceUSD: (prev.tokenPriceUSD || 0.00005) * 1.002,
      marketCapUSD: (prev.marketCapUSD || 50000) * 1.002,
      lastActionText: `[Auto-Buyback] Purchased ${tokensBought.toLocaleString()} $${cfg.tokenSymbol} via ${routerName}...`,
    }));

    return tokensBought;
  }, [addLog]);

  // Phase 3: BURN TO DEAD
  const executeBurnPhase = useCallback(async (tokensToBurn: number) => {
    const cfg = configRef.current;

    sounds.playBurnSound();
    triggerBurnConfetti();

    addLog({
      phase: 'burn',
      action: 'BURN TO DEAD',
      details: `Permanently destroyed ${tokensToBurn.toLocaleString()} $${cfg.tokenSymbol} -> sent to Dead Sink (${PONS_V2_CONFIG.contracts.deadAddress.substring(0, 10)}...)`,
      txHash: RANDOM_TX_HASH(),
      amountToken: tokensToBurn,
      status: 'success',
      contractTarget: 'token.transfer(dEaD)'
    });

    setState((prev) => {
      const newTotalBurned = prev.totalTokensBurned + tokensToBurn;
      const newBurnPct = prev.totalSupply > 0 ? (newTotalBurned / prev.totalSupply) * 100 : 0;
      const nextCycles = prev.cycleCount + 1;
      const isNextBurn = (nextCycles + 1) % 2 === 1;
      const nextThreshold = isNextBurn ? 0.01 : 0.02;
      return {
        ...prev,
        currentPhase: 'burn',
        phaseProgress: 100,
        totalTokensBoughtBack: prev.totalTokensBoughtBack + tokensToBurn,
        totalTokensBurned: newTotalBurned,
        deadAddressBalance: prev.deadAddressBalance + tokensToBurn,
        burnedPercentageOfSupply: newBurnPct,
        cycleCount: nextCycles,
        nextCycleType: isNextBurn ? 'burn' : 'keep',
        currentThresholdETH: nextThreshold,
        claimThresholdETH: nextThreshold,
        lastActionText: `[Burn Complete] ${tokensToBurn.toLocaleString()} tokens destroyed in Dead Sink. Cycle #${nextCycles} complete.`,
      };
    });
  }, [addLog, triggerBurnConfetti]);

  // Phase 2 Alternate: KEEP FEE (Even cycles: retained in treasury/operator wallet, no keep log)
  const executeKeepPhase = useCallback(async (feeToKeep: number, cycleNum: number) => {
    sounds.playClaimSound();
    // Do NOT add log for keep

    setState((prev) => {
      const nextCycles = prev.cycleCount + 1;
      const isNextBurn = (nextCycles + 1) % 2 === 1;
      const nextThreshold = isNextBurn ? 0.01 : 0.02;
      return {
        ...prev,
        currentPhase: 'keep',
        phaseProgress: 100,
        totalFeesClaimedETH: prev.totalFeesClaimedETH + feeToKeep,
        totalFeesClaimedUSD: prev.totalFeesClaimedUSD + feeToKeep * 2500,
        totalFeesRetainedETH: prev.totalFeesRetainedETH + feeToKeep,
        cycleCount: nextCycles,
        nextCycleType: isNextBurn ? 'burn' : 'keep',
        currentThresholdETH: nextThreshold,
        claimThresholdETH: nextThreshold,
        lastActionText: `Standby. Next cycle target: ${nextThreshold} ETH.`,
      };
    });
  }, []);

  // Complete Execution Sequence: Alternates between 0.01 ETH Burn and 0.02 ETH Keep
  const runFlywheelExecution = useCallback(async () => {
    if (isExecutingRef.current) return;

    if (!isConfiguredAddress(configRef.current.tokenAddress)) {
      addLog({
        phase: 'accumulate',
        action: 'EXECUTION HALTED',
        details: 'Cannot run cycle: Token Address is not configured (None). Please configure token contract first.',
        txHash: '0x0000000000000000000000000000000000000000',
        status: 'pending',
        contractTarget: 'System',
      });
      return;
    }

    isExecutingRef.current = true;
    const currentCycleNum = stateRef.current.cycleCount + 1;
    const isBurnCycle = currentCycleNum % 2 === 1;
    const cycleType = isBurnCycle ? 'burn' : 'keep';
    const cycleThreshold = isBurnCycle ? 0.01 : 0.02;
    const feeAmount = stateRef.current.currentEscrowBalanceETH || cycleThreshold;

    try {
      // Start Wheel spinning
      setState((prev) => ({
        ...prev,
        isWheelSpinning: true,
        lastActionText: `Spinning Engine: Executing Cycle #${currentCycleNum} (${cycleType.toUpperCase()} @ ${cycleThreshold} ETH)...`,
      }));

      // Step 1: Claim from Pons Fee Escrow
      await executeClaimPhase(feeAmount, currentCycleNum, cycleType);
      await new Promise((r) => setTimeout(r, 4000));

      if (isBurnCycle) {
        // Step 2: Auto-Buyback (via Curve or Uniswap Router)
        const boughtTokens = await executeBuybackPhase(feeAmount);
        await new Promise((r) => setTimeout(r, 4000));

        // Step 3: Burn to Dead Sink
        await executeBurnPhase(boughtTokens);
        await new Promise((r) => setTimeout(r, 4000));
      } else {
        // Step 2 Alternate: Keep fee in treasury/wallet (No buyback, no burn)
        await executeKeepPhase(feeAmount, currentCycleNum);
        await new Promise((r) => setTimeout(r, 4000));
      }

      // Wheel STOPS
      sounds.playAccumulateSound();
      const nextCycleNum = currentCycleNum + 1;
      const nextIsBurn = nextCycleNum % 2 === 1;
      const nextType = nextIsBurn ? 'burn' : 'keep';
      const nextThreshold = nextIsBurn ? 0.01 : 0.02;

      setState((prev) => ({
        ...prev,
        isWheelSpinning: false,
        currentPhase: 'accumulate',
        phaseProgress: 0,
        currentEscrowBalanceETH: 0,
        nextCycleType: nextType,
        currentThresholdETH: nextThreshold,
        claimThresholdETH: nextThreshold,
        lastActionText: `Engine Standby: Cycle #${currentCycleNum} finished. Next: Cycle #${nextCycleNum} (${nextType.toUpperCase()} @ ${nextThreshold} ETH). Standby.`,
      }));

      if (isBurnCycle) {
        addLog({
          phase: 'accumulate',
          action: 'ENGINE STANDBY',
          details: `Cycle #${currentCycleNum} (BURN) complete. Next target: ${nextThreshold} ETH. Waiting for trading volume.`,
          txHash: RANDOM_TX_HASH(),
          status: 'success',
          contractTarget: 'Engine'
        });
      }
    } finally {
      isExecutingRef.current = false;
    }
  }, [executeClaimPhase, executeBuybackPhase, executeBurnPhase, executeKeepPhase, addLog]);

  // Autonomous Daemon & Real-time Bot Synchronization
  useEffect(() => {
    // If token address is not configured, ENGINE REMAINS COMPLETELY HALTED / STOPPED!
    if (!isConfiguredAddress(config.tokenAddress)) {
      setState((prev) => ({
        ...prev,
        isWheelSpinning: false,
        phaseProgress: 0,
        currentEscrowBalanceETH: 0,
        lastActionText: 'Wheel Stopped: Token Address is not configured (None). Waiting for contract deployment.',
      }));
      return;
    }

    let isCancelled = false;

    const syncDaemon = async () => {
      // If user is manually running a browser animation test from AdminPanel, don't interrupt
      if (isExecutingRef.current) return;

      try {
        const res = await fetch('/api/status');
        if (res.ok && !isCancelled) {
          const json = await res.json();
          if (json.success && json.data) {
            const data = json.data;
            const isBusy = data.status === 'claiming' || data.status === 'buyback' || data.status === 'burning';

            setState((prev) => {
              if (isExecutingRef.current) return prev;
              return {
                ...prev,
                isWheelSpinning: isBusy,
                currentPhase: isBusy ? data.status : prev.currentPhase,
                lastActionText: isBusy
                  ? `Autonomous Bot Active: ${data.status.toUpperCase()} phase executing on-chain...`
                  : prev.lastActionText
              };
            });

            // Synchronize logs from backend bot to activity telemetry and localStorage
            if (data.logs && Array.isArray(data.logs) && data.logs.length > 0) {
              const mappedBotLogs: ActivityLog[] = data.logs.map((bl: any, idx: number) => {
                const msgLower = (bl.message || '').toLowerCase();
                const isBurn = msgLower.includes('burn') || msgLower.includes('incinerat');
                const isBuy = msgLower.includes('buyback') || msgLower.includes('buy');
                const isClaim = msgLower.includes('claim');
                const isKeep = msgLower.includes('keep') || msgLower.includes('treasury');
                const phase = isBurn ? 'burn' : isBuy ? 'buyback' : isKeep ? 'keep' : isClaim ? 'claim' : 'accumulate';

                return {
                  id: `bot-${bl.timestamp}-${idx}`,
                  timestamp: bl.timestamp || new Date().toLocaleTimeString(),
                  phase,
                  action: isBurn ? 'BURN TO DEAD' : isBuy ? 'AUTO-BUYBACK' : isKeep ? 'KEEP REVENUE' : isClaim ? 'CLAIM FEE' : 'ENGINE TELEMETRY',
                  details: bl.message,
                  txHash: (bl.message || '').match(/0x[a-fA-F0-9]{64}/)?.[0] || '',
                  status: bl.type === 'error' ? 'failed' : 'success',
                  contractTarget: isBurn ? '0x000...dEaD' : isBuy ? 'UniswapV4/Curve' : isClaim ? 'PonsFeeEscrow' : 'System'
                };
              });

              updateLogsWithStorage((prev) => {
                const existingDetails = new Set(prev.map((p) => p.details));
                const newItems = mappedBotLogs.filter((m) => !existingDetails.has(m.details));
                if (newItems.length === 0) return prev;
                return [...newItems, ...prev].slice(0, 80);
              });
            }
          }
        }
      } catch (e) {
        // Fallback: On-chain RPC poller (syncOnChain) handles metrics when API is unreachable
      }
    };

    syncDaemon();
    const daemonInterval = setInterval(syncDaemon, 3000);
    return () => {
      isCancelled = true;
      clearInterval(daemonInterval);
    };
  }, [config.tokenAddress, config.claimThresholdETH]);

  return {
    state,
    config,
    setConfig,
    resetConfigToDefaults,
    logs,
    burnLedger,
    addLog,
    runFlywheelExecution,
  };
}
