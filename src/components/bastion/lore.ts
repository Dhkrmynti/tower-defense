// The world of BASTION: a fortress on Robinhood Chain, held round after round by mechanical turrets.
// Fees arm the fortress, every engine cycle is a round, every purge sends the red horde to 0x…dEaD.
export const X_HANDLE = '@bastionrh';
export const X_URL = 'https://x.com/bastionrh';
export const DOMAIN = 'bastion.xyz';
export const TAGLINE = 'Every round strengthens the last defense.';

export const EXPLORER_URL = 'https://explorer.mainnet.chain.robinhood.com';
export const buyUrl = (ca: string) => `https://ponsfamily.com/launchpad/${ca}`;
export const chartUrl = (ca: string) => `https://dexscreener.com/robinhood/${ca}`;

export const isLiveCA = (addr?: string) => Boolean(addr && /^0x[0-9a-fA-F]{40}$/.test(addr));

export type MilestoneKind = 'turret' | 'boss';
export interface Milestone {
  /** Percent of the supply purged (sent to 0x…dEaD) that unlocks it. */
  pct: number;
  kind: MilestoneKind;
  name: string;
  blurb: string;
}

/** Burn milestones: each one either mounts a new turret on the walls or destroys a boss of the red horde. */
export const MILESTONES: Milestone[] = [
  { pct: 0.5, kind: 'turret', name: 'Gatling Mk I', blurb: 'The first gun on the wall. Fast, loud, never sleeps.' },
  { pct: 1, kind: 'boss', name: 'The Red Colossus', blurb: 'First boss of the horde. Falls when 1% of the supply is gone.' },
  { pct: 2, kind: 'turret', name: 'Tesla Coil', blurb: 'Chain lightning across the whole lane.' },
  { pct: 3, kind: 'boss', name: 'Siege Crawler', blurb: 'A walking battering ram. Falls at 3%.' },
  { pct: 5, kind: 'turret', name: 'Rail Cannon', blurb: 'One shot, one lane, cleared.' },
  { pct: 8, kind: 'boss', name: 'The Red Tide', blurb: 'The horde’s whole second army. Falls at 8%.' },
  { pct: 13, kind: 'turret', name: 'Orbital Lance', blurb: 'Called down from above the chain.' },
  { pct: 21, kind: 'boss', name: 'Crimson Overlord', blurb: 'The last boss. Falls at 21%, and the war is won.' },
];

/** Fortress stages: the keep grows as milestones are cleared. */
export const FORTRESS_STAGES = [
  { name: 'Palisade', at: 0 },
  { name: 'Stone Keep', at: 2 },
  { name: 'Iron Bastion', at: 4 },
  { name: 'Citadel', at: 6 },
  { name: 'Last Defense', at: 8 },
];

export const milestonesReached = (burnedPct: number) => MILESTONES.filter((m) => burnedPct >= m.pct).length;
export const turretsUnlocked = (burnedPct: number) => 1 + MILESTONES.filter((m) => m.kind === 'turret' && burnedPct >= m.pct).length;
export const fortressStage = (burnedPct: number) => {
  const reached = milestonesReached(burnedPct);
  let stage = FORTRESS_STAGES[0];
  for (const s of FORTRESS_STAGES) if (reached >= s.at) stage = s;
  return { ...stage, level: FORTRESS_STAGES.indexOf(stage) + 1, reached };
};
/** The next boss on the road, with its remaining health as a 0..1 fraction. */
export const nextBoss = (burnedPct: number) => {
  const bosses = MILESTONES.filter((m) => m.kind === 'boss');
  const idx = bosses.findIndex((b) => burnedPct < b.pct);
  if (idx === -1) return null;
  const boss = bosses[idx];
  const prev = idx === 0 ? 0 : bosses[idx - 1].pct;
  const hp = Math.max(0, Math.min(1, (boss.pct - burnedPct) / (boss.pct - prev)));
  return { ...boss, hp, index: idx + 1, total: bosses.length };
};

/** What the Warden says when you tap the fortress. */
export const WARDEN_SAYS = [
  'hold the line, defender.',
  'every fee is another round in the chamber.',
  'the red horde never stops. neither do the turrets.',
  'the dead address is the only exit.',
  'part of every chest goes to the guns. the rest pays the garrison.',
  'more trades. stronger walls.',
  'no round is ever lost. supply only goes one way.',
  'reload. fire. repeat.',
];

export const PHASE_SAYS: Record<string, string> = {
  claim: 'The war chest is opening…',
  buyback: 'The Warden is buying $BASTION back…',
  burn: 'Purge in progress. The horde is marching into 0x…dEaD…',
  keep: 'Garrison pay is going out…',
};

export const MANUAL = [
  {
    title: 'The siege',
    text: 'Under the blocks of Robinhood Chain stands the last fortress. The red horde comes in waves, round after round, and the walls only hold for as long as the guns are fed.',
  },
  {
    title: 'The war chest',
    text: 'Every $BASTION trade drops a creator fee into the war chest. The chest is the fortress’ shield: as it fills, the defenses charge, and when it is full the Warden opens it.',
  },
  {
    title: 'The round',
    text: 'Each opening is a round. Part of the chest buys $BASTION back and purges it to the dead address, a wave of the horde destroyed for good. The rest pays the garrison in ETH, never in your tokens.',
  },
  {
    title: 'The milestones',
    text: 'The purged supply is the fortress’ score. Every milestone mounts a new turret on the wall or brings down a boss, and the fortress itself evolves. Nothing purged ever comes back.',
  },
];
