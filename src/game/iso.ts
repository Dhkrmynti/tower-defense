/* Two ways to look at the same world: straight down, or isometric. The sim never knows which. */
import { H, W } from './maps';

export type ViewMode = 'top' | 'iso' | 'three';

export interface Proj {
  mode: ViewMode;
  /** 2D matrix (a b c d) and the projected bounding box of the 960×540 world. */
  a: number;
  b: number;
  c: number;
  d: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

const ISO_A = 0.9; // horizontal stretch
const ISO_B = 0.5; // vertical squash

export function makeProj(mode: ViewMode): Proj {
  // the 3D view has its own camera; its projection record is only a placeholder
  if (mode === 'top' || mode === 'three') return { mode, a: 1, b: 0, c: 0, d: 1, minX: 0, minY: 0, width: W, height: H };
  const a = ISO_A;
  const b = ISO_B;
  // X = a*(x - y), Y = b*(x + y)
  const corners = [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ].map(([x, y]) => [a * (x - y), b * (x + y)]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { mode, a, b, c: -a, d: b, minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** World → projected plane (before the view scale). */
export const project = (p: Proj, x: number, y: number): [number, number] => [p.a * x + p.c * y - p.minX, p.b * x + p.d * y - p.minY];
/** Projected plane → world. */
export function unproject(p: Proj, X: number, Y: number): [number, number] {
  const px = X + p.minX;
  const py = Y + p.minY;
  const det = p.a * p.d - p.b * p.c;
  return [(p.d * px - p.c * py) / det, (-p.b * px + p.a * py) / det];
}
/** Apply the world→plane transform on top of the current canvas transform. */
export const applyProj = (ctx: CanvasRenderingContext2D, p: Proj) => ctx.transform(p.a, p.b, p.c, p.d, -p.minX, -p.minY);

export const VIEW_KEY = 'bastion_view';
export const loadViewMode = (): ViewMode => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'top' || v === 'iso' || v === 'three') return v;
  } catch {}
  return 'three';
};
export const saveViewMode = (v: ViewMode) => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
};
