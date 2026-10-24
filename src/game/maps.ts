/* The grounds the horde marches on. Every ten waves the fortress moves to new ground. */

export const W = 960;
export const H = 540;

export interface Lane {
  points: [number, number][];
  segs: { x0: number; y0: number; x1: number; y1: number; len: number; angle: number }[];
  len: number;
}
export interface Decor {
  kind: 'rock' | 'rock2' | 'crater' | 'rubble' | 'flag' | 'torch' | 'bones' | 'bush';
  x: number;
  y: number;
}
export interface MapDef {
  id: number;
  name: string;
  tagline: string;
  fort: { x: number; y: number };
  lanes: Lane[];
  slots: [number, number][];
  decor: Decor[];
}

function lane(points: [number, number][]): Lane {
  const segs = points.slice(1).map((p, i) => {
    const [x0, y0] = points[i];
    const [x1, y1] = p;
    return { x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0), angle: Math.atan2(y1 - y0, x1 - x0) };
  });
  return { points, segs, len: segs.reduce((a, s) => a + s.len, 0) };
}

/** Position and heading at distance s along the lane. */
export function laneAt(l: Lane, s: number): [number, number, number] {
  let d = Math.max(0, Math.min(l.len, s));
  for (const seg of l.segs) {
    if (d <= seg.len) {
      const t = seg.len === 0 ? 0 : d / seg.len;
      return [seg.x0 + (seg.x1 - seg.x0) * t, seg.y0 + (seg.y1 - seg.y0) * t, seg.angle];
    }
    d -= seg.len;
  }
  const last = l.segs[l.segs.length - 1];
  return [last.x1, last.y1, last.angle];
}

/** Distance from a point to the nearest lane centre line. */
export function laneDistance(m: Pick<MapDef, 'lanes'>, x: number, y: number): number {
  let best = Infinity;
  for (const l of m.lanes)
    for (const s of l.segs) {
      const dx = s.x1 - s.x0;
      const dy = s.y1 - s.y0;
      const t = s.len === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / (s.len * s.len)));
      best = Math.min(best, Math.hypot(x - (s.x0 + dx * t), y - (s.y0 + dy * t)));
    }
  return best;
}

/** Seeded scatter of rocks and bushes off the lane and off the mounts. */
function scatter(m: Omit<MapDef, 'decor'>, seed: number, n: number): Decor[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: Decor[] = [];
  const kinds: Decor['kind'][] = ['rock', 'rock2', 'bush', 'rubble', 'bones', 'rock', 'bush', 'crater'];
  let guard = 0;
  while (out.length < n && guard++ < 800) {
    const x = 20 + rnd() * (W - 40);
    const y = 20 + rnd() * (H - 40);
    if (laneDistance(m, x, y) < 40) continue;
    if (Math.hypot(x - m.fort.x, y - m.fort.y) < 110) continue;
    if (m.slots.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 42)) continue;
    if (out.some((d) => Math.hypot(d.x - x, d.y - y) < 34)) continue;
    out.push({ kind: kinds[Math.floor(rnd() * kinds.length)], x, y });
  }
  return out;
}

function build(def: Omit<MapDef, 'decor'>, seed: number, extra: Decor[] = []): MapDef {
  return { ...def, decor: [...extra, ...scatter(def, seed, 26)] };
}

export const MAPS: MapDef[] = [
  build(
    {
      id: 0,
      name: 'Breach Road',
      tagline: 'One lane, one gate. Hold it.',
      fort: { x: 868, y: 300 },
      lanes: [
        lane([
          [-40, 96],
          [150, 96],
          [150, 300],
          [330, 300],
          [330, 140],
          [520, 140],
          [520, 420],
          [700, 420],
          [700, 230],
          [800, 230],
          [800, 300],
          [846, 300],
        ]),
      ],
      slots: [
        [230, 200],
        [240, 380],
        [420, 220],
        [430, 400],
        [610, 300],
        [620, 100],
        [760, 130],
        [760, 480],
        [880, 160],
        [880, 440],
      ],
    },
    7,
    [
      { kind: 'flag', x: 14, y: 60 },
      { kind: 'flag', x: 14, y: 120 },
      { kind: 'torch', x: 830, y: 220 },
      { kind: 'torch', x: 830, y: 380 },
    ],
  ),
  build(
    {
      id: 1,
      name: 'Twin Gorge',
      tagline: 'Two breaches. The horde splits.',
      fort: { x: 850, y: 270 },
      lanes: [
        lane([
          [-40, 70],
          [260, 70],
          [260, 200],
          [560, 200],
          [560, 120],
          [720, 120],
          [720, 240],
          [828, 240],
        ]),
        lane([
          [-40, 480],
          [200, 480],
          [200, 350],
          [430, 350],
          [430, 460],
          [650, 460],
          [650, 320],
          [800, 320],
          [800, 290],
          [828, 290],
        ]),
      ],
      slots: [
        [170, 150],
        [360, 130],
        [360, 280],
        [120, 400],
        [300, 420],
        [540, 300],
        [640, 60],
        [740, 400],
        [560, 530],
        [900, 150],
        [900, 420],
      ],
    },
    19,
    [
      { kind: 'flag', x: 14, y: 34 },
      { kind: 'flag', x: 14, y: 500 },
      { kind: 'torch', x: 820, y: 180 },
      { kind: 'torch', x: 820, y: 360 },
    ],
  ),
  build(
    {
      id: 2,
      name: 'Spiral Keep',
      tagline: 'The long way round. Every gun gets a shot.',
      fort: { x: 560, y: 290 },
      lanes: [
        lane([
          [480, -40],
          [480, 60],
          [140, 60],
          [140, 480],
          [860, 480],
          [860, 150],
          [300, 150],
          [300, 400],
          [720, 400],
          [720, 240],
          [600, 240],
          [600, 270],
          [582, 290],
        ]),
      ],
      slots: [
        [220, 110],
        [220, 300],
        [220, 440],
        [400, 230],
        [400, 460],
        [640, 110],
        [780, 310],
        [930, 80],
        [930, 420],
        [560, 530],
        [50, 260],
      ],
    },
    31,
    [
      { kind: 'flag', x: 450, y: 6 },
      { kind: 'flag', x: 510, y: 6 },
      { kind: 'torch', x: 530, y: 215 },
      { kind: 'torch', x: 530, y: 365 },
    ],
  ),
];

MAPS.push(
  build(
    {
      id: 3,
      name: 'Ridge Pass',
      tagline: 'A long pass under the ridge. Armor comes early.',
      fort: { x: 870, y: 440 },
      lanes: [
        lane([
          [-40, 60],
          [200, 60],
          [200, 180],
          [60, 180],
          [60, 330],
          [340, 330],
          [340, 100],
          [600, 100],
          [600, 260],
          [460, 260],
          [460, 460],
          [720, 460],
          [720, 360],
          [800, 360],
          [800, 440],
          [846, 440],
        ]),
      ],
      slots: [
        [130, 120],
        [280, 240],
        [140, 420],
        [460, 180],
        [700, 180],
        [560, 380],
        [380, 480],
        [900, 250],
        [640, 530],
        [930, 100],
      ],
    },
    43,
    [
      { kind: 'flag', x: 14, y: 24 },
      { kind: 'flag', x: 14, y: 84 },
      { kind: 'torch', x: 850, y: 360 },
      { kind: 'torch', x: 930, y: 500 },
    ],
  ),
  build(
    {
      id: 4,
      name: 'Dead Harbor',
      tagline: 'Two piers, one harbor, the whole horde.',
      fort: { x: 480, y: 440 },
      lanes: [
        lane([
          [-40, 120],
          [120, 120],
          [120, 280],
          [300, 280],
          [300, 180],
          [420, 180],
          [420, 400],
          [458, 440],
        ]),
        lane([
          [1000, 120],
          [840, 120],
          [840, 280],
          [660, 280],
          [660, 180],
          [540, 180],
          [540, 400],
          [502, 440],
        ]),
      ],
      slots: [
        [200, 200],
        [760, 200],
        [60, 360],
        [900, 360],
        [360, 330],
        [600, 330],
        [230, 470],
        [730, 470],
        [480, 90],
        [480, 300],
        [330, 60],
        [630, 60],
      ],
    },
    59,
    [
      { kind: 'flag', x: 14, y: 84 },
      { kind: 'flag', x: 946, y: 84 },
      { kind: 'torch', x: 400, y: 500 },
      { kind: 'torch', x: 560, y: 500 },
    ],
  ),
);

/** Survival rotates through the grounds every ten waves. */
export const mapForWave = (wave: number, order: number[] = MAPS.map((m) => m.id)) => MAPS[order[Math.floor(Math.max(0, wave - 1) / 10) % order.length]];
