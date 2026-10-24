/* The campaign: missions on the grounds, each with its own waves and briefing. Progress is kept on this device. */
import type { EnemyKind } from './world';

export interface Mission {
  id: number;
  name: string;
  map: number;
  waves: number;
  briefing: string;
  startScrap: number;
  hp: number;
  /** Boss every n waves (and always on the last wave). */
  bossEvery: number;
  /** Earliest wave each special shows up, overriding the default mix. */
  firstWave?: Partial<Record<EnemyKind, number>>;
  /** Wave pressure multiplier. */
  pressure: number;
}

export const MISSIONS: Mission[] = [
  { id: 1, name: 'Breach Road', map: 0, waves: 8, startScrap: 180, hp: 20, bossEvery: 5, pressure: 0.9, briefing: 'The first breach. One lane, one gate. Learn the mounts and hold eight waves.' },
  { id: 2, name: 'Twin Gorge', map: 1, waves: 10, startScrap: 200, hp: 20, bossEvery: 5, pressure: 1, firstWave: { healer: 3 }, briefing: 'The horde splits across two gorges. Healers march with them. Cover both lanes.' },
  { id: 3, name: 'Ridge Pass', map: 3, waves: 12, startScrap: 220, hp: 20, bossEvery: 4, pressure: 1.05, firstWave: { armored: 3, healer: 2 }, briefing: 'A long pass under the ridge. Armor shows up early: bullets alone will not hold it.' },
  { id: 4, name: 'Spiral Keep', map: 2, waves: 14, startScrap: 240, hp: 20, bossEvery: 5, pressure: 1.1, firstWave: { swarm: 4, armored: 5 }, briefing: 'The long way round the keep. Swarms come in fives; chain lightning and blast earn their keep.' },
  { id: 5, name: 'Dead Harbor', map: 4, waves: 16, startScrap: 260, hp: 20, bossEvery: 4, pressure: 1.15, firstWave: { healer: 2, armored: 2, swarm: 3 }, briefing: 'Two piers, one harbor, the whole horde. Everything you have learned, at once.' },
  { id: 6, name: 'The Last Defense', map: 1, waves: 20, startScrap: 300, hp: 25, bossEvery: 4, pressure: 1.3, firstWave: { healer: 1, armored: 1, swarm: 2 }, briefing: 'The final stand on the twin gorges. Twenty waves, a boss every four. Every round strengthens the last defense.' },
];

export interface CampaignSave {
  /** mission id → stars (1..3) */
  stars: Record<number, number>;
}
const KEY = 'bastion_campaign';
export const loadCampaign = (): CampaignSave => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CampaignSave> | null;
      if (parsed && typeof parsed === 'object' && parsed.stars && typeof parsed.stars === 'object') return { stars: parsed.stars };
    }
  } catch {}
  return { stars: {} };
};
export const saveCampaign = (c: CampaignSave) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {}
};
export const missionUnlocked = (c: CampaignSave, m: Mission) => m.id === 1 || Boolean(c.stars[m.id - 1]);
/** Grounds open for survival: the first, plus every mission's ground once it is cleared. */
export const survivalMaps = (c: CampaignSave) => {
  const maps = new Set<number>([0]);
  for (const m of MISSIONS) if (c.stars[m.id]) maps.add(m.map);
  return [...maps];
};
export const starsFor = (hp: number, maxHp: number) => (hp >= maxHp * 0.9 ? 3 : hp >= maxHp * 0.5 ? 2 : 1);
