// Art loader + generated placeholder art.
// Apollo's files (listed in art.json, which the build writes from assets/) win;
// anything missing falls back to code-drawn placeholder pixel art.
import type { AgentDef, PlayerDef, RoomDef, Rect } from "./types";

export interface Sheet { img: CanvasImageSource; fw: number; fh: number }
export interface SpriteSet { sheet: Sheet; sheet2x?: Sheet; still?: CanvasImageSource; still2x?: CanvasImageSource; stillOnly: boolean; fromArt: boolean }
export interface ArtManifest { v?: string; sprites: string[]; rooms: string[]; spriteMeta?: { frame_size?: number; frames_per_row?: number; rows?: string[]; still?: string[] } }

const BASE = import.meta.env.BASE_URL;
export async function loadManifest(): Promise<ArtManifest> {
  try {
    const r = await fetch(`${BASE}art.json`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    return { v: j.v, sprites: Array.isArray(j.sprites) ? j.sprites : [], rooms: Array.isArray(j.rooms) ? j.rooms : [], spriteMeta: j.spriteMeta };
  } catch { return { sprites: [], rooms: [] }; }
}
function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
const url = (m: ArtManifest, path: string) => `${BASE}assets/${path}${m.v ? `?v=${m.v}` : ""}`;

// ---------- placeholder characters: 4x4 sheet, 48px frames (same layout as Apollo's) ----------
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  r = f(r); g = f(g); b = f(b);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
export function placeholderSheet(c: { body: string; hair: string; skin: string }): Sheet {
  const P = 3, F = 16; // 16x16 logical pixels at 3x = 48px frames
  const cv = document.createElement("canvas"); cv.width = F * P * 4; cv.height = F * P * 4;
  const g = cv.getContext("2d")!;
  for (let row = 0; row < 4; row++) for (let fr = 0; fr < 4; fr++) {
    const ox = fr * F, oy = row * F;
    const px = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect((ox + x) * P, (oy + y) * P, w * P, h * P); };
    const step = fr === 1 ? 1 : fr === 3 ? -1 : 0; const bob = fr % 2 ? 0 : 0;
    const out = "#141821";
    // legs
    const ll = step > 0 ? 1 : 0, rl = step < 0 ? 1 : 0;
    px(5, 12 + bob, 2, 3 - ll, shade(c.body, -0.55)); px(9, 12 + bob, 2, 3 - rl, shade(c.body, -0.55));
    px(5, 15 - ll, 2, 1, out); px(9, 15 - rl, 2, 1, out);
    // body
    px(4, 7, 8, 5, c.body); px(4, 11, 8, 1, shade(c.body, -0.3)); px(4, 7, 1, 5, shade(c.body, -0.2)); px(11, 7, 1, 5, shade(c.body, -0.2));
    // arms swing
    const al = row === 0 || row === 3 ? step : 0;
    if (row !== 2) px(3, 7 + Math.max(0, al), 1, 4, shade(c.body, -0.35));
    if (row !== 1) px(12, 7 + Math.max(0, -al), 1, 4, shade(c.body, -0.35));
    // head
    px(4, 1, 8, 6, c.skin); px(4, 6, 8, 1, shade(c.skin, -0.2));
    px(4, 0, 8, 2, c.hair);
    if (row === 0) { px(3, 1, 1, 4, c.hair); px(12, 1, 1, 4, c.hair); px(6, 4, 1, 1, out); px(9, 4, 1, 1, out); px(7, 6, 2, 1, shade(c.skin, -0.35)); }
    if (row === 1) { px(9, 1, 4, 5, c.hair); px(5, 4, 1, 1, out); }
    if (row === 2) { px(3, 1, 4, 5, c.hair); px(10, 4, 1, 1, out); }
    if (row === 3) { px(3, 1, 10, 5, c.hair); px(4, 5, 8, 1, shade(c.hair, -0.25)); }
  }
  return { img: cv, fw: F * P, fh: F * P };
}

export async function loadSprite(m: ArtManifest, id: string, colours: AgentDef | PlayerDef): Promise<SpriteSet> {
  const has = (f: string) => m.sprites.includes(f);
  const fallback: SpriteSet = { sheet: placeholderSheet(colours), stillOnly: false, fromArt: false };
  const forceStill = m.spriteMeta?.still?.includes(id);
  const [sheet, sheet2x, still, still2x] = await Promise.all([
    has(`${id}.png`) ? loadImg(url(m, `sprites/${id}.png`)) : null,
    has(`${id}@2x.png`) ? loadImg(url(m, `sprites/${id}@2x.png`)) : null,
    has(`${id}-idle.png`) ? loadImg(url(m, `sprites/${id}-idle.png`)) : null,
    has(`${id}-idle@2x.png`) ? loadImg(url(m, `sprites/${id}-idle@2x.png`)) : null,
  ]);
  const cols = m.spriteMeta?.frames_per_row || 4;
  const asSheet = (i: HTMLImageElement | null): Sheet | undefined => i ? { img: i, fw: i.naturalWidth / cols, fh: i.naturalHeight / 4 } : undefined;
  if (sheet && !forceStill) {
    return { sheet: asSheet(sheet)!, sheet2x: asSheet(sheet2x), still: still || undefined, still2x: still2x || undefined, stillOnly: false, fromArt: true };
  }
  const single = still || sheet; // a lone still image (either name)
  if (single) return { ...fallback, still: single, still2x: still2x || undefined, stillOnly: true, fromArt: true };
  return fallback;
}

// ---------- placeholder rooms ----------
const THEMES: Record<string, [string, string, string, string]> = {
  // floorA, floorB, wall, furniture
  command: ["#c9ccd4", "#bfc3cc", "#1d2742", "#2f4c8f"], treasury: ["#2f6b47", "#2a6040", "#262a2e", "#7a5a2a"],
  trading: ["#3a2d55", "#34284d", "#1b1626", "#2a5960"], hearth: ["#8a5a34", "#7f5230", "#3d3029", "#5a3a22"],
  depot: ["#6b6f75", "#64686e", "#33363b", "#c46a2a"], maproom: ["#6e4a2f", "#664429", "#5c8fae", "#3e5a3a"],
  dojo: ["#d6b27a", "#ccaa72", "#e7dcc0", "#3f8f76"], library: ["#3a2b2a", "#342625", "#22191a", "#5a3a22"],
  forge: ["#3d3a3a", "#363333", "#1d1a1a", "#6a3a22"], gallery: ["#ece7dd", "#e3ddd2", "#d9cfb9", "#b08a3a"],
  post: ["#f2b6c4", "#fbd6dc", "#7a4a2a", "#8a5a34"], pool: ["#3a2a22", "#33251e", "#1a2620", "#2a6a3a"],
  hub: ["#e2e0da", "#d6d3cc", "#16213a", "#b89a4a"],
};
export function placeholderRoom(r: RoomDef): HTMLCanvasElement {
  const [fa, fb, wall, furn] = THEMES[r.theme] || THEMES.hub;
  const cv = document.createElement("canvas"); cv.width = r.w; cv.height = r.h;
  const g = cv.getContext("2d")!;
  g.fillStyle = wall; g.fillRect(0, 0, r.w, r.h);
  for (let y = 0; y < r.h; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < r.w; x += 32) { g.fillStyle = shade(wall, 0.06); g.fillRect(x, y, 30, 14); }
  const T = 32;
  for (const [x, y, w, h] of r.walkable) {
    g.fillStyle = shade(wall, -0.4); g.fillRect(x - 4, y - 4, w + 8, h + 8);
  }
  for (const [x, y, w, h] of r.walkable) {
    for (let ty = y; ty < y + h; ty += T) for (let tx = x; tx < x + w; tx += T) {
      g.fillStyle = (Math.floor(tx / T) + Math.floor(ty / T)) % 2 ? fa : fb; g.fillRect(tx, ty, Math.min(T, x + w - tx), Math.min(T, y + h - ty));
    }
  }
  const box = ([x, y, w, h]: Rect) => {
    g.fillStyle = "rgba(0,0,0,.28)"; g.fillRect(x + 4, y + 6, w, h);
    g.fillStyle = shade(furn, -0.35); g.fillRect(x, y, w, h);
    g.fillStyle = furn; g.fillRect(x, y, w, Math.max(6, h - 10));
    g.fillStyle = shade(furn, 0.25); g.fillRect(x + 3, y + 3, w - 6, 3);
    g.strokeStyle = "#0b0d12"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  };
  r.blocked.forEach(box);
  if (r.redflags) {
    const [x, y, w, h] = r.redflags;
    for (let yy = y; yy < y + h; yy += 20) { g.fillStyle = (yy / 20) % 2 ? "#e0302a" : "#f2c21b"; g.fillRect(x + w - 26, yy, 20, 20); }
  }
  for (const d of r.doors) {
    const [x, y, w, h] = d.rect;
    g.fillStyle = "#0b0d12"; g.fillRect(x, y, w, h);
    g.fillStyle = shade(fa, -0.2); g.fillRect(x + 4, y + 4, w - 8, h - 8);
  }
  return cv;
}
export async function loadRoomArt(m: ArtManifest, r: RoomDef): Promise<{ img: CanvasImageSource; fromArt: boolean }> {
  for (const ext of ["webp", "png"]) {
    if (!m.rooms.includes(`${r.id}.${ext}`)) continue;
    const i = await loadImg(url(m, `rooms/${r.id}.${ext}`));
    if (i) return { img: i, fromArt: true };
  }
  return { img: placeholderRoom(r), fromArt: false };
}
