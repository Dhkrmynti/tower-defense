import { fortressStage } from '../components/bastion/lore';
import { H, W, laneAt, type MapDef } from './maps';
import { applyProj, project, type Proj } from './iso';
import type { Enemy, Sim, WorldInput } from './sim';
import { sprites } from './sprites';
import { ABILITIES, AIRSTRIKE, BARRICADE, EXPERIMENTAL_LEVEL, TURRETS, type AbilityKind } from './world';

export interface View {
  scale: number;
  ox: number;
  oy: number;
  proj: Proj;
}
export interface Targeting {
  kind: AbilityKind;
  x: number;
  y: number;
}

const C = {
  grid: '#13201a',
  pathEdge: '#2a3f33',
  path: '#1c2a23',
  steelLine: '#2f473c',
  brass: '#f2b31f',
  brassHot: '#ffd96a',
  shield: '#38e8ff',
  enemy: '#ff3b3b',
  ink: '#070b08',
};

/* ───────── helpers ───────── */
function glow(ctx: CanvasRenderingContext2D, color: string | null, blur = 10) {
  if (!color) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    return;
  }
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
}
const darkCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** A darkened copy of a sprite, for the sides of an extruded block. */
function dark(img: HTMLCanvasElement): HTMLCanvasElement {
  const hit = darkCache.get(img);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = 'rgba(4,8,6,0.55)';
  x.fillRect(0, 0, c.width, c.height);
  darkCache.set(img, c);
  return c;
}
/** Draw a flat sprite on the ground plane (through the projection), optionally extruded up in iso. */
function flat(ctx: CanvasRenderingContext2D, v: View, img: HTMLCanvasElement, x: number, y: number, size: number, rot = 0, height = 0) {
  const [X, Y] = project(v.proj, x, y);
  const p = v.proj;
  const steps = p.mode === 'iso' && height > 0 ? Math.ceil(height / 2) : 0;
  // the sides: darkened copies stacked from the ground up, then the top face
  if (steps) {
    const d = dark(img);
    for (let i = 0; i < steps; i++) {
      ctx.save();
      ctx.translate(X, Y - i * 2);
      ctx.transform(p.a, p.b, p.c, p.d, 0, 0);
      ctx.rotate(rot);
      ctx.drawImage(d, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }
  ctx.save();
  ctx.translate(X, Y - steps * 2);
  ctx.transform(p.a, p.b, p.c, p.d, 0, 0);
  ctx.rotate(rot);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}
/** Draw a sprite standing upright at a world point (iso) or flat (top). */
function billboard(ctx: CanvasRenderingContext2D, v: View, img: HTMLCanvasElement, x: number, y: number, size: number, lift = 0, flip = false) {
  const [X, Y] = project(v.proj, x, y);
  ctx.save();
  ctx.translate(X, Y - lift);
  if (flip) ctx.scale(-1, 1);
  if (v.proj.mode === 'iso') ctx.drawImage(img, -size / 2, -size + size * 0.25, size, size);
  else ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}
function shadow(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, r: number) {
  const [X, Y] = project(v.proj, x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(X, Y + (v.proj.mode === 'iso' ? 2 : r * 0.5), r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}
/** A circle on the ground plane. */
function groundCircle(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, r: number, a0 = 0, a1 = Math.PI * 2) {
  ctx.save();
  applyProj(ctx, v.proj);
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.restore();
}

/* ───────── the ground, drawn once per map and view mode ───────── */
const grounds = new Map<string, HTMLCanvasElement>();
function ground(m: MapDef, p: Proj): HTMLCanvasElement {
  const key = `${m.id}:${p.mode}`;
  const cached = grounds.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = Math.ceil(p.width * 2);
  c.height = Math.ceil(p.height * 2);
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.imageSmoothingEnabled = false;
  let seed = 11 + m.id * 97;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  ctx.save();
  applyProj(ctx, p);
  ctx.fillStyle = '#0a100c';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#0d140f' : '#080d0a';
    ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 2 + Math.floor(rnd() * 3), 2);
  }
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 32) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
  }
  for (let y = 0; y <= H; y += 32) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
  }
  ctx.stroke();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const l of m.lanes) {
    ctx.beginPath();
    l.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = C.pathEdge;
    ctx.lineWidth = 46;
    ctx.stroke();
    ctx.strokeStyle = C.path;
    ctx.lineWidth = 38;
    ctx.stroke();
  }
  for (const l of m.lanes) {
    for (const seg of l.segs) {
      const n = Math.floor(seg.len / 7);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const px = seg.x0 + (seg.x1 - seg.x0) * t + (rnd() - 0.5) * 26;
        const py = seg.y0 + (seg.y1 - seg.y0) * t + (rnd() - 0.5) * 26;
        const r = rnd();
        ctx.fillStyle = r < 0.3 ? '#243830' : r < 0.6 ? '#16231c' : '#1f2e26';
        ctx.fillRect(Math.round(px), Math.round(py), 3 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 2));
      }
    }
    ctx.beginPath();
    l.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.setLineDash([10, 16]);
    ctx.strokeStyle = '#30473b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = '#121c17';
  ctx.beginPath();
  ctx.arc(m.fort.x, m.fort.y, 92, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.steelLine;
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 120; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 50 + rnd() * 38;
    ctx.fillStyle = rnd() < 0.5 ? '#182520' : '#0f1813';
    ctx.fillRect(Math.round(m.fort.x + Math.cos(a) * d), Math.round(m.fort.y + Math.sin(a) * d), 3, 2);
  }
  // flat decor stays on the ground: craters, bones, rubble
  const sp = sprites();
  for (const d of m.decor) {
    if (d.kind !== 'crater' && d.kind !== 'bones' && d.kind !== 'rubble') continue;
    const img = sp.decor[d.kind];
    ctx.drawImage(img, Math.round(d.x - img.width / 2), Math.round(d.y - img.height / 2));
  }
  ctx.restore();
  // standing decor: rocks, bushes, flags are billboards in iso
  const fakeView: View = { scale: 1, ox: 0, oy: 0, proj: p };
  const standing = m.decor.filter((d) => d.kind === 'rock' || d.kind === 'rock2' || d.kind === 'bush' || d.kind === 'flag').sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const d of standing) {
    const img = sp.decor[d.kind];
    if (p.mode === 'iso') shadow(ctx, fakeView, d.x, d.y, img.width / 2);
    billboard(ctx, fakeView, img, d.x, d.y, img.width);
  }
  if (grounds.size >= 3) grounds.delete(grounds.keys().next().value as string);
  grounds.set(key, c);
  return c;
}

/* ───────── the frame ───────── */
export function render(ctx: CanvasRenderingContext2D, sim: Sim, input: WorldInput, v: View, hoverSlot: number | null, selectedSlot: number | null, cw: number, ch: number, targeting: Targeting | null) {
  const s = sim.s;
  const m = sim.map;
  const p = v.proj;
  const sp = sprites();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#070b08';
  ctx.fillRect(0, 0, cw, ch);
  const shake = s.shake > 0 ? s.shake * 7 : 0;
  const sx = shake ? (Math.random() - 0.5) * shake : 0;
  const sy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.setTransform(v.scale, 0, 0, v.scale, v.ox + sx, v.oy + sy);
  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(ground(m, p), 0, 0, p.width, p.height);
  drawMounts(ctx, sim, v, hoverSlot, selectedSlot);
  drawShield(ctx, sim, v, input);
  drawTargeting(ctx, sim, v, targeting);

  // everything that stands on the field, back to front
  type Item = { depth: number; draw: () => void };
  const items: Item[] = [];
  const depth = (x: number, y: number) => (p.mode === 'iso' ? x + y : y);
  items.push({ depth: depth(m.fort.x, m.fort.y), draw: () => drawFortress(ctx, sim, v, input, sp.fortress) });
  for (const d of m.decor) if (d.kind === 'torch') items.push({ depth: depth(d.x, d.y), draw: () => drawTorch(ctx, v, d.x, d.y, s.time, sp.decor.torch) });
  for (const t of s.turrets) {
    const [x, y] = m.slots[t.slot];
    items.push({ depth: depth(x, y), draw: () => drawTurret(ctx, sim, v, t, sp.base, sp.barrel) });
  }
  for (const b of s.barricades) items.push({ depth: depth(b.x, b.y), draw: () => drawBarricade(ctx, sim, v, b, sp.decor.barricade) });
  for (const e of s.enemies) {
    const [x, y] = sim.pos(e);
    items.push({ depth: depth(x, y), draw: () => drawEnemy(ctx, sim, v, e, sp.enemy) });
  }
  for (const d of s.drones) items.push({ depth: depth(d.x, d.y) + 400, draw: () => drawDrone(ctx, v, d.x, d.y, d.angle, s.time, sp.decor.drone) });
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) it.draw();

  // shots
  for (const sh of s.shots) {
    const def = TURRETS[sh.kind];
    const color = sh.charged ? '#ffffff' : def.color;
    if (sh.arc) {
      const k = Math.min(1, sh.arc.t);
      const h = Math.sin(k * Math.PI) * 120;
      const [X, Y] = project(p, sh.x, sh.y);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(X, Y, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      glow(ctx, color, 14);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(X, Y - h, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X, Y - h);
      ctx.lineTo(X - 4, Y - h - 14);
      ctx.stroke();
      glow(ctx, null);
      continue;
    }
    const [X, Y] = project(p, sh.x, sh.y);
    const [TX, TY] = project(p, sh.x - sh.vx * (sh.kind === 'rail' ? 0.04 : 0.015), sh.y - sh.vy * (sh.kind === 'rail' ? 0.04 : 0.015));
    glow(ctx, color, sh.kind === 'rail' ? 16 : 8);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X, Y - (sh.fromDrone ? 26 : 0), sh.kind === 'rail' ? 4 : 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = sh.kind === 'rail' ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(X, Y - (sh.fromDrone ? 26 : 0));
    ctx.lineTo(TX, TY - (sh.fromDrone ? 26 : 0));
    ctx.stroke();
    glow(ctx, null);
  }
  for (const b of s.bolts) {
    const a = Math.min(1, b.life / b.max);
    const [X0, Y0] = project(p, b.x0, b.y0);
    const [X1, Y1] = project(p, b.x1, b.y1);
    glow(ctx, b.color, 18);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width * a;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(X0, Y0);
    if (b.width < 4) ctx.lineTo((X0 + X1) / 2 + (Math.random() - 0.5) * 18, (Y0 + Y1) / 2 + (Math.random() - 0.5) * 18);
    ctx.lineTo(X1, Y1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    glow(ctx, null);
  }
  for (const q of s.parts) {
    const [X, Y] = project(p, q.x, q.y);
    ctx.globalAlpha = 1 - q.life / q.max;
    if (q.glow) glow(ctx, q.color, 8);
    ctx.fillStyle = q.color;
    ctx.fillRect(X - q.r, Y - q.r, q.r * 2, q.r * 2);
    if (q.glow) glow(ctx, null);
  }
  ctx.globalAlpha = 1;
  for (const w of s.waves) {
    groundCircle(ctx, v, w.x, w.y, w.r);
    ctx.strokeStyle = w.color;
    ctx.globalAlpha = 1 - w.r / w.max;
    ctx.lineWidth = w.kill ? 9 : w.max < 100 ? 2 : 4;
    glow(ctx, w.color, 12);
    ctx.stroke();
    glow(ctx, null);
  }
  ctx.globalAlpha = 1;
  // airstrikes: the reticle and the falling bombs
  for (const st of s.strikes) {
    const k = st.t / AIRSTRIKE.delay;
    for (const [dx, dy] of st.bombs) {
      groundCircle(ctx, v, st.x + dx, st.y + dy, AIRSTRIKE.splash * 0.6);
      ctx.strokeStyle = '#ff9f1c';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      billboard(ctx, v, sp.decor.bomb, st.x + dx, st.y + dy, 14, (1 - k) * 220);
    }
  }
  ctx.textAlign = 'center';
  ctx.font = '700 13px "Chakra Petch", sans-serif';
  for (const f of s.floats) {
    const [X, Y] = project(p, f.x, f.y);
    ctx.globalAlpha = 1 - f.life / 1.1;
    ctx.fillStyle = C.ink;
    ctx.fillText(f.text, X + 1, Y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, X, Y);
  }
  ctx.globalAlpha = 1;

  // overlays
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (s.tint > 0) {
    ctx.fillStyle = `rgba(255,59,59,${s.tint * 0.16})`;
    ctx.fillRect(0, 0, cw, ch);
  }
  if (s.overcharge > 0) {
    ctx.fillStyle = `rgba(255,217,106,${0.04 + 0.03 * Math.sin(s.time * 12)})`;
    ctx.fillRect(0, 0, cw, ch);
  }
  if (s.flash > 0) {
    ctx.fillStyle = `rgba(255,235,200,${s.flash * 0.55})`;
    ctx.fillRect(0, 0, cw, ch);
  }
  const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.45, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  g.addColorStop(0, 'rgba(7,11,8,0)');
  g.addColorStop(1, 'rgba(7,11,8,0.65)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  if (s.status === 'title' || s.status === 'over' || s.status === 'won' || s.paused) {
    ctx.fillStyle = 'rgba(7,11,8,0.5)';
    ctx.fillRect(0, 0, cw, ch);
  }
}

function drawTorch(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, time: number, img: HTMLCanvasElement) {
  const [X, Y] = project(v.proj, x, y);
  const f = 0.7 + 0.3 * Math.sin(time * 9 + x);
  const lift = v.proj.mode === 'iso' ? 14 : 6;
  const r = ctx.createRadialGradient(X, Y - lift, 2, X, Y - lift, 46 * f);
  r.addColorStop(0, 'rgba(255,159,28,0.35)');
  r.addColorStop(1, 'rgba(255,159,28,0)');
  ctx.fillStyle = r;
  ctx.fillRect(X - 50, Y - lift - 50, 100, 100);
  billboard(ctx, v, img, x, y, img.width);
}

function drawMounts(ctx: CanvasRenderingContext2D, sim: Sim, v: View, hover: number | null, selected: number | null) {
  const s = sim.s;
  sim.map.slots.forEach(([x, y], i) => {
    const t = s.turrets.find((q) => q.slot === i);
    const active = i === selected || i === hover;
    groundCircle(ctx, v, x, y, 26);
    ctx.fillStyle = t ? '#132019' : active ? '#172b22' : '#0f1712';
    ctx.strokeStyle = active ? C.brass : t ? C.steelLine : '#243a2f';
    ctx.lineWidth = active ? 3 : 2;
    ctx.fill();
    ctx.stroke();
    if (!t) {
      groundCircle(ctx, v, x, y, 15);
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = active ? C.brass : '#2a3f33';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      const [X, Y] = project(v.proj, x, y);
      ctx.fillStyle = active ? C.brass : '#2a3f33';
      ctx.fillRect(X - 6, Y - 1.5, 12, 3);
      ctx.fillRect(X - 1.5, Y - 6, 3, 12);
    }
    if (i === selected && t) {
      const def = TURRETS[t.kind];
      groundCircle(ctx, v, x, y, def.range * (1 + (t.level - 1) * 0.12));
      ctx.fillStyle = 'rgba(242,179,31,0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(242,179,31,0.5)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
}

function drawTargeting(ctx: CanvasRenderingContext2D, sim: Sim, v: View, t: Targeting | null) {
  if (!t) return;
  const def = ABILITIES[t.kind];
  if (t.kind === 'airstrike') {
    groundCircle(ctx, v, t.x, t.y, AIRSTRIKE.spread + AIRSTRIKE.splash * 0.6);
    ctx.strokeStyle = def.color;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    const [X, Y] = project(v.proj, t.x, t.y);
    ctx.strokeStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(X - 10, Y);
    ctx.lineTo(X + 10, Y);
    ctx.moveTo(X, Y - 10);
    ctx.lineTo(X, Y + 10);
    ctx.stroke();
  } else if (t.kind === 'barricade') {
    // show where the wall would snap
    let best: [number, number, number] | null = null;
    let bd = Infinity;
    for (const l of sim.map.lanes)
      for (let d = 20; d < l.len - 40; d += 6) {
        const [px, py, a] = laneAt(l, d);
        const dist = Math.hypot(px - t.x, py - t.y);
        if (dist < bd) {
          bd = dist;
          best = [px, py, a];
        }
      }
    if (best && bd <= 34) {
      const [px, py, a] = best;
      ctx.save();
      applyProj(ctx, v.proj);
      ctx.translate(px, py);
      ctx.rotate(a + Math.PI / 2);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 3;
      ctx.strokeRect(-BARRICADE.width - 4, -5, BARRICADE.width * 2 + 8, 10);
      ctx.restore();
    }
  }
}

function drawShield(ctx: CanvasRenderingContext2D, sim: Sim, v: View, input: WorldInput) {
  const s = sim.s;
  const { x, y } = sim.map.fort;
  const segs = 28;
  const lit = Math.round(Math.max(0, Math.min(1, input.fill)) * segs);
  const full = input.fill >= 0.999;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.72) / segs) * Math.PI * 2 - Math.PI / 2;
    const on = i < lit;
    groundCircle(ctx, v, x, y, 100, a0, a1);
    ctx.lineWidth = on ? 6 : 3;
    ctx.strokeStyle = on ? (full ? C.brassHot : C.shield) : '#1f3129';
    ctx.globalAlpha = Math.min(1, (on ? 0.7 + 0.3 * Math.sin(s.time * 4 + i * 0.4) : 0.35) + s.shieldFlicker);
    if (on) glow(ctx, full ? C.brassHot : C.shield, 14);
    ctx.stroke();
    glow(ctx, null);
  }
  ctx.globalAlpha = 1;
  if (s.shieldFlicker > 0) {
    groundCircle(ctx, v, x, y, 100);
    glow(ctx, C.shield, 24);
    ctx.strokeStyle = C.shield;
    ctx.globalAlpha = s.shieldFlicker * 1.6;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.globalAlpha = 1;
    glow(ctx, null);
  }
}

function drawFortress(ctx: CanvasRenderingContext2D, sim: Sim, v: View, input: WorldInput, imgs: HTMLCanvasElement[]) {
  const s = sim.s;
  const level = fortressStage(input.burnedPct).level;
  const { x, y } = sim.map.fort;
  const img = imgs[level - 1];
  const hit = s.fortHit > 0 ? Math.sin(s.fortHit * 40) * 3 : 0;
  flat(ctx, v, img, x + hit, y, img.width * (v.proj.mode === 'iso' ? 1.35 : 1.1), 0, 12 + level * 3);
  if (s.fortHit > 0) {
    const [X, Y] = project(v.proj, x, y);
    ctx.fillStyle = `rgba(255,59,59,${s.fortHit * 0.4})`;
    ctx.beginPath();
    ctx.arc(X, Y - 10, img.width * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  if (level >= 5) {
    const [X, Y] = project(v.proj, x, y);
    glow(ctx, C.brassHot, 30);
    ctx.fillStyle = C.brassHot;
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(s.time * 3);
    ctx.beginPath();
    ctx.arc(X, Y - (v.proj.mode === 'iso' ? 26 : 0), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    glow(ctx, null);
  }
}

function drawTurret(ctx: CanvasRenderingContext2D, sim: Sim, v: View, t: Sim['s']['turrets'][number], bases: HTMLCanvasElement[], barrels: Record<string, HTMLCanvasElement>) {
  const def = TURRETS[t.kind];
  const [x, y] = sim.map.slots[t.slot];
  const p = v.proj;
  const base = bases[Math.min(2, t.level - 1)];
  const height = p.mode === 'iso' ? 8 : 0;
  flat(ctx, v, base, x, y, base.width, 0, height);
  const [X, Y] = project(p, x, y);
  const lift = p.mode === 'iso' ? height : 0;
  // barrel: flat on the ground plane, rotated, with recoil
  ctx.save();
  ctx.translate(X, Y - lift);
  ctx.transform(p.a, p.b, p.c, p.d, 0, 0);
  ctx.rotate(t.angle);
  ctx.translate(-t.recoil * 5, 0);
  ctx.drawImage(barrels[t.kind], -16, -16);
  ctx.restore();
  // cap, flash and level pips in screen space
  const color = t.level >= EXPERIMENTAL_LEVEL ? '#ffffff' : def.color;
  glow(ctx, color, sim.s.overcharge > 0 ? 18 : 8);
  ctx.fillStyle = sim.s.overcharge > 0 && Math.sin(sim.s.time * 20) > 0 ? '#ffd96a' : color;
  ctx.fillRect(X - 4, Y - lift - 4, 8, 8);
  glow(ctx, null);
  if (t.flash > 0) {
    const mx = t.kind === 'rail' ? 36 : 28;
    const fx = x + Math.cos(t.angle) * mx;
    const fy = y + Math.sin(t.angle) * mx;
    const [FX, FY] = project(p, fx, fy);
    glow(ctx, C.brassHot, 20);
    ctx.fillStyle = t.flash > 0.1 ? '#ffffff' : C.brassHot;
    ctx.globalAlpha = Math.min(1, t.flash / 0.09);
    ctx.beginPath();
    ctx.arc(FX, FY - lift, t.flash > 0.1 ? 12 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    glow(ctx, null);
  }
  for (let i = 0; i < t.level; i++) {
    ctx.fillStyle = i === 3 ? '#ffffff' : C.brassHot;
    ctx.fillRect(X - 11 + i * 6, Y + 20, 4, 4);
  }
}

function drawBarricade(ctx: CanvasRenderingContext2D, sim: Sim, v: View, b: Sim['s']['barricades'][number], img: HTMLCanvasElement) {
  const [, , a] = laneAt(sim.map.lanes[b.lane] ?? sim.map.lanes[0], b.s);
  flat(ctx, v, img, b.x, b.y, 36, a + Math.PI / 2, v.proj.mode === 'iso' ? 8 : 0);
  const [X, Y] = project(v.proj, b.x, b.y);
  ctx.fillStyle = C.ink;
  ctx.fillRect(X - 15, Y - 26, 30, 5);
  ctx.fillStyle = '#b8b0a2';
  ctx.fillRect(X - 14, Y - 25, (28 * b.hp) / b.maxHp, 3);
}

function drawDrone(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, angle: number, time: number, img: HTMLCanvasElement) {
  shadow(ctx, v, x, y, 10);
  const [X, Y] = project(v.proj, x, y);
  const bob = Math.sin(time * 6) * 3;
  ctx.save();
  ctx.translate(X, Y - 28 + bob);
  if (Math.cos(angle) < 0) ctx.scale(-1, 1);
  ctx.drawImage(img, -14, -8, 28, 16);
  ctx.restore();
  glow(ctx, C.shield, 10);
  ctx.fillStyle = C.shield;
  ctx.fillRect(X - 2, Y - 30 + bob, 4, 4);
  glow(ctx, null);
}

function drawEnemy(ctx: CanvasRenderingContext2D, sim: Sim, v: View, e: Enemy, imgs: Record<string, HTMLCanvasElement>) {
  const [x, y, heading] = sim.pos(e);
  const p = v.proj;
  const img = imgs[e.kind];
  const step = Math.sin(e.wobble);
  const size = e.kind === 'boss' ? e.r * 2.6 : e.r * 2.5;
  shadow(ctx, v, x, y, e.r);
  const [X, Y] = project(p, x, y);
  ctx.save();
  ctx.translate(X, Y);
  if (p.mode === 'top') {
    ctx.rotate(heading);
    if (e.kind !== 'boss') {
      ctx.fillStyle = C.ink;
      ctx.fillRect(-2 + step * 3, -e.r - 1, 3, 3);
      ctx.fillRect(-2 - step * 3, e.r - 2, 3, 3);
      ctx.scale(1 + step * 0.06, 1 - step * 0.06);
    }
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else {
    // upright, facing the way it walks, bobbing with each step
    const flip = Math.cos(heading) - Math.sin(heading) < 0;
    if (flip) ctx.scale(-1, 1);
    if (e.kind !== 'boss') {
      ctx.fillStyle = C.ink;
      ctx.fillRect(-5 + step * 3, -2, 3, 4);
      ctx.fillRect(2 - step * 3, -2, 3, 4);
    }
    ctx.translate(0, Math.abs(step) * -2);
    ctx.scale(1 + step * 0.05, 1 - step * 0.05);
    ctx.drawImage(img, -size / 2, -size + size * 0.2, size, size);
  }
  if (e.hit > 0) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, p.mode === 'iso' ? -size * 0.3 : 0, e.r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  const top = p.mode === 'iso' ? Y - size * 0.8 : Y - e.r;
  if (e.kind === 'healer') {
    groundCircle(ctx, v, x, y, 80, sim.s.time, sim.s.time + Math.PI * 2);
    ctx.strokeStyle = 'rgba(156,255,87,0.45)';
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (e.slow > 0) {
    groundCircle(ctx, v, x, y, e.r + 5);
    glow(ctx, C.shield, 10);
    ctx.strokeStyle = C.shield;
    ctx.lineWidth = 2;
    ctx.stroke();
    glow(ctx, null);
  }
  if (e.held) {
    ctx.fillStyle = '#b8b0a2';
    ctx.fillRect(X - 2, top - 20, 4, 4);
  }
  if (e.hp < e.maxHp) {
    const w = e.kind === 'boss' ? 60 : e.kind === 'swarm' ? 12 : 22;
    ctx.fillStyle = C.ink;
    ctx.fillRect(X - w / 2 - 1, top - 13, w + 2, 5);
    ctx.fillStyle = e.kind === 'boss' ? C.enemy : C.brassHot;
    ctx.fillRect(X - w / 2, top - 12, (w * e.hp) / e.maxHp, 3);
  }
}
