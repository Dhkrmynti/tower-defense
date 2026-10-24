/* Pixel-art sprites, drawn from character grids into offscreen canvases at load. No image files. */

const PALETTE: Record<string, string> = {
  k: '#070b08', // ink
  r: '#ff3b3b', // red
  R: '#a8121f', // red deep
  p: '#ff8a8a', // red light
  o: '#ff6b4a', // orange
  y: '#f2b31f', // brass
  Y: '#ffd96a', // brass hot
  s: '#8aa0b4', // steel
  S: '#4c5e6e', // steel dark
  t: '#c4d2de', // steel light
  g: '#b8b0a2', // stone
  G: '#6f685e', // stone dark
  h: '#e0d9cc', // stone light
  c: '#38e8ff', // cyan
  C: '#0e7f93', // cyan deep
  l: '#9cff57', // lime
  L: '#2f6b0c', // lime deep
  w: '#f1efe6', // white
  b: '#5a4632', // wood
  B: '#3a2c1e', // wood dark
  m: '#243a2f', // moss
  M: '#1b2a24', // moss dark
  e: '#ff9f1c', // ember
};

export const SCALE = 2;

function draw(rows: string[], scale = SCALE): HTMLCanvasElement {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      ctx.fillStyle = PALETTE[ch] ?? '#ff00ff';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return c;
}
/** Top half → full sprite, mirrored top/bottom (sprites face +x). */
const vm = (top: string[]) => [...top, ...[...top].reverse()];

/* ───────── the horde (facing right) ───────── */
const GRUNT = vm([
  '......kkkk......',
  '....kkrrrrkk....',
  '...krrrrrrrrk...',
  '..krrrrrrrrrrk..',
  '.krrrrrrrrrrrrk.',
  '.krrrrrrrrrkkrrk',
  'krrrrrrrrrrkwkrk',
  'krrrrrrrrrrrrrrk',
]);
const RUNNER = vm([
  '................',
  'kk..............',
  'kokk............',
  'kooookk.........',
  'koooooookk......',
  'kooooooooookk...',
  'koooooooookwkk..',
  'kooooooooooookk.',
]);
const BRUTE = vm([
  '....kkkkkkkk....',
  '...kRRRRRRRRk...',
  '..kRRRRRRRRRRk..',
  '.kRRRRRRRRRRRRk.',
  'kRRRRRRRRRRRRRRk',
  'kRRRRRRRRRRkkRRk',
  'kRRRRRRRRRRkYkRk',
  'kRRRRRRRRRRRRRRk',
]);
const HEALER = vm([
  '......kkkk......',
  '....kkrrrrkk....',
  '...krrrrrrrrk...',
  '..krrrllrrrrrk..',
  '.krrrrllrrrrrrk.',
  '.krrllllllrkkrrk',
  'krrrllllllrkwkrk',
  'krrrrrllrrrrrrrk',
]);
const ARMORED = vm([
  '......kkkk......',
  '....kkssssk.....',
  '...kssssssssk...',
  '..kSsssssssssk..',
  '.krrkSSSSSSkrrk.',
  '.krrrrrrrrrkkrrk',
  'krrrrrrrrrrkwkrk',
  'krrrrrrrrrrrrrrk',
]);
const SWARM = vm(['..kkkk..', '.krrrrk.', 'krrrrkwk', 'krrrrrrk']);
const BOSS = vm([
  '..........kkkk..........',
  '......k..kRRRRk..k......',
  '.....kRkkRRRRRRkkRk.....',
  '....kRRRRRRRRRRRRRRk....',
  '...kRRRRRRRRRRRRRRRRk...',
  '..kRRRRRRRRRRRRRRRRRRk..',
  'kkRRRRRRRRRRRRRRRRRRRRk.',
  'kRRRRRRrrrrrrrrrrRRRRRRk',
  'kRRRRRrrrrrrrrrrrrkkRRRk',
  'kRRRRRrrrrrrrrrrrrkYkRRk',
  'kRRRRRrrrrrrrrrrrrrkkRRk',
  'kRRRRRrrrrrrrrrrrrrrrRRk',
]);

/* ───────── turrets: base and barrels (facing right) ───────── */
const BASE1 = vm([
  '.....kkkkkk.....',
  '...kkSSSSSSkk...',
  '..kSSssssssSSk..',
  '.kSsssssssssssk.',
  '.kSssSSSSSSsssk.',
  'kSssSSssssSSsssk',
  'kSssSssssssSsssk',
  'kSssSssssssSsssk',
]);
const BASE2 = vm([
  '.....kkkkkk.....',
  '...kkyyyyyykk...',
  '..kySSSSSSSSyk..',
  '.kySssssssssSyk.',
  '.kySsSSSSSSsSyk.',
  'kySsSSssssSSsSyk',
  'kySsSssssssSsSyk',
  'kySsSssssssSsSyk',
]);
const BASE3 = vm([
  '.....kkkkkk.....',
  '...kkYYYYYYkk...',
  '..kYyyyyyyyyYk..',
  '.kYySSSSSSSSyYk.',
  '.kYySsSSSSsSyYk.',
  'kYySSssssssSSyYk',
  'kYySSsssssssSyYk',
  'kYySSsssssssSyYk',
]);
const B_SENTRY = vm(['................', '................', '................', '................', '................', '......kkkkkkkkkk', '.....kSsssssssst', '....kSsssssssstk']);
const B_GATLING = vm(['................', '................', '................', '......kkkkkkkkkk', '.....kSssssssstk', '....kSSSSSSSSSSk', '....kSyyyySSSSS.', '....kSSSSSSSSSS.']);
const B_TESLA = vm(['................', '................', '..........kkkk..', '.........kcccck.', '........kcCCCCck', '....kkkkkcCwwCck', '...kSsssscCwwCck', '...kSssssscCCCck']);
const B_RAIL = vm([
  '........................',
  '........................',
  '........................',
  '........................',
  '.......kkkkkkkkkkkkkkkk.',
  '......kSSSSSSSSSSSSSSSYk',
  '.....kSssssssssssssssYYk',
  '....kSsssssSyySssssssYYk',
]);
const B_LANCE = vm(['................', '................', '................', '......kk........', '....kkllkk......', '...kLlllllkk....', '..kLllllllllkkk.', '..kLlllllllllllk']);

/* ───────── decor ───────── */
const ROCK = ['..kkkk..', '.kGggGk.', 'kGgghgGk', 'kGggggGk', 'kGGggGGk', '.kGGGGk.', '..kkkk..'];
const ROCK2 = ['...kkk.', '..kGgGk', '.kGghgk', 'kGggggk', 'kGGgGGk', '.kkkkk.'];
const CRATER = ['....kkkk....', '..kkMMMMkk..', '.kMMkkkkMMk.', 'kMMk....kMMk', 'kMk......kMk', 'kMk......kMk', 'kMMk....kMMk', '.kMMkkkkMMk.', '..kkMMMMkk..', '....kkkk....'];
const RUBBLE = ['..k.kk..', '.kGkGGk.', 'kGGkGgGk', '.kGGGGk.', '..kkkk..'];
const FLAG = ['k.......', 'kRRRR...', 'kRrrRR..', 'kRrrrRR.', 'kRRRRR..', 'kRRRR...', 'k.......', 'k.......', 'k.......', 'k.......'];
const TORCH = ['..ee..', '.eYYe.', '.eYYe.', '..ee..', '..kk..', '..bb..', '..bb..', '..bb..', '.kbbk.', '.kkkk.'];
const BONES = ['.kkkkk.', 'kwwwwwk', 'kwkwkwk', 'kwwwwwk', '.kwkwk.', '..kkk..', 'kw...wk', '.kw.wk.'];
const BUSH = ['..kkkk..', '.kmMMmk.', 'kmMmmMmk', 'kMmmmmMk', 'kmMmmMmk', '.kkmmkk.', '...kk...'];
/* the commander's tools */
const BARRICADE = ['kkkkkkkkkkkkkkkk', 'kGgGgGgGgGgGgGgk', 'kgGgGgGgGgGgGgGk', 'kGhGhGhGhGhGhGhk', 'kgGgGgGgGgGgGgGk', 'kGgGgGgGgGgGgGgk', 'kkkkkkkkkkkkkkkk', '.k.k.k.k.k.k.k.k'];
const DRONE = vm(['......kk......', '....kkccck....', '...kcCCCCck...', '..kcCttttCck..', 'kkkcCtwwttCckk', 'kSSkCtwwttCkSS', 'kSSkcCttttCkSS', '.kkkkcCCCCkkk.']);
const BOMB = ['..kk..', '.kSSk.', 'kSSSSk', 'kSsSSk', 'kSSSSk', '.kkkk.', '.kyyk.', '..kk..'];

export interface SpriteSet {
  enemy: Record<string, HTMLCanvasElement>;
  base: HTMLCanvasElement[];
  barrel: Record<string, HTMLCanvasElement>;
  decor: Record<string, HTMLCanvasElement>;
  fortress: HTMLCanvasElement[];
}

let cache: SpriteSet | null = null;

/** Build every sprite once. Call after the document exists. */
export function sprites(): SpriteSet {
  if (cache) return cache;
  cache = {
    enemy: { grunt: draw(GRUNT), runner: draw(RUNNER), brute: draw(BRUTE), healer: draw(HEALER), armored: draw(ARMORED), swarm: draw(SWARM), boss: draw(BOSS) },
    base: [draw(BASE1), draw(BASE2), draw(BASE3)],
    barrel: { sentry: draw(B_SENTRY), gatling: draw(B_GATLING), tesla: draw(B_TESLA), rail: draw(B_RAIL), lance: draw(B_LANCE) },
    decor: { rock: draw(ROCK), rock2: draw(ROCK2), crater: draw(CRATER), rubble: draw(RUBBLE), flag: draw(FLAG), torch: draw(TORCH), bones: draw(BONES), bush: draw(BUSH), barricade: draw(BARRICADE), drone: draw(DRONE), bomb: draw(BOMB) },
    fortress: [1, 2, 3, 4, 5].map(makeFortress),
  };
  return cache;
}

/** The castle, generated as a pixel grid per stage: palisade, stone keep, iron bastion, citadel, last defense. */
function makeFortress(level: number): HTMLCanvasElement {
  const N = 44;
  const g: string[][] = Array.from({ length: N }, () => Array(N).fill('.'));
  const put = (x: number, y: number, ch: string) => {
    if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = ch;
  };
  const box = (x0: number, y0: number, x1: number, y1: number, fill: string, edge = 'k') => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, x === x0 || x === x1 || y === y0 || y === y1 ? edge : fill);
  };
  const brick = (x0: number, y0: number, x1: number, y1: number, a = 'g', b = 'G', hi = 'h') => {
    for (let y = y0 + 1; y < y1; y++)
      for (let x = x0 + 1; x < x1; x++) {
        const row = Math.floor(y / 2);
        const shifted = (x + (row % 2) * 2) % 4;
        put(x, y, shifted === 0 && y % 2 === 0 ? b : y % 2 === 0 ? a : (x + row) % 7 === 0 ? hi : a);
      }
  };
  const c = N / 2;
  if (level === 1) {
    // a ring of sharpened posts with a gap on the lane side, a wooden keep inside
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      if (Math.abs(a - Math.PI) < 0.3) continue;
      const px = Math.round(c + Math.cos(a) * 18);
      const py = Math.round(c + Math.sin(a) * 18);
      put(px, py, 'k');
      put(px, py - 1, 'b');
      put(px, py - 2, 'B');
    }
    box(c - 7, c - 7, c + 7, c + 7, 'b', 'k');
    for (let y = c - 6; y < c + 7; y++) for (let x = c - 6; x < c + 7; x++) put(x, y, (x + y) % 2 ? 'b' : 'B');
    box(c - 9, c - 2, c - 7, c + 2, 'B', 'k'); // door
    put(c - 3, c, 'e');
    put(c + 3, c, 'e');
    put(c + 9, c - 10, 'k');
    put(c + 9, c - 11, 'k');
    put(c + 10, c - 11, 'r');
    put(c + 11, c - 11, 'r');
    return draw(g.map((r) => r.join('')), SCALE);
  }
  const half = 17;
  const x0 = c - half;
  const y0 = c - half;
  const x1 = c + half;
  const y1 = c + half;
  // outer wall with a gate gap on the lane side
  box(x0, y0, x1, y1, level >= 3 ? 's' : 'g');
  box(x0 + 1, y0 + 1, x1 - 1, y1 - 1, level >= 3 ? 'S' : 'G', level >= 3 ? 's' : 'g');
  brick(x0 + 1, y0 + 1, x1 - 1, y1 - 1, level >= 3 ? 's' : 'g', level >= 3 ? 'S' : 'G', level >= 3 ? 't' : 'h');
  // courtyard
  box(x0 + 3, y0 + 3, x1 - 3, y1 - 3, 'M', 'G');
  // merlons
  for (let x = x0; x <= x1; x += 2) {
    put(x, y0 - 1, 'G');
    put(x, y1 + 1, 'G');
  }
  for (let y = y0; y <= y1; y += 2) {
    put(x0 - 1, y, 'G');
    put(x1 + 1, y, 'G');
  }
  // gatehouse: two towers and a dark portcullis
  for (const dy of [-5, 5]) {
    box(x0 - 2, c + dy - 2, x0 + 2, c + dy + 2, 'g', 'k');
    put(x0, c + dy, level >= 4 ? 'y' : 'r');
  }
  box(x0 - 1, c - 2, x0 + 2, c + 2, 'B', 'k');
  for (let y = c - 1; y <= c + 1; y++) put(x0 + 1, y, 'k');
  // corner towers
  const corners: [number, number][] = level >= 3 ? [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] : [[x1, y0], [x1, y1]];
  for (const [tx, ty] of corners) {
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= 3.4) put(tx + dx, ty + dy, d > 2.6 ? 'k' : level >= 4 ? 'y' : level >= 3 ? 'S' : 'G');
      }
    put(tx, ty, level >= 4 ? 'Y' : level >= 3 ? 'e' : 'r');
  }
  // the keep
  const kw = level >= 4 ? 7 : 6;
  box(c - kw + 1, c - kw, c + kw + 1, c + kw, 'g', 'k');
  brick(c - kw + 1, c - kw, c + kw + 1, c + kw);
  if (level >= 3) for (let x = c - kw + 2; x < c + kw + 1; x++) put(x, c, 'S');
  put(c - kw + 1, c, 'e');
  put(c + kw + 1, c, 'e');
  if (level >= 4) {
    box(c - 3, c - 4, c + 5, c + 4, 'h', 'k');
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(c + 1 + dx, c + dy, 'y');
    put(c + 1, c, 'Y');
    for (const bx of [x0 + 6, x1 - 6]) {
      put(bx, y0 - 2, 'y');
      put(bx, y1 + 2, 'y');
    }
  } else {
    put(c + 1, c - 1, 'R');
    put(c + 1, c, 'R');
  }
  if (level >= 5) {
    // the dome: a cyan ring around everything and a white core
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      put(Math.round(c + Math.cos(a) * 21), Math.round(c + Math.sin(a) * 21), i % 3 ? 'c' : 'C');
    }
    put(c + 1, c, 'w');
  }
  // the flag on the far wall
  for (let y = y0 - 8; y <= y0 - 2; y++) put(x1 - 4, y, 'k');
  for (let y = y0 - 8; y <= y0 - 5; y++) for (let x = x1 - 3; x <= x1 + 1; x++) put(x, y, level >= 4 ? 'y' : 'r');
  return draw(g.map((r) => r.join('')), SCALE);
}
