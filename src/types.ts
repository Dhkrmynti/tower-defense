export type EnginePhase = 'accumulate' | 'claim' | 'buyback' | 'burn' | 'keep';

export type CycleType = 'burn' | 'keep';

export interface FlywheelState {
  isWheelSpinning: boolean;
  currentPhase: EnginePhase;
  phaseProgress: number; // 0 to 100%
  cycleCount: number;
  nextCycleType: CycleType; // 'burn' (0.01 ETH) or 'keep' (0.02 ETH)
  currentThresholdETH: number; // 0.01 on odd, 0.02 on even
  isTokenMigrated: boolean; // whether graduated to Uniswap
  swapRouter: 'curve' | 'uniswap';
  totalFeesClaimedETH: number;
  totalFeesClaimedUSD: number;
  totalFeesRetainedETH: number;
  totalTokensBoughtBack: number;
  totalTokensBurned: number;
  burnedPercentageOfSupply: number;
  currentEscrowBalanceETH: number;
  claimThresholdETH: number;
  tokenPriceETH: number;
  tokenPriceUSD: number;
  marketCapUSD: number;
  totalSupply: number;
  deadAddressBalance: number;
  lastActionText: string;
  connectedWallet: string | null;
  isOnChainMode: boolean;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  phase: EnginePhase;
  action: string;
  details: string;
  txHash: string;
  amountETH?: number;
  amountToken?: number;
  status: 'pending' | 'success' | 'failed';
  contractTarget?: string;
  isRealTx?: boolean;
}

export interface BurnLedgerEntry {
  id: string;
  cycleNum: number;
  cycleType?: CycleType; // 'burn' or 'keep'
  timeStr: string;
  timestamp: number;
  claimedETH: number;
  claimedUSD: number;
  boughtETH: number;
  boughtUSD: number;
  retainedETH?: number;
  burnedJollyburn?: number;
  burnedMuseburn?: number;
  burnedIncinerator?: number;
  claimTx: string;
  buyTx?: string;
  burnTx?: string;
  swapRouter?: 'curve' | 'uniswap';
}

export interface MachineConfig {
  networkName: string;
  chainId: number;
  rpcUrl: string;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  curveAddress: string;
  factoryAddress: string;
  feeEscrowAddress: string;
  deadAddress: string;
  creatorAddress: string;
  claimThresholdETH: number;
  slippageBps: number;
  cycleIntervalSeconds: number;
  soundEnabled: boolean;
}
