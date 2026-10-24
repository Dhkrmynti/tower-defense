import { useEffect, useState } from 'react';
import type { Board } from '../utils/leaderboard';
import type { MachineConfig } from '../types';
import { isConfiguredAddress } from './useBurnEngine';

// ethers is heavy; the leaderboard reader loads only once there is a token to rank
const loadBoard = () => import('../utils/leaderboard');

/** The leaderboard, rebuilt from the chain every minute while the token is live. */
export function useDefenders(config: MachineConfig, engineWallet: string) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfiguredAddress(config.tokenAddress) || !isConfiguredAddress(config.curveAddress)) {
      setBoard(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      setLoading(true);
      try {
        const { fetchDefenders } = await loadBoard();
        const next = await fetchDefenders(config.tokenAddress, config.curveAddress, [engineWallet, config.creatorAddress], config.rpcUrl);
        if (!alive) return;
        if (next) setBoard(next);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message || 'leaderboard unavailable');
      } finally {
        if (alive) setLoading(false);
      }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [config.tokenAddress, config.curveAddress, config.creatorAddress, config.rpcUrl, engineWallet]);

  return { board, loading, error };
}
