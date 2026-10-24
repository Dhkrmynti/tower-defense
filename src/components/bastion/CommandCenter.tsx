import { ExternalLink, ScrollText } from 'lucide-react';
import type { ActivityLog, FlywheelState, MachineConfig } from '../../types';
import type { Split } from '../engine/split';

interface CommandCenterProps {
  state: FlywheelState;
  config: MachineConfig;
  split: Split;
  logs: ActivityLog[];
  live: boolean;
  explorerUrl: string;
  onOpenLog: () => void;
}

const short = (a?: string) => (a && a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || '—');

/**
 * The engine, in plain sight: what the Warden is doing, where the contracts are, and its last words.
 */
export function CommandCenter({ state, config, split, logs, live, explorerUrl, onOpenLog }: CommandCenterProps) {
  const router = state.swapRouter === 'uniswap' || state.isTokenMigrated ? 'Uniswap v4' : 'Pons bonding curve';
  const phase = !live ? 'offline' : state.isWheelSpinning ? state.currentPhase : 'standby';
  const addresses = [
    { label: `Token (${config.tokenSymbol})`, value: config.tokenAddress, path: 'token' },
    { label: 'Bonding curve', value: config.curveAddress, path: 'address' },
    { label: 'Fee escrow (the war chest)', value: config.feeEscrowAddress, path: 'address' },
    { label: 'Engine wallet (the Warden)', value: config.creatorAddress, path: 'address' },
    { label: 'Dead sink (the horde’s grave)', value: config.deadAddress, path: 'address' },
  ];
  const readings = [
    { label: 'Status', value: phase, tone: state.isWheelSpinning ? 'text-brass' : live ? 'text-garrison' : 'text-dust' },
    { label: 'Chain link', value: !live ? '—' : split.inSync ? 'in sync' : 'reconnecting', tone: split.inSync ? 'text-shield' : 'text-enemy' },
    { label: 'Router', value: router, tone: 'text-cream' },
    { label: 'Opens at', value: `${(state.currentThresholdETH || config.claimThresholdETH).toFixed(3)} ETH`, tone: 'text-cream' },
    { label: 'Split', value: `${split.burnPct}% purge / ${split.wagePct}% garrison`, tone: 'text-cream' },
    { label: 'Max buy', value: `${split.maxBuyETH} ETH`, tone: 'text-cream' },
  ];

  return (
    <section id="command" aria-labelledby="command-title" className="relative px-4 pb-20 pt-10 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[84rem]">
        <p className="m-0 hud text-[0.7rem] text-stone">Under the walls</p>
        <h2 id="command-title" className="m-0 mt-2 sign-lettering text-[clamp(2.4rem,5vw,4.2rem)] leading-[0.95] text-cream">
          Command center
        </h2>
        <p className="mt-4 max-w-[62ch] text-[1rem] leading-relaxed text-dust">
          The Warden is a bot. It sweeps the creator fees from the curve into the escrow, opens the chest when it is full, buys {config.tokenSymbol} back
          and sends it to the dead address, and pays the garrison in ETH. Every move is a transaction on Robinhood Chain.
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {/* readings */}
          <div className="panel p-5">
            <p className="m-0 hud text-[0.64rem] text-dust-dim">Engine readings</p>
            <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5">
              {readings.map((r) => (
                <div key={r.label} className="contents">
                  <dt className="hud text-[0.6rem] leading-6 text-dust-dim">{r.label}</dt>
                  <dd className={`m-0 text-right font-mono text-[0.84rem] leading-6 ${r.tone}`}>{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* contracts */}
          <div className="panel p-5">
            <p className="m-0 hud text-[0.64rem] text-dust-dim">Contracts · chain 4663</p>
            <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
              {addresses.map((a) => (
                <li key={a.label} className="flex items-center justify-between gap-3">
                  <span className="hud text-[0.58rem] text-dust-dim">{a.label}</span>
                  {a.value && a.value.length === 42 ? (
                    <a href={`${explorerUrl}/${a.path}/${a.value}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[0.8rem] text-cream no-underline hover:text-brass">
                      {short(a.value)}
                      <ExternalLink className="h-3 w-3 text-dust-dim" />
                    </a>
                  ) : (
                    <span className="font-mono text-[0.8rem] text-dust-dim">soon</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* last words */}
          <div className="panel flex flex-col p-5">
            <div className="flex items-center justify-between">
              <p className="m-0 hud text-[0.64rem] text-dust-dim">Warden telemetry</p>
              <span className={`h-2 w-2 rounded-full ${live && split.inSync ? 'bg-garrison blink' : 'bg-enemy'}`} aria-hidden="true" />
            </div>
            <ol className="m-0 mt-3 flex-1 list-none space-y-2 p-0 font-mono text-[0.76rem]">
              {logs.length === 0 ? (
                <li className="text-dust-dim">{live ? 'Waiting for the first words.' : 'Silent until the CA.'}</li>
              ) : (
                logs.slice(0, 6).map((l) => (
                  <li key={l.id} className="flex gap-2 leading-snug">
                    <span className="shrink-0 text-dust-dim">{l.timestamp}</span>
                    <span className={`min-w-0 break-words ${l.status === 'failed' ? 'text-enemy' : l.phase === 'burn' ? 'text-brass' : 'text-dust'}`}>{l.details}</span>
                  </li>
                ))
              )}
            </ol>
            <button type="button" onClick={onOpenLog} className="btn-steel mt-4 cursor-pointer px-4 py-2.5 text-[0.72rem]">
              <ScrollText className="h-4 w-4" />
              Full battle log
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
