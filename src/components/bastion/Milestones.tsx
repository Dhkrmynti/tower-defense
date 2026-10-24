import { Check, Copy, Crosshair, ExternalLink, Lock, Skull } from 'lucide-react';
import { FORTRESS_STAGES, MILESTONES, fortressStage, nextBoss } from './lore';
import { CountUp } from './CountUp';

interface MilestonesProps {
  burnedPct: number;
  totalBurned: number;
  tokenSymbol: string;
  deadAddress: string;
  copiedDead: boolean;
  onCopyDead: () => void;
  explorerUrl: string;
  live: boolean;
}

const MAX_PCT = MILESTONES[MILESTONES.length - 1].pct;
/** Milestones bunch up at the low end, so the track uses a square-root scale. */
const pos = (pct: number) => Math.sqrt(Math.min(pct, MAX_PCT) / MAX_PCT) * 100;
const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.floor(n));

/**
 * The purged supply is the fortress' score. Every milestone mounts a turret or brings down a boss,
 * and the keep itself evolves through five stages.
 */
export function Milestones({ burnedPct, totalBurned, tokenSymbol, deadAddress, copiedDead, onCopyDead, explorerUrl, live }: MilestonesProps) {
  const stage = fortressStage(burnedPct);
  const boss = nextBoss(burnedPct);
  const pctLabel = (Math.floor(burnedPct * 100) / 100).toFixed(2);
  const next = MILESTONES.find((m) => burnedPct < m.pct);

  return (
    <section id="milestones" aria-labelledby="milestones-title" className="relative px-4 pb-20 pt-10 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[84rem]">
        <p className="m-0 hud text-[0.7rem] text-brass">Supply purged</p>
        <h2 id="milestones-title" className="m-0 mt-2 sign-lettering text-[clamp(2.4rem,5vw,4.2rem)] leading-[0.95] text-cream">
          Milestones
        </h2>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          {/* the score and the track */}
          <div className="panel p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="m-0 hud text-[0.64rem] text-dust-dim">Of the supply in 0x…dEaD</p>
                <p className="m-0 mt-1 display text-[clamp(3rem,7vw,5.4rem)] leading-none text-brass tabular">{pctLabel}%</p>
                <p className="m-0 mt-2 font-mono text-[0.88rem] text-cream tabular">
                  <CountUp value={totalBurned} format={fmt} /> {tokenSymbol}
                </p>
              </div>
              <div className="text-right">
                <p className="m-0 hud text-[0.64rem] text-dust-dim">Fortress</p>
                <p className="m-0 mt-1 display text-[1.8rem] leading-none text-stone">{stage.name}</p>
                <p className="m-0 mt-1 hud text-[0.62rem] text-dust">
                  Stage {stage.level} / {FORTRESS_STAGES.length} · {stage.reached} / {MILESTONES.length} cleared
                </p>
              </div>
            </div>

            <div className="relative mt-10 mb-10">
              <div className="track" role="meter" aria-label="Supply purged toward the last milestone" aria-valuemin={0} aria-valuemax={MAX_PCT} aria-valuenow={Math.min(burnedPct, MAX_PCT)}>
                <div className="track-fill" style={{ width: `calc(${pos(burnedPct)}% - 6px)` }} />
              </div>
              {MILESTONES.map((m) => {
                const hit = burnedPct >= m.pct;
                return (
                  <span key={m.pct} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(m.pct)}%` }} aria-hidden="true">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                        hit ? (m.kind === 'boss' ? 'border-enemy bg-enemy text-cream' : 'border-brass bg-brass text-ink') : 'border-steel-line bg-field-deep text-dust-dim'
                      }`}
                    >
                      {m.kind === 'boss' ? <Skull className="h-3 w-3" /> : <Crosshair className="h-3 w-3" />}
                    </span>
                    <span className={`absolute left-1/2 top-7 -translate-x-1/2 hud text-[0.56rem] ${hit ? 'text-cream' : 'text-dust-dim'}`}>{m.pct}%</span>
                  </span>
                );
              })}
            </div>

            <p className="m-0 text-[0.95rem] leading-relaxed text-dust">
              {next
                ? `Next: ${next.name} at ${next.pct}%. ${(next.pct - burnedPct).toFixed(2)}% of the supply to go.`
                : 'Every milestone cleared. The war is won, and the turrets keep firing anyway.'}
            </p>
          </div>

          {/* the next boss */}
          <div className="panel flex flex-col p-6 sm:p-8">
            <p className="m-0 hud text-[0.64rem] text-enemy">{boss ? `Boss ${boss.index} / ${boss.total}` : 'All bosses down'}</p>
            <p className="m-0 mt-1 display text-[clamp(1.7rem,3vw,2.4rem)] leading-none text-cream">{boss ? boss.name : 'Crimson Overlord'}</p>
            <p className="m-0 mt-2 text-[0.92rem] leading-snug text-dust">{boss ? boss.blurb : 'The last boss fell at 21%.'}</p>
            <div className="mt-5">
              <div className="flex items-center justify-between hud text-[0.6rem] text-dust-dim">
                <span>Health</span>
                <span className="text-enemy">{boss ? Math.ceil(boss.hp * 100) : 0}%</span>
              </div>
              <div className="mt-1.5 h-4 overflow-hidden rounded-[3px] border-2 border-steel-line bg-field-deep" role="meter" aria-label="Boss health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={boss ? Math.ceil(boss.hp * 100) : 0}>
                <div className="h-full bg-enemy transition-[width] duration-[1.2s] ease-[var(--ease-out-expo)]" style={{ width: `${boss ? boss.hp * 100 : 0}%` }} />
              </div>
            </div>
            <p className="m-0 mt-4 text-[0.86rem] leading-snug text-dust">
              {boss ? `Every purge wounds it. It falls when ${boss.pct}% of the supply is in the dead address.` : 'Nothing left to fight but the supply.'}
            </p>
            <div className="mt-auto pt-6">
              <p className="m-0 hud text-[0.62rem] text-dust-dim">Where the horde goes</p>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCopyDead}
                  className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-[4px] border-2 border-dashed border-steel-line px-3 py-2 text-left transition-colors hover:border-brass"
                  title="Copy the dead address"
                >
                  <span className="min-w-0 truncate font-mono text-[0.8rem] text-cream">{deadAddress}</span>
                  {copiedDead ? <Check className="h-4 w-4 shrink-0 text-brass" /> : <Copy className="h-4 w-4 shrink-0 text-dust" />}
                </button>
                <a href={`${explorerUrl}/address/${deadAddress}`} target="_blank" rel="noreferrer" className="btn-steel h-11 w-11 shrink-0" aria-label="Dead address on the explorer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* the milestone cards */}
        <ol className="m-0 mt-6 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {MILESTONES.map((m, i) => {
            const hit = burnedPct >= m.pct;
            const isBoss = m.kind === 'boss';
            return (
              <li
                key={m.pct}
                data-milestone-card
                className={`relative rounded-[6px] border-2 p-5 ${
                  hit ? (isBoss ? 'border-enemy bg-enemy-deep/30' : 'border-brass bg-brass/10') : 'border-steel-line bg-steel/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`hud text-[0.6rem] ${hit ? (isBoss ? 'text-enemy' : 'text-brass') : 'text-dust-dim'}`}>
                    {isBoss ? 'Boss' : 'Turret'} · {m.pct}%
                  </span>
                  {hit ? (isBoss ? <Skull className="h-4 w-4 text-enemy" /> : <Crosshair className="h-4 w-4 text-brass" />) : <Lock className="h-4 w-4 text-dust-dim" />}
                </div>
                <p className={`m-0 mt-3 display text-[1.4rem] leading-none ${hit ? 'text-cream' : 'text-dust'}`}>{m.name}</p>
                <p className="m-0 mt-2 text-[0.86rem] leading-snug text-dust">{m.blurb}</p>
                <p className={`m-0 mt-3 hud text-[0.58rem] ${hit ? (isBoss ? 'text-enemy' : 'text-brass') : 'text-dust-dim'}`}>
                  {hit ? (isBoss ? 'Destroyed' : 'Mounted') : live ? 'Locked' : 'Locked · CA soon'}
                  <span className="sr-only"> milestone {i + 1}</span>
                </p>
              </li>
            );
          })}
        </ol>

        {/* fortress evolution */}
        <div className="mt-6 flex flex-wrap items-center gap-2 overflow-x-auto">
          {FORTRESS_STAGES.map((s, i) => {
            const on = stage.level >= i + 1;
            return (
              <div key={s.name} className="flex items-center gap-2">
                <span className={`hud rounded-[3px] border-2 px-3 py-1.5 text-[0.6rem] ${on ? 'border-stone bg-stone text-ink' : 'border-steel-line text-dust-dim'}`}>
                  {i + 1}. {s.name}
                </span>
                {i < FORTRESS_STAGES.length - 1 ? <span className={`h-[2px] w-5 ${on && stage.level > i + 1 ? 'bg-stone' : 'bg-steel-line'}`} aria-hidden="true" /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
