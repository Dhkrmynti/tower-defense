import { ExternalLink, ScrollText } from 'lucide-react';
import type { BurnLedgerEntry } from '../../types';
import { CountUp } from './CountUp';

interface RoundsProps {
  burnLedger: BurnLedgerEntry[];
  roundsFought: number;
  unitsDestroyed: number;
  ralliedETH: number;
  tokenSymbol: string;
  explorerUrl: string;
  live: boolean;
  onOpenLog: () => void;
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.floor(n));

/**
 * Every engine cycle is a round. A purge round destroys a wave of the horde (tokens to 0x…dEaD);
 * a garrison round pays the treasury in ETH. Newest first.
 */
export function Rounds({ burnLedger, roundsFought, unitsDestroyed, ralliedETH, tokenSymbol, explorerUrl, live, onOpenLog }: RoundsProps) {
  const rounds = burnLedger.slice(0, 12);
  const tiles = [
    { label: 'Rounds fought', value: roundsFought, format: fmt, tone: 'text-cream' },
    { label: 'Units destroyed', value: unitsDestroyed, format: fmt, tone: 'text-brass', unit: tokenSymbol },
    { label: 'ETH rallied', value: ralliedETH, format: (n: number) => n.toFixed(4), tone: 'text-shield', unit: 'ETH' },
  ];

  return (
    <section id="rounds" aria-labelledby="rounds-title" className="relative px-4 pb-20 pt-20 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[84rem]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="m-0 hud text-[0.7rem] text-shield">Wave log</p>
            <h2 id="rounds-title" className="m-0 mt-2 sign-lettering text-[clamp(2.4rem,5vw,4.2rem)] leading-[0.95] text-cream">
              Rounds
            </h2>
          </div>
          <button type="button" onClick={onOpenLog} className="btn-steel cursor-pointer px-4 py-2.5 text-[0.74rem]">
            <ScrollText className="h-4 w-4" />
            Battle log
          </button>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="panel px-5 py-4">
              <p className="m-0 hud text-[0.64rem] text-dust-dim">{t.label}</p>
              <p className={`m-0 mt-1.5 display text-[clamp(1.9rem,3.2vw,2.8rem)] leading-none tabular ${t.tone}`}>
                <CountUp value={t.value} format={t.format} />
                {t.unit ? <span className="ml-2 hud text-[0.7rem] text-dust-dim">{t.unit}</span> : null}
              </p>
            </div>
          ))}
        </div>

        {rounds.length === 0 ? (
          <div className="panel mt-6 px-6 py-10 text-center">
            <p className="m-0 display text-[1.6rem] text-cream">{live ? 'The first wave is still marching.' : 'The field is quiet.'}</p>
            <p className="mx-auto mt-2 max-w-[52ch] text-[0.98rem] leading-relaxed text-dust">
              {live
                ? `Round 1 runs the moment the war chest is full. Every trade of ${tokenSymbol} fills it.`
                : 'Rounds start with the CA. Until then the turrets hold their fire.'}
            </p>
          </div>
        ) : (
          <ol className="m-0 mt-6 flex snap-x list-none gap-4 overflow-x-auto p-0 pb-4 [scrollbar-width:thin]">
            {rounds.map((r) => {
              const keep = r.cycleType === 'keep';
              const burned = r.burnedJollyburn || r.burnedMuseburn || r.burnedIncinerator || 0;
              const tx = keep ? r.claimTx : r.burnTx || r.buyTx || r.claimTx;
              return (
                <li key={r.id} className={`panel w-[17rem] shrink-0 snap-start p-5 ${keep ? 'border-garrison/40' : ''}`}>
                  <div className="flex items-center justify-between">
                    <p className="m-0 display text-[1.5rem] leading-none text-cream">Round {r.cycleNum}</p>
                    <span className={`hud rounded-[3px] px-2 py-1 text-[0.58rem] ${keep ? 'bg-garrison text-ink' : 'bg-enemy text-cream'}`}>
                      {keep ? 'Garrison' : 'Purge'}
                    </span>
                  </div>
                  <p className="m-0 mt-1 font-mono text-[0.74rem] text-dust-dim">{r.timeStr}</p>
                  <div className="my-4 h-0 border-t-2 border-dashed border-steel-line" />
                  {keep ? (
                    <>
                      <p className="m-0 hud text-[0.62rem] text-dust-dim">Garrison paid</p>
                      <p className="m-0 mt-1 display text-[1.7rem] leading-none text-garrison tabular">{r.claimedETH.toFixed(4)} ETH</p>
                    </>
                  ) : (
                    <>
                      <p className="m-0 hud text-[0.62rem] text-dust-dim">Wave repelled</p>
                      <p className="m-0 mt-1 display text-[1.7rem] leading-none text-brass tabular">{fmt(burned)}</p>
                      <p className="m-0 mt-1 text-[0.82rem] text-dust">
                        units of {tokenSymbol} sent to 0x…dEaD with {r.boughtETH.toFixed(4)} ETH
                      </p>
                    </>
                  )}
                  {tx ? (
                    <a
                      href={`${explorerUrl}/tx/${tx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-1.5 font-mono text-[0.76rem] text-shield no-underline hover:underline"
                    >
                      {tx.slice(0, 10)}…{tx.slice(-6)}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
