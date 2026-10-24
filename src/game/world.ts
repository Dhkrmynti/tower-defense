/* The guns, the horde and the economy. Sizes are world units (960×540). Maps live in maps.ts. */

export { W, H } from './maps';

export type TurretKind = 'sentry' | 'gatling' | 'tesla' | 'rail' | 'lance';
export type DamageType = 'bullet' | 'energy' | 'heavy';
export interface TurretDef {
  kind: TurretKind;
  name: string;
  cost: number;
  rate: number; // ms between shots
  dmg: number;
  range: number;
  speed: number; // projectile speed
  color: string;
  type: DamageType;
  /** Percent of the supply purged that unlocks it for everyone (0 = always). */
  unlockPct: number;
  /** The wave that unlocks it for this session, whatever the chain says. */
  unlockWave: number;
  blurb: string;
  chain?: number; // tesla: targets per shot
  splash?: number; // lance: blast radius
  pierce?: boolean; // rail: goes through the lane
}

export const TURRETS: Record<TurretKind, TurretDef> = {
  sentry: { kind: 'sentry', name: 'Sentry', cost: 60, rate: 400, dmg: 2.2, range: 150, speed: 560, color: '#8aa0b4', type: 'bullet', unlockPct: 0, unlockWave: 0, blurb: 'Reliable bolt gun. Cheap, steady. Weak against armor.' },
  gatling: { kind: 'gatling', name: 'Gatling Mk I', cost: 100, rate: 130, dmg: 1.1, range: 140, speed: 700, color: '#f2b31f', type: 'bullet', unlockPct: 0.5, unlockWave: 3, blurb: 'Twin barrels, a wall of lead. Weak against armor.' },
  tesla: { kind: 'tesla', name: 'Tesla Coil', cost: 160, rate: 640, dmg: 4, range: 160, speed: 1400, color: '#38e8ff', type: 'energy', unlockPct: 2, unlockWave: 6, blurb: 'Lightning that jumps to 3 targets and slows them.', chain: 3 },
  rail: { kind: 'rail', name: 'Rail Cannon', cost: 230, rate: 1350, dmg: 15, range: 270, speed: 1700, color: '#ffd96a', type: 'heavy', unlockPct: 5, unlockWave: 9, blurb: 'One slug, straight through everything on the lane.', pierce: true },
  lance: { kind: 'lance', name: 'Orbital Lance', cost: 300, rate: 1000, dmg: 10, range: 230, speed: 800, color: '#9cff57', type: 'heavy', unlockPct: 13, unlockWave: 13, blurb: 'Called down from above. Blast damage.', splash: 52 },
};
export const TURRET_ORDER: TurretKind[] = ['sentry', 'gatling', 'tesla', 'rail', 'lance'];
export const MAX_LEVEL = 3; // base; the experimental stage adds a fourth
export const upgradeCost = (def: TurretDef, level: number) => Math.round(def.cost * 0.7 * level);
export const investedIn = (def: TurretDef, level: number) => def.cost + [1, 2, 3].filter((l) => level > l).reduce((acc, l) => acc + upgradeCost(def, l), 0);
export const sellValue = (def: TurretDef, level: number, rate = 0.6) => Math.round(investedIn(def, level) * rate);
export const levelMul = (level: number) => 1 + (level - 1) * 0.55;

export type EnemyKind = 'grunt' | 'runner' | 'brute' | 'healer' | 'armored' | 'swarm' | 'boss';
export interface EnemyDef {
  hp: number;
  speed: number;
  r: number;
  scrap: number;
  leak: number;
  blurb: string;
}
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: { hp: 6, speed: 50, r: 9, scrap: 6, leak: 1, blurb: 'The rank and file.' },
  runner: { hp: 4, speed: 94, r: 7, scrap: 7, leak: 1, blurb: 'Fast. Dies fast.' },
  brute: { hp: 24, speed: 30, r: 14, scrap: 18, leak: 2, blurb: 'Slow, heavy, two HP at the gate.' },
  healer: { hp: 14, speed: 38, r: 10, scrap: 16, leak: 1, blurb: 'Heals the horde around it. Kill it first.' },
  armored: { hp: 18, speed: 42, r: 10, scrap: 14, leak: 1, blurb: 'Steel plates: bullets do a third. Use Tesla, Rail or Lance.' },
  swarm: { hp: 2, speed: 82, r: 5, scrap: 2, leak: 1, blurb: 'Five at a time. Splash and chain lightning eat them.' },
  boss: { hp: 260, speed: 20, r: 24, scrap: 170, leak: 6, blurb: 'Every fifth wave. Six HP if it reaches the gate.' },
};
/** Bullets against armor. */
export const ARMOR_FACTOR = 0.35;

export const START_SCRAP = 160;
export const START_HP = 20;
export const WAVE_BREAK = 14; // seconds between waves

export const waveSize = (w: number, bossWave = w % 5 === 0) => (bossWave ? 6 + Math.round(w * 1.2) : 8 + Math.round(w * 2.4));
export const hpScale = (w: number) => 1 + (w - 1) * 0.13;
export const clearBonus = (w: number) => 40 + w * 12;

/** The names the bosses take, in order. */
export const BOSS_NAMES = ['The Red Colossus', 'Siege Crawler', 'The Red Tide', 'Crimson Overlord', 'The Red Colossus II', 'Siege Crawler II', 'The Red Tide II', 'Crimson Overlord II'];

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** What a connected wallet brings to the field. Read from the chain, never spent. */
export interface Perks {
  address: string;
  /** Share of the supply held, 0..100. */
  heldPct: number;
  balance: number;
  /** Rank on the defenders board, 1-based, 0 = not on it. */
  rank: number;
  bonusScrap: number;
  freeSentry: boolean;
  title: string;
}
export const HOLDER_TIERS = [
  { minPct: 0.1, bonusScrap: 150, freeSentry: true, title: 'Warden’s Guard' },
  { minPct: 0, bonusScrap: 50, freeSentry: false, title: 'Defender' },
];
export const perksFor = (address: string, balance: number, heldPct: number, rank: number): Perks => {
  const tier = balance > 0 ? HOLDER_TIERS.find((t) => heldPct >= t.minPct) ?? HOLDER_TIERS[HOLDER_TIERS.length - 1] : null;
  const title = rank > 0 && rank <= 10 ? `Defender #${rank}` : tier ? tier.title : 'Recruit';
  return { address, heldPct, balance, rank, bonusScrap: tier?.bonusScrap ?? 0, freeSentry: tier?.freeSentry ?? false, title };
};
/** Scrap every active defender gets when the Warden purges on chain. */
export const purgeBonus = (wave: number) => 60 + wave * 8;

/* ───────── active abilities: the commander's hand, on cooldown ───────── */
export type AbilityKind = 'airstrike' | 'barricade' | 'drone' | 'overcharge';
export interface AbilityDef {
  kind: AbilityKind;
  name: string;
  key: string;
  cooldown: number; // seconds
  targeted: boolean;
  color: string;
  blurb: string;
  /** Research that opens it, or null when it is there from the start. */
  research: ResearchId | null;
}
export const ABILITIES: Record<AbilityKind, AbilityDef> = {
  airstrike: { kind: 'airstrike', name: 'Airstrike', key: 'Q', cooldown: 28, targeted: true, color: '#ff9f1c', blurb: 'Three bombs on a point. Click where the horde will be.', research: null },
  barricade: { kind: 'barricade', name: 'Barricade', key: 'W', cooldown: 22, targeted: true, color: '#b8b0a2', blurb: 'A wall on the lane. Holds the horde until it is torn down.', research: 'barricade' },
  drone: { kind: 'drone', name: 'Tactical drone', key: 'E', cooldown: 40, targeted: false, color: '#38e8ff', blurb: 'A gun drone over the field for fifteen seconds.', research: 'drone' },
  overcharge: { kind: 'overcharge', name: 'Overcharge', key: 'R', cooldown: 36, targeted: false, color: '#ffd96a', blurb: 'Every gun fires twice as fast for six seconds.', research: 'overcharge' },
};
export const ABILITY_ORDER: AbilityKind[] = ['airstrike', 'barricade', 'drone', 'overcharge'];
export const AIRSTRIKE = { delay: 0.8, bombs: 3, spread: 46, dmg: 26, splash: 58 };
export const BARRICADE = { hp: 70, life: 9, width: 18 };
export const DRONE = { life: 15, rate: 230, dmg: 2.6, range: 130, speed: 150 };
export const OVERCHARGE = { life: 6, boost: 0.5 };

/* ───────── research: the tech tree, bought with scrap, kept between runs ───────── */
export type ResearchId = 'gatling' | 'tesla' | 'rail' | 'lance' | 'barricade' | 'drone' | 'overcharge' | 'ap_rounds' | 'gate' | 'salvage' | 'reload' | 'experimental';
export interface ResearchDef {
  id: ResearchId;
  name: string;
  cost: number;
  tier: 1 | 2 | 3;
  kind: 'gun' | 'ability' | 'upgrade';
  requires?: ResearchId;
  blurb: string;
}
export const RESEARCH: ResearchDef[] = [
  { id: 'gatling', name: 'Gatling Mk I', cost: 120, tier: 1, kind: 'gun', blurb: 'Opens the Gatling on every mount, whatever the chain or the wave says.' },
  { id: 'barricade', name: 'Barricade', cost: 140, tier: 1, kind: 'ability', blurb: 'The wall. Buys time on any lane.' },
  { id: 'ap_rounds', name: 'AP rounds', cost: 180, tier: 1, kind: 'upgrade', blurb: 'Bullets do 70% to armor instead of 35%.' },
  { id: 'gate', name: 'Reinforced gate', cost: 160, tier: 1, kind: 'upgrade', blurb: '+5 gate HP at the start of every run.' },
  { id: 'tesla', name: 'Tesla Coil', cost: 220, tier: 2, kind: 'gun', requires: 'gatling', blurb: 'Opens the Tesla Coil.' },
  { id: 'drone', name: 'Tactical drone', cost: 240, tier: 2, kind: 'ability', requires: 'barricade', blurb: 'A gun in the air for fifteen seconds.' },
  { id: 'salvage', name: 'Salvage', cost: 150, tier: 2, kind: 'upgrade', requires: 'gate', blurb: 'Selling a gun returns 85% instead of 60%.' },
  { id: 'reload', name: 'Fast reload', cost: 260, tier: 2, kind: 'upgrade', requires: 'ap_rounds', blurb: 'Ability cooldowns 20% shorter.' },
  { id: 'rail', name: 'Rail Cannon', cost: 320, tier: 3, kind: 'gun', requires: 'tesla', blurb: 'Opens the Rail Cannon.' },
  { id: 'lance', name: 'Orbital Lance', cost: 420, tier: 3, kind: 'gun', requires: 'rail', blurb: 'Opens the Orbital Lance.' },
  { id: 'overcharge', name: 'Overcharge', cost: 300, tier: 3, kind: 'ability', requires: 'drone', blurb: 'Every gun at double speed for six seconds.' },
  { id: 'experimental', name: 'Experimental stage', cost: 480, tier: 3, kind: 'upgrade', requires: 'reload', blurb: 'A fourth gun level: every fifth shot is a charged shot at triple damage.' },
];
export const RESEARCH_KEY = 'bastion_research';
export const loadResearch = (): Set<ResearchId> => {
  try {
    const raw = localStorage.getItem(RESEARCH_KEY);
    if (raw) return new Set(JSON.parse(raw) as ResearchId[]);
  } catch {}
  return new Set();
};
export const saveResearch = (r: Set<ResearchId>) => {
  try {
    localStorage.setItem(RESEARCH_KEY, JSON.stringify([...r]));
  } catch {}
};
export const EXPERIMENTAL_LEVEL = 4;
export const CHARGED_EVERY = 5;
