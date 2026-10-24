import { useState } from 'react';
import { ExternalLink, Wallet } from 'lucide-react';
import type { Board } from '../../utils/leaderboard';

interface LeaderboardProps {
  board: Board | null;
  loading: boolean;
  error: string | null;
  live: boolean;
  tokenSymbol: string;
  explorerUrl: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.floor(n));
const RANK_TONE = ['bg-brass text-ink', 'bg-stone text-ink', 'bg-[#b87333] text-cream'];

/**
 * Every defender ranked by what they traded against the curve: every trade pays a fee into
 * the war chest, so volume is the contribution to the fortress' progress.
 */
export function Leaderboard({ board, loading, error, live, tokenSymbol, explorerUrl }: LeaderboardProps) {
  const [me, setMe] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);

  const findMe = async () => {
    setFinding(true);
    try {
      const { connectWallet } = await import('../../utils/web3');
      const res = await connectWallet();
      if (res) setMe(res.address.toLowerCase());
    } finally {
      setFinding(false);
    }
  };

  const top = board?.defenders.slice(0, 10) ?? [];
  const myRank = me && board ? board.defenders.findIndex((d) => d.address === me) : -1;
  const mine = myRank >= 0 && board ? board.defenders[myRank] : null;

  return (
    <section id="leaderboard" aria-labelledby="leaderboard-title" className="relative px-4 pb-20 pt-10 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[84rem]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="m-0 hud text-[0.7rem] text-garrison">Defenders</p>
            <h2 id="leaderboard-title" className="m-0 mt-2 sign-lettering text-[clamp(2.4rem,5vw,4.2rem)] leading-[0.95] text-cream">
              Leaderboard
            </h2>
          </div>
          <button type="button" onClick={findMe} disabled={!live || finding} className="btn-steel cursor-pointer px-4 py-2.5 text-[0.74rem] disabled:cursor-not-allowed disabled:opacity-50">
            <Wallet className="h-4 w-4" />
            {finding ? 'Connecting…' : me ? short(me) : 'Find my rank'}
          </button>
        </div>

        {me ? (
          <p className="m-0 mt-4 hud text-[0.68rem] text-dust" role="status">
            {mine ? (
              <>
                You hold rank <span className="text-brass">#{myRank + 1}</span> with {mine.share.toFixed(2)}% of the defense.
              </>
            ) : (
              'Not on the board yet. One trade puts you on it.'
            )}
          </p>
        ) : null}

        <div className="panel mt-6 overflow-hidden p-0">
          {!live ? (
            <div className="px-6 py-12 text-center">
              <p className="m-0 display text-[1.6rem] text-cream">The board opens with the CA.</p>
              <p className="mx-auto mt-2 max-w-[48ch] text-[0.95rem] text-dust">Every trade from the first block counts. Rank is by volume traded against the curve.</p>
            </div>
          ) : top.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="m-0 display text-[1.6rem] text-cream">{loading ? 'Reading the chain…' : error ? 'The board is out of reach.' : 'No defenders yet.'}</p>
              <p className="mx-auto mt-2 max-w-[48ch] text-[0.95rem] text-dust">
                {error ? 'Robinhood Chain did not answer. It retries every minute.' : 'The first trade takes the top spot.'}
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="hud text-[0.6rem] text-dust-dim">
                  <th className="px-4 py-3 font-semibold sm:px-6">Rank</th>
                  <th className="px-2 py-3 font-semibold">Defender</th>
                  <th className="px-2 py-3 font-semibold">Contribution</th>
                  <th className="hidden px-2 py-3 text-right font-semibold md:table-cell">Volume</th>
                  <th className="px-4 py-3 text-right font-semibold sm:px-6">Trades</th>
                </tr>
              </thead>
              <tbody>
                {top.map((d, i) => {
                  const isMe = me === d.address;
                  return (
                    <tr key={d.address} className={`border-t border-steel-line ${isMe ? 'bg-brass/10' : i % 2 ? 'bg-field-deep/40' : ''}`}>
                      <td className="px-4 py-3 sm:px-6">
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-[4px] display text-[1rem] ${RANK_TONE[i] ?? 'border-2 border-steel-line text-dust'}`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <a href={`${explorerUrl}/address/${d.address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[0.84rem] text-cream no-underline hover:text-brass">
                          {short(d.address)}
                          <ExternalLink className="h-3 w-3 text-dust-dim" />
                        </a>
                        {isMe ? <span className="ml-2 hud text-[0.56rem] text-brass">you</span> : null}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-2.5 w-full max-w-[12rem] overflow-hidden rounded-full bg-field-deep">
                            <div className={`h-full ${i === 0 ? 'bg-brass' : 'bg-shield'}`} style={{ width: `${Math.max(2, d.share)}%` }} />
                          </div>
                          <span className="font-mono text-[0.8rem] text-dust tabular">{d.share.toFixed(2)}%</span>
                        </div>
                      </td>
                      <td className="hidden px-2 py-3 text-right font-mono text-[0.82rem] text-cream tabular md:table-cell">
                        {fmt(d.volume)} <span className="text-dust-dim">{tokenSymbol}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[0.82rem] text-cream tabular sm:px-6">
                        {d.trades}
                        <span className="ml-1.5 hidden text-[0.7rem] text-dust-dim sm:inline">
                          {d.buys}b/{d.sells}s
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {board ? (
          <p className="m-0 mt-3 font-mono text-[0.74rem] text-dust-dim">
            {board.defenders.length} defenders · {board.totalTrades} trades on the curve · blocks {board.fromBlock.toLocaleString('en-US')}–{board.toBlock.toLocaleString('en-US')}
            {loading ? ' · refreshing' : ''}
          </p>
        ) : null}
      </div>
    </section>
  );
}
