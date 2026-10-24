import { MAPS, laneAt, mapForWave, type MapDef } from './maps';
import { loadCampaign, saveCampaign, starsFor, type Mission } from './campaign';
import {
  ABILITIES,
  AIRSTRIKE,
  ARMOR_FACTOR,
  BARRICADE,
  BOSS_NAMES,
  CHARGED_EVERY,
  DRONE,
  ENEMIES,
  EXPERIMENTAL_LEVEL,
  MAX_LEVEL,
  OVERCHARGE,
  RESEARCH,
  START_HP,
  START_SCRAP,
  TURRETS,
  WAVE_BREAK,
  clearBonus,
  hpScale,
  levelMul,
  loadResearch,
  purgeBonus,
  rand,
  saveResearch,
  upgradeCost,
  waveSize,
  type AbilityKind,
  type EnemyKind,
  type Perks,
  type ResearchId,
  type TurretKind,
} from './world';
import type { SfxName } from './sfx';

/* ───────── entities ───────── */
export interface Enemy {
  id: number;
  lane: number;
  s: number;
  speed: number;
  hp: number;
  maxHp: number;
  r: number;
  kind: EnemyKind;
  wobble: number;
  hit: number;
  name?: string;
  scrap: number;
  leak: number;
  slow: number;
  healAt: number;
  /** held by a barricade this frame */
  held: boolean;
}
export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  kind: TurretKind;
  target: Enemy | null;
  dmg: number;
  speed: number;
  hitIds: Set<number>;
  charged?: boolean;
  fromDrone?: boolean;
  /** lance: an arc from the gun to the landing point */
  arc?: { x0: number; y0: number; x1: number; y1: number; t: number; dur: number };
}
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  r: number;
  glow?: boolean;
}
export interface Wave {
  x: number;
  y: number;
  r: number;
  max: number;
  kill: boolean;
  color: string;
}
export interface Bolt {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  max: number;
  color: string;
  width: number;
}
export interface Turret {
  slot: number;
  kind: TurretKind;
  level: number;
  /** scrap actually paid for it, upgrades included */
  paid: number;
  angle: number;
  cool: number;
  flash: number;
  recoil: number;
  shots: number;
}
export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}
export interface Strike {
  x: number;
  y: number;
  t: number;
  bombs: [number, number][];
}
export interface Barricade {
  lane: number;
  s: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  life: number;
}
export interface Drone {
  x: number;
  y: number;
  life: number;
  cool: number;
  angle: number;
}

/* ───────── world inputs from the engine ───────── */
export interface WorldInput {
  fill: number;
  burnedPct: number;
  phase: string;
  active: boolean;
  live: boolean;
}

export type Status = 'title' | 'build' | 'wave' | 'over' | 'won';
export type Mode = 'survival' | 'campaign';
export type Banner = { kind: 'wave' | 'boss' | 'purge' | 'garrison' | 'clear' | 'over' | 'ground' | 'unlock' | 'won'; text: string; sub?: string };
export type GameEvent = { type: 'banner'; banner: Banner } | { type: 'sound'; name: SfxName };
export interface StartOpts {
  mode: Mode;
  mission?: Mission;
  /** survival: the grounds to rotate through */
  mapOrder?: number[];
}

export interface SimState {
  status: Status;
  wave: number;
  bestWave: number;
  scrap: number;
  hp: number;
  maxHp: number;
  shieldBlocks: number;
  kills: number;
  stars: number;
  breakLeft: number;
  queue: EnemyKind[];
  spawnAt: number;
  enemies: Enemy[];
  shots: Shot[];
  parts: Particle[];
  waves: Wave[];
  bolts: Bolt[];
  turrets: Turret[];
  floats: FloatText[];
  strikes: Strike[];
  barricades: Barricade[];
  drones: Drone[];
  abilities: Record<AbilityKind, number>;
  overcharge: number;
  boss: Enemy | null;
  time: number;
  tint: number;
  flash: number;
  shieldFlicker: number;
  shake: number;
  fortHit: number;
  lastPhase: string;
  purgeAt: number;
  paused: boolean;
  speed: 1 | 2;
  freeSentry: boolean;
  perks: Perks | null;
}

const BEST_KEY = 'bastion_best_wave';
let nextId = 1;

/** The whole game, no React inside. Step it with dt and the world input; read state to draw. */
export class Sim {
  s: SimState;
  map: MapDef = MAPS[0];
  mode: Mode = 'survival';
  mission: Mission | null = null;
  mapOrder: number[] = [0, 1, 2];
  research: Set<ResearchId> = loadResearch();
  events: GameEvent[] = [];

  constructor() {
    this.s = this.fresh('title');
  }

  private fresh(status: Status): SimState {
    let best = 0;
    try {
      best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    } catch {}
    return {
      status,
      wave: 0,
      bestWave: best,
      scrap: START_SCRAP,
      hp: START_HP,
      maxHp: START_HP,
      shieldBlocks: 0,
      kills: 0,
      stars: 0,
      breakLeft: WAVE_BREAK,
      queue: [],
      spawnAt: 0,
      enemies: [],
      shots: [],
      parts: [],
      waves: [],
      bolts: [],
      turrets: [],
      floats: [],
      strikes: [],
      barricades: [],
      drones: [],
      abilities: { airstrike: 0, barricade: 0, drone: 0, overcharge: 0 },
      overcharge: 0,
      boss: null,
      time: 0,
      tint: 0,
      flash: 0,
      shieldFlicker: 0,
      shake: 0,
      fortHit: 0,
      lastPhase: 'accumulate',
      purgeAt: 0,
      paused: false,
      speed: 1,
      freeSentry: false,
      perks: null,
    };
  }

  pos(e: Enemy): [number, number, number] {
    return laneAt(this.map.lanes[e.lane] ?? this.map.lanes[0], e.s);
  }
  get playing() {
    return this.s.status === 'build' || this.s.status === 'wave';
  }

  /* ───────── runs ───────── */
  start(perks: Perks | null = null, opts: StartOpts = { mode: 'survival' }) {
    this.s = this.fresh('build');
    this.mode = opts.mode;
    this.mission = opts.mission ?? null;
    this.mapOrder = opts.mapOrder && opts.mapOrder.length ? opts.mapOrder : [0, 1, 2, 3, 4];
    this.map = this.mission ? MAPS[this.mission.map] : mapForWave(1, this.mapOrder);
    const s = this.s;
    s.perks = perks;
    if (this.mission) {
      s.scrap = this.mission.startScrap;
      s.hp = s.maxHp = this.mission.hp;
    }
    if (this.research.has('gate')) {
      s.hp += 5;
      s.maxHp += 5;
    }
    if (perks) {
      s.scrap += perks.bonusScrap;
      s.freeSentry = perks.freeSentry;
    }
    const perkLine = perks && perks.bonusScrap > 0 ? ` ${perks.title}: +${perks.bonusScrap} scrap${perks.freeSentry ? ' and a free Sentry' : ''}.` : '';
    const sub = this.mission ? `${this.mission.briefing}${perkLine}` : `${this.map.tagline} Build on the mounts.${perkLine}`;
    this.events.push({ type: 'banner', banner: { kind: 'ground', text: this.mission ? `Mission ${this.mission.id}: ${this.mission.name}` : this.map.name, sub } });
  }
  toTitle() {
    this.s = this.fresh('title');
    this.map = MAPS[0];
    this.mission = null;
  }
  togglePause() {
    if (!this.playing) return;
    this.s.paused = !this.s.paused;
    this.events.push({ type: 'sound', name: 'click' });
  }
  setPaused(v: boolean) {
    if (!this.playing) return;
    this.s.paused = v;
  }
  setSpeed(v: 1 | 2) {
    this.s.speed = v;
    this.events.push({ type: 'sound', name: 'click' });
  }

  /* ───────── guns ───────── */
  maxLevel() {
    return this.research.has('experimental') ? EXPERIMENTAL_LEVEL : MAX_LEVEL;
  }
  /** A gun opens for everyone at its burn milestone, for this session at its wave, or forever once researched. */
  unlocked(kind: TurretKind, burnedPct: number) {
    const def = TURRETS[kind];
    return burnedPct >= def.unlockPct || this.s.wave >= def.unlockWave || this.research.has(kind as ResearchId);
  }
  unlockHint(kind: TurretKind) {
    const def = TURRETS[kind];
    return `purge ${def.unlockPct}% · wave ${def.unlockWave} · or research`;
  }
  cost(kind: TurretKind) {
    return kind === 'sentry' && this.s.freeSentry ? 0 : TURRETS[kind].cost;
  }
  canBuild(kind: TurretKind, input: WorldInput) {
    return this.unlocked(kind, input.burnedPct) && this.s.scrap >= this.cost(kind);
  }
  sellRate() {
    return this.research.has('salvage') ? 0.85 : 0.6;
  }
  build(slot: number, kind: TurretKind, input: WorldInput) {
    const s = this.s;
    if (!this.playing) return false;
    if (s.turrets.some((t) => t.slot === slot)) return false;
    if (!this.canBuild(kind, input)) return false;
    const price = this.cost(kind);
    if (price === 0) s.freeSentry = false;
    s.scrap -= price;
    s.turrets.push({ slot, kind, level: 1, paid: price, angle: Math.PI, cool: 0, flash: 0, recoil: 0, shots: 0 });
    const [x, y] = this.map.slots[slot];
    this.burst(x, y, 16, TURRETS[kind].color, 1, true);
    this.float(x, y - 30, price === 0 ? 'FREE' : `-${price}`, '#f2b31f');
    this.events.push({ type: 'sound', name: 'build' });
    return true;
  }
  upgrade(slot: number) {
    if (!this.playing) return false;
    const t = this.s.turrets.find((q) => q.slot === slot);
    if (!t || t.level >= this.maxLevel()) return false;
    const cost = upgradeCost(TURRETS[t.kind], t.level);
    if (this.s.scrap < cost) return false;
    this.s.scrap -= cost;
    t.paid += cost;
    t.level += 1;
    const [x, y] = this.map.slots[slot];
    this.burst(x, y, 20, '#ffd96a', 1.2, true);
    this.float(x, y - 30, t.level === EXPERIMENTAL_LEVEL ? 'EXPERIMENTAL' : `LV ${t.level}`, '#ffd96a');
    this.events.push({ type: 'sound', name: 'upgrade' });
    return true;
  }
  sell(slot: number) {
    if (!this.playing) return false;
    const i = this.s.turrets.findIndex((q) => q.slot === slot);
    if (i < 0) return false;
    const t = this.s.turrets[i];
    const v = Math.round(t.paid * this.sellRate());
    this.s.scrap += v;
    this.s.turrets.splice(i, 1);
    const [x, y] = this.map.slots[slot];
    this.float(x, y - 30, `+${v}`, '#9cff57');
    this.events.push({ type: 'sound', name: 'sell' });
    return true;
  }

  /* ───────── research ───────── */
  owned(id: ResearchId) {
    return this.research.has(id);
  }
  researchable(id: ResearchId) {
    const def = RESEARCH.find((r) => r.id === id);
    if (!def || this.research.has(id)) return false;
    return !def.requires || this.research.has(def.requires);
  }
  buyResearch(id: ResearchId) {
    if (!this.playing) return false;
    const def = RESEARCH.find((r) => r.id === id);
    if (!def || !this.researchable(id) || this.s.scrap < def.cost) return false;
    this.s.scrap -= def.cost;
    this.research.add(id);
    saveResearch(this.research);
    this.events.push({ type: 'banner', banner: { kind: 'unlock', text: `${def.name} researched`, sub: def.blurb } });
    this.events.push({ type: 'sound', name: 'upgrade' });
    return true;
  }

  /* ───────── abilities ───────── */
  abilityOpen(kind: AbilityKind) {
    const def = ABILITIES[kind];
    return !def.research || this.research.has(def.research);
  }
  abilityReady(kind: AbilityKind) {
    return this.playing && !this.s.paused && this.abilityOpen(kind) && this.s.abilities[kind] <= 0;
  }
  useAbility(kind: AbilityKind, x = 0, y = 0) {
    const s = this.s;
    if (!this.abilityReady(kind)) return false;
    const def = ABILITIES[kind];
    if (kind === 'airstrike') {
      const bombs: [number, number][] = Array.from({ length: AIRSTRIKE.bombs }, (_, i) => {
        const a = (i / AIRSTRIKE.bombs) * Math.PI * 2 + rand(0, 1);
        return [Math.cos(a) * rand(10, AIRSTRIKE.spread), Math.sin(a) * rand(10, AIRSTRIKE.spread)];
      });
      s.strikes.push({ x, y, t: 0, bombs });
      this.events.push({ type: 'sound', name: 'wave' });
    } else if (kind === 'barricade') {
      // snap to the nearest lane point
      let best: { lane: number; s: number; d: number } | null = null;
      this.map.lanes.forEach((l, li) => {
        for (let d = 20; d < l.len - 40; d += 6) {
          const [px, py] = laneAt(l, d);
          const dist = Math.hypot(px - x, py - y);
          if (!best || dist < best.d) best = { lane: li, s: d, d: dist };
        }
      });
      if (!best || (best as { d: number }).d > 34) return false;
      const b = best as { lane: number; s: number; d: number };
      const [bx, by] = laneAt(this.map.lanes[b.lane], b.s);
      s.barricades.push({ lane: b.lane, s: b.s, x: bx, y: by, hp: BARRICADE.hp, maxHp: BARRICADE.hp, life: BARRICADE.life });
      this.burst(bx, by, 14, '#b8b0a2', 0.9);
      this.events.push({ type: 'sound', name: 'build' });
    } else if (kind === 'drone') {
      s.drones.push({ x: this.map.fort.x, y: this.map.fort.y - 40, life: DRONE.life, cool: 0, angle: Math.PI });
      this.events.push({ type: 'sound', name: 'upgrade' });
    } else if (kind === 'overcharge') {
      s.overcharge = OVERCHARGE.life;
      for (const t of s.turrets) {
        const [tx, ty] = this.map.slots[t.slot];
        this.burst(tx, ty, 10, '#ffd96a', 1, true);
      }
      this.events.push({ type: 'sound', name: 'purge' });
    }
    s.abilities[kind] = def.cooldown * (this.research.has('reload') ? 0.8 : 1);
    return true;
  }

  /* ───────── waves ───────── */
  sendWave() {
    const s = this.s;
    if (s.status !== 'build' || s.paused) return;
    const next = s.wave + 1;
    // survival: every ten waves the fortress moves to new ground, guns refunded in full
    if (this.mode === 'survival') {
      const map = mapForWave(next, this.mapOrder);
      if (map !== this.map) {
        const refund = s.turrets.reduce((a, t) => a + t.paid, 0);
        s.scrap += refund;
        s.turrets = [];
        s.enemies = [];
        s.shots = [];
        s.bolts = [];
        s.barricades = [];
        s.drones = [];
        this.map = map;
        s.status = 'build';
        s.breakLeft = WAVE_BREAK + 6;
        this.events.push({ type: 'banner', banner: { kind: 'ground', text: map.name, sub: `${map.tagline} Guns refunded: +${refund} scrap. Rebuild, then send wave ${next}.` } });
        this.events.push({ type: 'sound', name: 'clear' });
        return;
      }
    }
    const before = (Object.keys(TURRETS) as TurretKind[]).filter((k) => s.wave >= TURRETS[k].unlockWave);
    s.wave = next;
    const opened = (Object.keys(TURRETS) as TurretKind[]).filter((k) => next >= TURRETS[k].unlockWave && !before.includes(k) && !this.research.has(k as ResearchId));
    if (opened.length) this.events.push({ type: 'banner', banner: { kind: 'unlock', text: `${TURRETS[opened[0]].name} unlocked`, sub: 'New gun on the build bar for this session.' } });
    s.status = 'wave';
    s.spawnAt = 0.4;
    s.breakLeft = WAVE_BREAK;
    s.queue = this.composeWave(next);
    const bossEvery = this.mission?.bossEvery ?? 5;
    const bossWave = next % bossEvery === 0 || (this.mission ? next === this.mission.waves : false);
    if (bossWave) {
      const idx = Math.ceil(next / bossEvery) - 1;
      const name = BOSS_NAMES[Math.max(0, idx) % BOSS_NAMES.length];
      const def = ENEMIES.boss;
      const hp = Math.round(def.hp * (1 + Math.max(0, idx) * 0.85) * (this.mission?.pressure ?? 1));
      s.boss = { id: nextId++, lane: Math.floor(Math.random() * this.map.lanes.length), s: 0, speed: def.speed, hp, maxHp: hp, r: def.r, kind: 'boss', wobble: 0, hit: 0, name, scrap: def.scrap, leak: def.leak, slow: 0, healAt: 0, held: false };
      s.enemies.push(s.boss);
      this.events.push({ type: 'banner', banner: { kind: 'boss', text: name, sub: `Boss wave ${next}. Bring it down before it reaches the gate.` } });
      this.events.push({ type: 'sound', name: 'boss' });
    } else {
      if (!opened.length) this.events.push({ type: 'banner', banner: { kind: 'wave', text: `Wave ${next}${this.mission ? ` / ${this.mission.waves}` : ''}`, sub: next === 1 ? 'The horde is on the lane.' : `${s.queue.length} units incoming.` } });
      this.events.push({ type: 'sound', name: 'wave' });
    }
  }
  /** What marches in a wave: the mix shifts as the waves go on; missions set when each special first shows. */
  private composeWave(w: number): EnemyKind[] {
    const m = this.mission;
    const n = Math.round(waveSize(w, w % (m?.bossEvery ?? 5) === 0) * (m?.pressure ?? 1));
    const first = (k: EnemyKind, dflt: number) => m?.firstWave?.[k] ?? dflt;
    const out: EnemyKind[] = [];
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      let kind: EnemyKind = 'grunt';
      if (w >= first('brute', 3) && roll < Math.min(0.28, 0.08 + w * 0.02)) kind = 'brute';
      else if (w >= first('runner', 2) && roll < Math.min(0.5, 0.2 + w * 0.03)) kind = 'runner';
      if (w >= first('healer', 4) && i % 9 === 4) kind = 'healer';
      if (w >= first('armored', 6) && i % 7 === 3) kind = 'armored';
      if (w >= first('swarm', 7) && i % 10 === 6) kind = 'swarm';
      out.push(kind);
    }
    return out;
  }
  /** A manual strike on the field: the commander's sidearm. */
  strike(x: number, y: number) {
    const s = this.s;
    if (!this.playing) return false;
    let best: Enemy | null = null;
    let bd = 26;
    for (const e of s.enemies) {
      const [ex, ey] = this.pos(e);
      const d = Math.hypot(ex - x, ey - y);
      if (d < bd + e.r) {
        bd = d;
        best = e;
      }
    }
    if (best) {
      this.damage(best, 3, '#f1efe6', 'heavy');
      this.events.push({ type: 'sound', name: 'shot' });
      return true;
    }
    this.burst(x, y, 5, '#8aa0b4', 0.6);
    return false;
  }

  /* ───────── helpers ───────── */
  private burst(x: number, y: number, n: number, color: string, power = 1, glow = false) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(30, 160) * power;
      this.s.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rand(0.3, 0.8), color, r: rand(1.5, 3.5) * power, glow });
    }
  }
  private float(x: number, y: number, text: string, color: string) {
    this.s.floats.push({ x, y, text, color, life: 0 });
  }
  private spawn(kind: EnemyKind, lane: number, s0 = 0) {
    const def = ENEMIES[kind];
    const hp = Math.round(def.hp * hpScale(this.s.wave) * (this.mission?.pressure ?? 1));
    this.s.enemies.push({
      id: nextId++,
      lane,
      s: s0,
      speed: def.speed * rand(0.92, 1.08),
      hp,
      maxHp: hp,
      r: def.r,
      kind,
      wobble: rand(0, Math.PI * 2),
      hit: 0,
      scrap: def.scrap,
      leak: def.leak,
      slow: 0,
      healAt: rand(1, 2.5),
      held: false,
    });
  }
  private explode(x: number, y: number, dmg: number, radius: number, color: string) {
    const s = this.s;
    s.waves.push({ x, y, r: 0, max: radius, kill: false, color });
    this.burst(x, y, 24, color, 1.4, true);
    this.burst(x, y, 10, '#ffd96a', 1, true);
    s.shake = Math.max(s.shake, 0.2);
    for (const e of [...s.enemies]) {
      const [ex, ey] = this.pos(e);
      if (Math.hypot(ex - x, ey - y) <= radius + e.r) this.damage(e, dmg, color, 'heavy');
    }
    for (const b of s.barricades) if (Math.hypot(b.x - x, b.y - y) <= radius) b.hp -= dmg * 0.5;
  }
  private damage(e: Enemy, dmg: number, color: string, type: 'bullet' | 'energy' | 'heavy') {
    const s = this.s;
    const armor = this.research.has('ap_rounds') ? 0.7 : ARMOR_FACTOR;
    const real = e.kind === 'armored' && type === 'bullet' ? dmg * armor : dmg;
    e.hp -= real;
    e.hit = 0.1;
    const [x, y] = this.pos(e);
    this.burst(x, y, 3, color, 0.6);
    if (e.hp <= 0 && s.enemies.includes(e)) {
      s.enemies.splice(s.enemies.indexOf(e), 1);
      s.kills += 1;
      const bonus = Math.round(e.scrap * (1 + s.wave * 0.04));
      s.scrap += bonus;
      const big = e.kind === 'boss' || e.kind === 'brute';
      this.burst(x, y, e.kind === 'boss' ? 110 : big ? 26 : 12, '#ff3b3b', e.kind === 'boss' ? 2.6 : big ? 1.4 : 1);
      if (e.kind !== 'swarm') this.float(x, y - 14, `+${bonus}`, '#f2b31f');
      this.events.push({ type: 'sound', name: e.kind === 'boss' ? 'bigkill' : 'kill' });
      if (e.kind === 'boss') {
        s.boss = null;
        s.shake = 0.7;
        s.flash = 1;
        s.waves.push({ x, y, r: 0, max: 380, kill: false, color: '#ffd96a' });
      }
    }
  }
  private leak(e: Enemy, input: WorldInput) {
    const s = this.s;
    const [x, y] = this.pos(e);
    s.enemies.splice(s.enemies.indexOf(e), 1);
    if (e.kind === 'boss') s.boss = null;
    if (Math.random() < input.fill * 0.9) {
      s.shieldBlocks += 1;
      s.shieldFlicker = 0.4;
      this.burst(x, y, 14, '#38e8ff', 1, true);
      this.float(x, y - 16, 'BLOCKED', '#38e8ff');
      this.events.push({ type: 'sound', name: 'block' });
      return;
    }
    s.hp = Math.max(0, s.hp - e.leak);
    s.shake = 0.35;
    s.fortHit = 0.5;
    s.tint = Math.max(s.tint, 0.5);
    this.burst(x, y, 16, '#ff3b3b', 1.2);
    this.float(x, y - 16, `-${e.leak} HP`, '#ff3b3b');
    this.events.push({ type: 'sound', name: 'leak' });
    if (s.hp <= 0 && s.status !== 'over') {
      s.status = 'over';
      this.recordBest(s.wave - 1);
      this.events.push({ type: 'banner', banner: { kind: 'over', text: 'The gate has fallen', sub: `You held ${s.wave} waves.` } });
      this.events.push({ type: 'sound', name: 'over' });
    }
  }
  private recordBest(held: number) {
    const s = this.s;
    if (this.mode !== 'survival') return;
    try {
      if (held > s.bestWave) {
        s.bestWave = held;
        localStorage.setItem(BEST_KEY, String(held));
      }
    } catch {}
  }
  private win() {
    const s = this.s;
    s.status = 'won';
    s.stars = starsFor(s.hp, s.maxHp);
    if (this.mission) {
      const c = loadCampaign();
      c.stars[this.mission.id] = Math.max(c.stars[this.mission.id] ?? 0, s.stars);
      saveCampaign(c);
    }
    s.flash = 1;
    this.events.push({ type: 'banner', banner: { kind: 'won', text: 'Ground held', sub: `${s.stars} star${s.stars === 1 ? '' : 's'}. The horde broke on the walls.` } });
    this.events.push({ type: 'sound', name: 'clear' });
  }

  /* ───────── the step ───────── */
  step(dtReal: number, input: WorldInput) {
    const s = this.s;
    const playing = this.playing;
    if (s.paused && playing) return;
    const dt = dtReal * (playing ? s.speed : 1);
    s.time += dt;

    // a purge on chain wipes the lane and pays everyone holding the line
    if (input.live && input.active && input.phase !== s.lastPhase) {
      if (input.phase === 'burn') {
        const bonus = playing ? purgeBonus(Math.max(1, s.wave)) : 0;
        if (bonus) {
          s.scrap += bonus;
          this.float(this.map.fort.x, this.map.fort.y - 60, `+${bonus} scrap`, '#ffd96a');
        }
        this.events.push({ type: 'banner', banner: { kind: 'purge', text: 'PURGE', sub: `The Warden is sending the horde to 0x…dEaD.${bonus ? ` +${bonus} scrap for holding the line.` : ''}` } });
        this.events.push({ type: 'sound', name: 'purge' });
        s.purgeAt = 0;
      } else if (input.phase === 'keep') {
        this.events.push({ type: 'banner', banner: { kind: 'garrison', text: 'Garrison pay', sub: 'The treasury takes its share of the chest.' } });
      } else if (input.phase === 'claim') {
        this.events.push({ type: 'banner', banner: { kind: 'purge', text: 'The chest opens', sub: 'A round is running on Robinhood Chain.' } });
      }
    }
    s.lastPhase = input.active ? input.phase : 'accumulate';
    if (input.live && input.active && input.phase === 'burn' && playing) {
      s.purgeAt -= dt;
      if (s.purgeAt <= 0) {
        s.waves.push({ x: this.map.fort.x, y: this.map.fort.y, r: 0, max: 640, kill: true, color: '#ffd96a' });
        s.purgeAt = 1.2;
        s.tint = Math.max(s.tint, 0.5);
      }
    }

    // cooldowns tick faster the fuller the war chest
    if (playing) {
      const tick = dt * (1 + input.fill * 0.5);
      for (const k of Object.keys(s.abilities) as AbilityKind[]) s.abilities[k] = Math.max(0, s.abilities[k] - tick);
      s.overcharge = Math.max(0, s.overcharge - dt);
    }

    if (s.status === 'build') {
      s.breakLeft -= dt;
      if (s.breakLeft <= 0) this.sendWave();
    }
    if (s.status === 'wave') {
      if (s.queue.length > 0) {
        s.spawnAt -= dt;
        if (s.spawnAt <= 0) {
          const kind = s.queue.shift()!;
          const lane = Math.floor(Math.random() * this.map.lanes.length);
          if (kind === 'swarm') for (let i = 0; i < 5; i++) this.spawn('swarm', lane, -i * 12);
          else this.spawn(kind, lane);
          s.spawnAt = Math.max(0.3, 0.95 - s.wave * 0.035) * rand(0.75, 1.25);
        }
      } else if (s.enemies.length === 0) {
        if (this.mission && s.wave >= this.mission.waves) {
          this.win();
        } else {
          s.status = 'build';
          s.breakLeft = WAVE_BREAK;
          this.recordBest(s.wave);
          const bonus = clearBonus(s.wave);
          s.scrap += bonus;
          const nextIsGround = this.mode === 'survival' && mapForWave(s.wave + 1, this.mapOrder) !== this.map;
          this.events.push({
            type: 'banner',
            banner: { kind: 'clear', text: `Wave ${s.wave} repelled`, sub: nextIsGround ? `+${bonus} scrap. New ground ahead.` : `+${bonus} scrap. Next wave in ${WAVE_BREAK}s, or send it now.` },
          });
          this.events.push({ type: 'sound', name: 'clear' });
        }
      }
    }

    // ambient horde on the title screen so the field is never dead
    if (s.status === 'title' && input.live) {
      s.spawnAt -= dt;
      if (s.spawnAt <= 0 && s.enemies.length < 16) {
        this.spawn(Math.random() < 0.2 ? 'brute' : 'grunt', 0);
        s.spawnAt = rand(0.8, 1.6);
      }
    }

    // barricades hold the lane
    for (let i = s.barricades.length - 1; i >= 0; i--) {
      const b = s.barricades[i];
      b.life -= dt;
      if (b.life <= 0 || b.hp <= 0) {
        this.burst(b.x, b.y, 18, '#b8b0a2', 1);
        s.barricades.splice(i, 1);
      }
    }

    // march, heal, leak
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      e.slow = Math.max(0, e.slow - dt);
      e.held = false;
      for (const b of s.barricades) {
        if (b.lane !== e.lane) continue;
        const gap = b.s - e.s;
        if (gap > 0 && gap < e.r + BARRICADE.width) {
          e.held = true;
          b.hp -= (e.kind === 'boss' ? 30 : e.kind === 'brute' ? 10 : 5) * dt;
          if (Math.random() < dt * 6) this.burst(b.x, b.y - 6, 2, '#b8b0a2', 0.5);
        }
      }
      if (!e.held) e.s += e.speed * (e.slow > 0 ? 0.55 : 1) * dt;
      e.wobble += dt * 7;
      e.hit = Math.max(0, e.hit - dt);
      if (e.kind === 'healer') {
        e.healAt -= dt;
        if (e.healAt <= 0) {
          e.healAt = 2.6;
          const [hx, hy] = this.pos(e);
          let healed = false;
          for (const o of s.enemies) {
            if (o === e || o.hp >= o.maxHp) continue;
            const [ox, oy] = this.pos(o);
            if (Math.hypot(ox - hx, oy - hy) < 80) {
              o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.15);
              healed = true;
              this.burst(ox, oy, 4, '#9cff57', 0.5, true);
            }
          }
          s.waves.push({ x: hx, y: hy, r: 0, max: 80, kill: false, color: '#9cff57' });
          if (healed) this.events.push({ type: 'sound', name: 'heal' });
        }
      }
      const len = (this.map.lanes[e.lane] ?? this.map.lanes[0]).len;
      if (e.s >= len - 4) {
        if (this.playing) this.leak(e, input);
        else {
          s.enemies.splice(i, 1);
          s.shieldFlicker = 0.3;
          const [x, y] = this.pos(e);
          this.burst(x, y, 8, '#38e8ff', 0.8, true);
        }
      }
    }

    // airstrikes land after their delay
    for (let i = s.strikes.length - 1; i >= 0; i--) {
      const st = s.strikes[i];
      st.t += dt;
      if (st.t >= AIRSTRIKE.delay) {
        for (const [dx, dy] of st.bombs) this.explode(st.x + dx, st.y + dy, AIRSTRIKE.dmg, AIRSTRIKE.splash, '#ff9f1c');
        this.events.push({ type: 'sound', name: 'lance' });
        s.strikes.splice(i, 1);
      }
    }

    // drones hunt the nearest target
    for (let i = s.drones.length - 1; i >= 0; i--) {
      const d = s.drones[i];
      d.life -= dt;
      d.cool -= dt * 1000;
      if (d.life <= 0) {
        this.burst(d.x, d.y, 10, '#38e8ff', 0.8, true);
        s.drones.splice(i, 1);
        continue;
      }
      let target: Enemy | null = null;
      let best = Infinity;
      for (const e of s.enemies) {
        const [ex, ey] = this.pos(e);
        const dist = Math.hypot(ex - d.x, ey - d.y);
        if (dist < best) {
          best = dist;
          target = e;
        }
      }
      if (target) {
        const [ex, ey] = this.pos(target);
        d.angle = Math.atan2(ey - d.y, ex - d.x);
        if (best > DRONE.range * 0.7) {
          d.x += Math.cos(d.angle) * DRONE.speed * dt;
          d.y += Math.sin(d.angle) * DRONE.speed * dt;
        }
        if (best <= DRONE.range && d.cool <= 0 && playing) {
          d.cool = DRONE.rate;
          s.shots.push({ x: d.x, y: d.y, vx: Math.cos(d.angle) * 700, vy: Math.sin(d.angle) * 700, life: 1.2, kind: 'sentry', target, dmg: DRONE.dmg, speed: 700, hitIds: new Set(), fromDrone: true });
          this.events.push({ type: 'sound', name: 'gatling' });
        }
      } else {
        // idle: circle the keep
        const a = s.time * 0.8;
        d.x += (this.map.fort.x + Math.cos(a) * 80 - d.x) * dt;
        d.y += (this.map.fort.y - 40 + Math.sin(a) * 40 - d.y) * dt;
      }
    }

    // turrets
    const overcharged = s.overcharge > 0;
    const fireBoost = (input.live && input.active ? 0.5 : 1) * (overcharged ? OVERCHARGE.boost : 1);
    for (const t of s.turrets) {
      const def = TURRETS[t.kind];
      const [tx, ty] = this.map.slots[t.slot];
      const range = def.range * (1 + (t.level - 1) * 0.12);
      t.cool -= dt * 1000;
      t.flash = Math.max(0, t.flash - dt);
      t.recoil = Math.max(0, t.recoil - dt * 7);
      let target: Enemy | null = null;
      let best = -1;
      for (const e of s.enemies) {
        const [ex, ey] = this.pos(e);
        const d = Math.hypot(ex - tx, ey - ty);
        const score = e.s + (e.kind === 'healer' ? 10_000 : 0);
        if (d <= range && score > best) {
          best = score;
          target = e;
        }
      }
      if (!target) {
        t.angle += Math.sin(s.time * 0.6 + t.slot) * dt * 0.3;
        continue;
      }
      const [ex, ey] = this.pos(target);
      const want = Math.atan2(ey - ty, ex - tx);
      let diff = want - t.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      t.angle += diff * Math.min(1, dt * 10);
      if (t.cool > 0 || !playing) continue;
      t.cool = def.rate * fireBoost * rand(0.9, 1.1);
      t.flash = 0.09;
      t.recoil = 1;
      t.shots += 1;
      const charged = t.level >= EXPERIMENTAL_LEVEL && t.shots % CHARGED_EVERY === 0;
      const dmg = def.dmg * levelMul(t.level) * (charged ? 3 : 1);
      if (charged) {
        t.flash = 0.2;
        this.burst(tx, ty, 8, '#ffffff', 0.8, true);
      }
      if (t.kind === 'tesla') {
        let cur: Enemy | null = target;
        let fx = tx;
        let fy = ty;
        const hitIds = new Set<number>();
        for (let c = 0; c < (def.chain ?? 1) + (charged ? 2 : 0) && cur; c++) {
          const [cx, cy] = this.pos(cur);
          s.bolts.push({ x0: fx, y0: fy, x1: cx, y1: cy, life: 0.14, max: 0.14, color: charged ? '#ffffff' : def.color, width: charged ? 4 : 2.5 });
          hitIds.add(cur.id);
          cur.slow = 0.7;
          this.damage(cur, dmg, def.color, def.type);
          fx = cx;
          fy = cy;
          let nx: Enemy | null = null;
          let nd = 90;
          for (const e of s.enemies) {
            if (hitIds.has(e.id)) continue;
            const [ex2, ey2] = this.pos(e);
            const d = Math.hypot(ex2 - cx, ey2 - cy);
            if (d < nd) {
              nd = d;
              nx = e;
            }
          }
          cur = nx;
        }
        this.events.push({ type: 'sound', name: 'tesla' });
        continue;
      }
      if (t.kind === 'lance') {
        const laneOf = this.map.lanes[target.lane] ?? this.map.lanes[0];
        const lead = Math.min(target.s + (target.held ? 0 : target.speed * 0.55), laneOf.len);
        const [lx, ly] = laneAt(laneOf, lead);
        s.shots.push({ x: tx, y: ty, vx: 0, vy: 0, life: 2, kind: 'lance', target: null, dmg, speed: 0, hitIds: new Set(), charged, arc: { x0: tx, y0: ty, x1: lx, y1: ly, t: 0, dur: 0.55 } });
        this.events.push({ type: 'sound', name: 'lance' });
        continue;
      }
      s.shots.push({
        x: tx + Math.cos(t.angle) * 18,
        y: ty + Math.sin(t.angle) * 18,
        vx: Math.cos(t.angle) * def.speed,
        vy: Math.sin(t.angle) * def.speed,
        life: def.pierce ? 0.45 : 1.6,
        kind: t.kind,
        target: def.pierce ? null : target,
        dmg,
        speed: def.speed,
        hitIds: new Set(),
        charged,
      });
      if (t.kind === 'rail' || charged) {
        const len = range + 60;
        s.bolts.push({ x0: tx, y0: ty, x1: tx + Math.cos(t.angle) * len, y1: ty + Math.sin(t.angle) * len, life: 0.3, max: 0.3, color: charged ? '#ffffff' : def.color, width: 5 });
        s.shake = Math.max(s.shake, 0.12);
      }
      this.events.push({ type: 'sound', name: t.kind === 'gatling' ? 'gatling' : t.kind === 'rail' || charged ? 'rail' : 'shot' });
    }

    // shots
    for (let i = s.shots.length - 1; i >= 0; i--) {
      const sh = s.shots[i];
      const def = TURRETS[sh.kind];
      sh.life -= dt;
      if (sh.arc) {
        sh.arc.t += dt / sh.arc.dur;
        const k = Math.min(1, sh.arc.t);
        sh.x = sh.arc.x0 + (sh.arc.x1 - sh.arc.x0) * k;
        sh.y = sh.arc.y0 + (sh.arc.y1 - sh.arc.y0) * k;
        if (k >= 1) {
          this.explode(sh.x, sh.y, sh.dmg, (def.splash ?? 50) * (sh.charged ? 1.4 : 1), def.color);
          s.shots.splice(i, 1);
        }
        continue;
      }
      const tg = sh.target;
      if (tg && s.enemies.includes(tg)) {
        const [tx, ty] = this.pos(tg);
        const dx = tx - sh.x;
        const dy = ty - sh.y;
        const d = Math.hypot(dx, dy) || 1;
        sh.vx = (dx / d) * sh.speed;
        sh.vy = (dy / d) * sh.speed;
        if (d < tg.r + 5) {
          this.damage(tg, sh.dmg, def.color, def.type);
          s.shots.splice(i, 1);
          continue;
        }
      } else if (tg) {
        sh.target = null;
      }
      if (def.pierce) {
        for (const e of [...s.enemies]) {
          if (sh.hitIds.has(e.id)) continue;
          const [ex, ey] = this.pos(e);
          if (Math.hypot(ex - sh.x, ey - sh.y) < e.r + 7) {
            sh.hitIds.add(e.id);
            this.damage(e, sh.dmg, def.color, def.type);
          }
        }
      }
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      if (sh.life <= 0 || sh.x < -60 || sh.x > 1020 || sh.y < -60 || sh.y > 600) s.shots.splice(i, 1);
    }

    for (let i = s.waves.length - 1; i >= 0; i--) {
      const w = s.waves[i];
      const grow = dt * (w.kill ? 560 : w.max < 100 ? 180 : 320);
      w.r += grow;
      if (w.kill) {
        for (const e of [...s.enemies]) {
          const [ex, ey] = this.pos(e);
          const d = Math.hypot(ex - w.x, ey - w.y);
          if (d < w.r + 26 && d > w.r - 26 - grow) this.damage(e, 9999, '#ffd96a', 'heavy');
        }
      }
      if (w.r > w.max) s.waves.splice(i, 1);
    }
    for (let i = s.bolts.length - 1; i >= 0; i--) {
      s.bolts[i].life -= dt;
      if (s.bolts[i].life <= 0) s.bolts.splice(i, 1);
    }
    for (let i = s.parts.length - 1; i >= 0; i--) {
      const q = s.parts[i];
      q.life += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.96;
      q.vy *= 0.96;
      if (q.life >= q.max) s.parts.splice(i, 1);
    }
    for (let i = s.floats.length - 1; i >= 0; i--) {
      const f = s.floats[i];
      f.life += dt;
      f.y -= dt * 26;
      if (f.life > 1.1) s.floats.splice(i, 1);
    }
    s.shieldFlicker = Math.max(0, s.shieldFlicker - dt);
    s.tint = Math.max(0, s.tint - dt * 0.9);
    s.flash = Math.max(0, s.flash - dt * 2.2);
    s.shake = Math.max(0, s.shake - dt);
    s.fortHit = Math.max(0, s.fortHit - dt);
  }

  drain(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
