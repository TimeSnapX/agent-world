// Agent World engine: canvas renderer, collision, movement, doors, agents.
import type { World, RoomDef, DoorDef, Dir, Face, Rect } from "./types";
import type { SpriteSet, ArtManifest } from "./art";
import { loadRoomArt, loadSprite } from "./art";

const FACE: Record<Face, Dir> = { down: 0, left: 1, right: 2, up: 3 };
const HB = { w: 20, h: 8 }; // feet hitbox (centred on x, bottom at y+2)
const SPEED = 150, AGENT_SPEED = 46, REACH = 62;

export interface Actor { id: string; x: number; y: number; dir: Dir; moving: boolean; anim: number; sprite: SpriteSet; name: string }
interface Agent extends Actor { home: [number, number]; path: [number, number][]; wait: number; talkTimer: number }
export type Interactable = { kind: "agent"; id: string } | { kind: "board" } ;
export interface Hooks {
  onRoom(room: RoomDef): void;
  onInteract(it: Interactable): void;
  onNearby(it: Interactable | null, label: string): void;
  blocked(): boolean; // UI modal open
}

const inRect = (x: number, y: number, [rx, ry, rw, rh]: Rect) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

export class Game {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  world: World; hooks: Hooks; manifest: ArtManifest;
  room!: RoomDef; roomImg: CanvasImageSource | null = null; roomFromArt = false;
  roomCache = new Map<string, { img: CanvasImageSource; fromArt: boolean }>();
  sprites = new Map<string, SpriteSet>();
  grid!: Uint8Array; gw = 0; gh = 0; cell: number;
  player!: Actor; agents: Agent[] = [];
  input = { x: 0, y: 0 }; path: [number, number][] = []; pathDoor: DoorDef | null = null; pathTarget: Interactable | null = null;
  scale = 2; dpr = 1; camX = 0; camY = 0; viewW = 0; viewH = 0;
  fade = 0; fadeTo: (() => void) | null = null; transitioning = false;
  bump = 0; bumpLatched = false; lastNearby = "";
  t = 0; last = 0; debug = false; frames = 0; artCount = { sprites: 0, rooms: 0 };

  constructor(canvas: HTMLCanvasElement, world: World, manifest: ArtManifest, hooks: Hooks) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.world = world; this.manifest = manifest; this.hooks = hooks; this.cell = world.cell || 8;
    this.debug = new URLSearchParams(location.search).has("debug");
  }

  async init() {
    const ids = Object.keys(this.world.agents);
    const sets = await Promise.all(ids.map((id) => loadSprite(this.manifest, id, this.world.agents[id])));
    ids.forEach((id, i) => this.sprites.set(id, sets[i]));
    const p = this.world.player;
    this.sprites.set(p.id, await loadSprite(this.manifest, p.id, p));
    this.artCount.sprites = [...this.sprites.values()].filter((s) => s.fromArt).length;
    const start = this.roomById(this.world.startRoom);
    this.player = { id: p.id, name: p.name, x: start.spawn[0], y: start.spawn[1], dir: 3, moving: false, anim: 0, sprite: this.sprites.get(p.id)! };
    await this.enter(start.id, null);
    this.resize();
    addEventListener("resize", () => this.resize());
    requestAnimationFrame((ts) => { this.last = ts; this.loop(ts); });
  }
  roomById(id: string) { const r = this.world.rooms.find((r) => r.id === id); if (!r) throw new Error("no room " + id); return r; }
  async roomArt(r: RoomDef) {
    let a = this.roomCache.get(r.id);
    if (!a) { a = await loadRoomArt(this.manifest, r); this.roomCache.set(r.id, a); this.artCount.rooms = [...this.roomCache.values()].filter((x) => x.fromArt).length; }
    return a;
  }

  // ---------- rooms ----------
  async enter(roomId: string, viaDoor: string | null) {
    const r = this.roomById(roomId);
    const art = await this.roomArt(r);
    this.room = r; this.roomImg = art.img; this.roomFromArt = art.fromArt;
    this.buildGrid();
    let spawn = r.spawn; let face: Dir = 3;
    if (viaDoor) { const d = r.doors.find((d) => d.id === viaDoor); if (d) { spawn = d.spawn; face = FACE[d.face]; } }
    this.player.x = spawn[0]; this.player.y = spawn[1]; this.player.dir = face; this.player.moving = false;
    this.path = []; this.pathDoor = null; this.pathTarget = null; this.bumpLatched = !!(this.input.x || this.input.y); this.bump = 0;
    this.agents = r.agents.map((a) => {
      const def = this.world.agents[a.id];
      return { id: a.id, name: def.name, x: a.x, y: a.y, home: [a.x, a.y] as [number, number], dir: 0 as Dir, moving: false, anim: Math.random() * 4, sprite: this.sprites.get(a.id)!, path: [], wait: 1 + Math.random() * 2, talkTimer: 0 };
    });
    this.snapCamera();
    this.hooks.onRoom(r);
    // Preload the rooms behind this room's doors so walking through feels instant.
    for (const d of r.doors) { const t = this.world.rooms.find((x) => x.id === d.to); if (t) this.roomArt(t).catch(() => {}); }
  }
  go(roomId: string, viaDoor: string | null = null) {
    if (this.transitioning) return;
    this.transitioning = true; this.fade = 0.001;
    this.fadeTo = () => { this.enter(roomId, viaDoor).finally(() => { this.transitioning = false; }); };
  }
  buildGrid() {
    const c = this.cell, r = this.room;
    this.gw = Math.ceil(r.w / c); this.gh = Math.ceil(r.h / c);
    const g = new Uint8Array(this.gw * this.gh);
    const solids: Rect[] = [...r.blocked];
    if (r.board) solids.push([r.board.x - 20, r.board.y - 8, 40, 12]);
    for (let cy = 0; cy < this.gh; cy++) for (let cx = 0; cx < this.gw; cx++) {
      const x = cx * c + c / 2, y = cy * c + c / 2;
      const walk = r.walkable.some((w) => inRect(x, y, w)) && !solids.some((b) => inRect(x, y, b));
      g[cy * this.gw + cx] = walk ? 0 : 1;
    }
    this.grid = g;
  }
  solidAt(x: number, y: number) {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh) return true;
    return this.grid[cy * this.gw + cx] === 1;
  }
  boxFree(x: number, y: number) {
    const l = x - HB.w / 2, rr = x + HB.w / 2 - 0.01, t = y - HB.h + 2, b = y + 2 - 0.01;
    return !(this.solidAt(l, t) || this.solidAt(rr, t) || this.solidAt(l, b) || this.solidAt(rr, b) || this.solidAt(x, t) || this.solidAt(x, b));
  }
  hitsActor(x: number, y: number, self: Actor, others: Actor[]) {
    for (const o of others) if (o !== self && Math.abs(o.x - x) < HB.w - 2 && Math.abs(o.y - y) < HB.h + 2) return o;
    return null;
  }

  // ---------- pathfinding (BFS on the feet grid, then string-pulled) ----------
  fits(cx: number, cy: number) { const c = this.cell; return this.boxFree(cx * c + c / 2, cy * c + c / 2); }
  findPath(fx: number, fy: number, tx: number, ty: number, maxNodes = 1e9): [number, number][] | null {
    const c = this.cell, W = this.gw, H = this.gh;
    const sx = Math.floor(fx / c), sy = Math.floor(fy / c);
    const gx = Math.max(0, Math.min(W - 1, Math.floor(tx / c))), gy = Math.max(0, Math.min(H - 1, Math.floor(ty / c)));
    const prev = new Int32Array(W * H).fill(-1); const q = new Int32Array(W * H); let qh = 0, qt = 0;
    const s = sy * W + sx; prev[s] = s; q[qt++] = s;
    let best = s, bestD = Math.hypot(sx - gx, sy - gy);
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (qh < qt && qh < maxNodes) {
      const n = q[qh++]; const nx = n % W, ny = (n / W) | 0;
      const d = Math.hypot(nx - gx, ny - gy); if (d < bestD) { bestD = d; best = n; if (d === 0) break; }
      for (const [dx, dy] of D) {
        const ax = nx + dx, ay = ny + dy; if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        const m = ay * W + ax; if (prev[m] !== -1) continue;
        if (!this.fits(ax, ay)) continue;
        if (dx && dy && (!this.fits(nx + dx, ny) || !this.fits(nx, ny + dy))) continue;
        prev[m] = n; q[qt++] = m;
      }
    }
    if (best === s) return bestD === 0 ? [] : null;
    const cells: [number, number][] = []; for (let n = best; n !== s; n = prev[n]) cells.push([(n % W) * c + c / 2, ((n / W) | 0) * c + c / 2]);
    cells.reverse();
    // string-pull
    const out: [number, number][] = []; let ox = fx, oy = fy, i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.lineFree(ox, oy, cells[j][0], cells[j][1])) j--;
      out.push(cells[j]); [ox, oy] = cells[j]; i = j + 1;
    }
    return out;
  }
  lineFree(x0: number, y0: number, x1: number, y1: number) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3);
    for (let k = 1; k <= n; k++) { const t = k / n; if (!this.boxFree(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
    return true;
  }

  // ---------- input ----------
  setInput(x: number, y: number) {
    this.input.x = x; this.input.y = y;
    if (x || y) { this.path = []; this.pathDoor = null; this.pathTarget = null; } else { this.bumpLatched = false; this.bump = 0; }
  }
  /** Tap/click at CSS pixel position on the canvas. */
  tap(cssX: number, cssY: number) {
    if (this.transitioning) return;
    const wx = (cssX * this.dpr) / this.scale + this.camX, wy = (cssY * this.dpr) / this.scale + this.camY;
    // agents first (sprite bounds), front-most first
    const hit = [...this.agents].sort((a, b) => b.y - a.y).find((a) => Math.abs(wx - a.x) < 20 && wy > a.y - this.world.spriteHeight - 4 && wy < a.y + 6);
    if (hit) { this.facePoint(hit.x, hit.y); this.hooks.onInteract({ kind: "agent", id: hit.id }); return; }
    const b = this.room.board;
    if (b && Math.abs(wx - b.x) < 26 && wy > b.y - 48 && wy < b.y + 8) { this.facePoint(b.x, b.y); this.hooks.onInteract({ kind: "board" }); return; }
    if (this.room.redflags && inRect(wx, wy, this.room.redflags)) { this.hooks.onInteract({ kind: "board" }); return; }
    const door = this.room.doors.find((d) => { const [x, y, w, h] = d.rect; return inRect(wx, wy, [x - 16, y - 16, w + 32, h + 32]); });
    let tx = wx, ty = wy;
    if (door) { const [x, y, w, h] = door.rect; tx = x + w / 2; ty = y + h / 2; }
    const p = this.findPath(this.player.x, this.player.y, tx, ty);
    if (p && p.length) { this.path = p; this.pathDoor = door || null; this.pathTarget = null; this.marker = { x: p[p.length - 1][0], y: p[p.length - 1][1], t: 0.6 }; }
  }
  marker: { x: number; y: number; t: number } | null = null;
  facePoint(x: number, y: number) {
    const dx = x - this.player.x, dy = y - this.player.y;
    this.player.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0);
  }
  /** Interact with whatever the player faces / stands next to. */
  action() {
    const it = this.nearby(); if (it) this.hooks.onInteract(it.it);
  }
  nearby(): { it: Interactable; label: string } | null {
    const p = this.player; let best: { it: Interactable; label: string; d: number } | null = null;
    for (const a of this.agents) { const d = Math.hypot(a.x - p.x, (a.y - p.y) * 1.3); if (d < REACH && (!best || d < best.d)) best = { it: { kind: "agent", id: a.id }, label: `Talk to ${a.name}`, d }; }
    const b = this.room.board; if (b) { const d = Math.hypot(b.x - p.x, (b.y - p.y) * 1.3); if (d < REACH && (!best || d < best.d)) best = { it: { kind: "board" }, label: `Read: ${b.title}`, d }; }
    return best;
  }

  // ---------- loop ----------
  loop(ts: number) {
    const dt = Math.min(0.05, (ts - this.last) / 1000); this.last = ts; this.t += dt; this.frames++;
    this.update(dt); this.render();
    requestAnimationFrame((t) => this.loop(t));
  }
  update(dt: number) {
    if (this.fade > 0) {
      if (this.fadeTo) { this.fade += dt * 7; if (this.fade >= 1) { this.fade = 1; const f = this.fadeTo; this.fadeTo = null; f(); } }
      else if (!this.transitioning) { this.fade -= dt * 5; if (this.fade < 0) this.fade = 0; }
      if (this.fadeTo || this.transitioning) return;
    }
    if (this.marker) { this.marker.t -= dt; if (this.marker.t <= 0) this.marker = null; }
    const p = this.player; const modal = this.hooks.blocked();
    let vx = 0, vy = 0, onPath = false;
    if (!modal && (this.input.x || this.input.y)) { vx = this.input.x; vy = this.input.y; }
    else if (!modal && this.path.length) {
      const [tx, ty] = this.path[0]; const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d < 3) { this.path.shift(); if (!this.path.length) { p.moving = false; } }
      else { vx = dx / d; vy = dy / d; onPath = true; }
    }
    const len = Math.hypot(vx, vy);
    if (len > 0) {
      vx /= Math.max(1, len); vy /= Math.max(1, len);
      p.dir = Math.abs(vx) > Math.abs(vy) + 0.01 ? (vx < 0 ? 1 : 2) : (vy < 0 ? 3 : 0);
      const step = SPEED * dt; let moved = false; let bumped: Actor | null = null;
      const nx = p.x + vx * step;
      if (this.boxFree(nx, p.y)) { const o = onPath ? null : this.hitsActor(nx, p.y, p, this.agents); if (!o) { p.x = nx; moved = moved || Math.abs(vx) > 0.01; } else bumped = o; }
      const ny = p.y + vy * step;
      if (this.boxFree(p.x, ny)) { const o = onPath ? null : this.hitsActor(p.x, ny, p, this.agents); if (!o) { p.y = ny; moved = moved || Math.abs(vy) > 0.01; } else bumped = o; }
      // pushing into the board sign also counts as a bump
      const b = this.room.board; const intoBoard = !!b && !moved && Math.hypot(b.x - p.x, b.y - p.y) < 40;
      p.moving = moved; if (moved) p.anim += dt * 8;
      if (onPath && !moved) { this.path = []; this.pathDoor = null; }
      if ((bumped || intoBoard) && !onPath && !this.bumpLatched) {
        this.bump += dt;
        if (this.bump > 0.12) { this.bumpLatched = true; this.bump = 0; this.hooks.onInteract(bumped ? { kind: "agent", id: bumped.id } : { kind: "board" }); this.setInputHeld(); }
      } else this.bump = 0;
      // doors: feet inside the trigger while moving towards it (or tapping to it)
      const entry: Record<Face, Dir> = { down: 3, up: 0, left: 2, right: 1 };
      for (const d of this.room.doors) {
        if (inRect(p.x, p.y, d.rect) && (p.dir === entry[d.face] || this.pathDoor === d)) { this.go(d.to, d.toDoor); break; }
      }
    } else p.moving = false;
    if (!p.moving) p.anim = 0;
    for (const a of this.agents) this.updateAgent(a, dt);
    const nb = modal ? null : this.nearby();
    const label = nb ? nb.label : "";
    if (label !== this.lastNearby) { this.lastNearby = label; this.hooks.onNearby(nb ? nb.it : null, label); }
    this.followCamera(dt);
  }
  setInputHeld() { /* keep held direction but stop movement until released */ this.input.x = 0; this.input.y = 0; }
  updateAgent(a: Agent, dt: number) {
    if (a.path.length) {
      const [tx, ty] = a.path[0]; const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      if (d < 2) { a.path.shift(); return; }
      const vx = dx / d, vy = dy / d, s = AGENT_SPEED * dt;
      const nx = a.x + vx * s, ny = a.y + vy * s;
      if (!this.boxFree(nx, ny) || this.hitsActor(nx, ny, a, [this.player])) { a.path = []; a.moving = false; a.wait = 0.8; return; }
      a.x = nx; a.y = ny; a.moving = true; a.anim += dt * 6;
      a.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 1 : 2) : (vy < 0 ? 3 : 0);
      return;
    }
    a.moving = false; a.anim = 0;
    const p = this.player; const near = Math.hypot(p.x - a.x, p.y - a.y) < REACH * 1.6;
    if (near) { const dx = p.x - a.x, dy = p.y - a.y; a.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0); a.wait = Math.max(a.wait, 0.6); return; }
    a.wait -= dt;
    if (a.wait <= 0) {
      a.wait = 2 + Math.random() * 3.5;
      if (Math.random() < 0.35) { a.dir = ((Math.random() * 4) | 0) as Dir; return; }
      const ang = Math.random() * Math.PI * 2, rad = 20 + Math.random() * 60;
      const tx = a.home[0] + Math.cos(ang) * rad, ty = a.home[1] + Math.sin(ang) * rad * 0.6;
      if (!this.boxFree(tx, ty)) return;
      const path = this.findPath(a.x, a.y, tx, ty, 4000);
      if (path && path.length) a.path = path;
    }
  }

  // ---------- camera / sizing ----------
  resize() {
    const dpr = window.devicePixelRatio || 1; this.dpr = dpr;
    const cw = this.canvas.clientWidth || innerWidth, ch = this.canvas.clientHeight || innerHeight;
    const devW = Math.round(cw * dpr), devH = Math.round(ch * dpr);
    this.canvas.width = devW; this.canvas.height = devH;
    // Integer scale: each room pixel becomes scale x scale device pixels.
    this.scale = Math.max(1, Math.floor(Math.min(devW / 440, devH / 420)));
    this.viewW = devW / this.scale; this.viewH = devH / this.scale;
    this.snapCamera();
  }
  camTarget() {
    const r = this.room, p = this.player;
    const cx = r.w <= this.viewW ? (r.w - this.viewW) / 2 : Math.max(0, Math.min(r.w - this.viewW, p.x - this.viewW / 2));
    const cy = r.h <= this.viewH ? (r.h - this.viewH) / 2 : Math.max(0, Math.min(r.h - this.viewH, p.y - 24 - this.viewH / 2));
    return [cx, cy];
  }
  snapCamera() { if (!this.room || !this.player) return; [this.camX, this.camY] = this.camTarget(); }
  followCamera(dt: number) {
    const [tx, ty] = this.camTarget(); const k = 1 - Math.exp(-dt * 10);
    this.camX += (tx - this.camX) * k; this.camY += (ty - this.camY) * k;
    if (Math.abs(tx - this.camX) < 0.3) this.camX = tx; if (Math.abs(ty - this.camY) < 0.3) this.camY = ty;
  }

  // ---------- rendering ----------
  render() {
    const g = this.ctx, s = this.scale, r = this.room;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false;
    g.fillStyle = "#07090d"; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Snap the camera to whole device pixels so the art stays crisp.
    const ox = Math.round(-this.camX * s), oy = Math.round(-this.camY * s);
    g.setTransform(s, 0, 0, s, ox, oy);
    if (this.roomImg) g.drawImage(this.roomImg, 0, 0, r.w, r.h);
    if (this.debug) this.drawDebug();
    // door markers
    for (const d of r.doors) this.drawDoorMarker(d);
    if (this.marker) { g.globalAlpha = Math.min(1, this.marker.t * 2); g.strokeStyle = "#ffe066"; g.lineWidth = 2; g.beginPath(); g.ellipse(this.marker.x, this.marker.y, 12, 6, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
    // y-sorted sprites + board sign
    const things: { y: number; draw: () => void }[] = [];
    if (r.board) { const b = r.board; things.push({ y: b.y, draw: () => this.drawBoard(b.x, b.y) }); }
    for (const a of this.agents) things.push({ y: a.y, draw: () => this.drawActor(a) });
    things.push({ y: this.player.y, draw: () => this.drawActor(this.player) });
    things.sort((a, b) => a.y - b.y).forEach((t) => t.draw());
    // labels in device pixels (crisp text)
    g.setTransform(1, 0, 0, 1, 0, 0);
    const fs = Math.round(11 * this.dpr);
    for (const a of this.agents) this.label(a.name, (a.x - this.camX) * s, (a.y - this.world.spriteHeight - 6 - this.camY) * s, fs, "#e9eef7", "rgba(10,13,20,.78)");
    if (r.board) this.label(r.board.title, (r.board.x - this.camX) * s, (r.board.y - 50 - this.camY) * s, Math.round(10 * this.dpr), "#ffe08a", "rgba(10,13,20,.78)");
    for (const d of r.doors) {
      const [x, y, w, h] = d.rect; const name = d.to === "hub" ? "Hallway" : this.roomById(d.to).name;
      let lx = x + w / 2, ly = y + h / 2;
      if (d.face === "up") ly = y - 6; if (d.face === "down") ly = y + h + 22; if (d.face === "right") { lx = x + w + 44; } if (d.face === "left") { lx = x - 44; }
      this.label(name, (lx - this.camX) * s, (ly - this.camY) * s, Math.round(10 * this.dpr), "#bfe3ff", "rgba(8,20,36,.82)");
    }
    if (this.fade > 0) { g.fillStyle = `rgba(5,6,10,${Math.min(1, this.fade)})`; g.fillRect(0, 0, this.canvas.width, this.canvas.height); }
  }
  label(text: string, x: number, y: number, fs: number, fg: string, bg: string) {
    const g = this.ctx; g.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const w = g.measureText(text).width + fs * 0.9, h = fs * 1.5;
    g.fillStyle = bg; const rx = Math.round(x - w / 2), ry = Math.round(y - h);
    g.beginPath(); g.roundRect(rx, ry, Math.round(w), Math.round(h), Math.round(h / 2)); g.fill();
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, Math.round(x), Math.round(ry + h / 2 + fs * 0.05));
  }
  drawDoorMarker(d: DoorDef) {
    const g = this.ctx; const [x, y, w, h] = d.rect; const pulse = 0.55 + 0.35 * Math.sin(this.t * 4);
    g.fillStyle = `rgba(110,200,255,${0.18 * pulse})`; g.fillRect(x, y, w, h);
    const cx = x + w / 2, cy = y + h / 2; const a = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[d.face];
    // chevron pointing the way out (opposite of the facing-in direction)
    const ux = -a[0], uy = -a[1]; const off = Math.sin(this.t * 4) * 3;
    g.fillStyle = `rgba(190,235,255,${0.5 + 0.4 * pulse})`;
    g.beginPath();
    const px = cx + ux * off, py = cy + uy * off;
    g.moveTo(px + ux * 8, py + uy * 8); g.lineTo(px - uy * 8 - ux * 4, py + ux * 8 - uy * 4); g.lineTo(px + uy * 8 - ux * 4, py - ux * 8 - uy * 4);
    g.closePath(); g.fill();
  }
  drawBoard(x: number, y: number) {
    const g = this.ctx; const glow = 0.5 + 0.5 * Math.sin(this.t * 3);
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x - 18, y - 2, 36, 6);
    g.fillStyle = "#4a3320"; g.fillRect(x - 13, y - 14, 4, 16); g.fillRect(x + 9, y - 14, 4, 16);
    g.fillStyle = "#1b1f2a"; g.fillRect(x - 20, y - 44, 40, 32);
    g.fillStyle = "#6b4a2a"; g.fillRect(x - 20, y - 44, 40, 3); g.fillRect(x - 20, y - 15, 40, 3); g.fillRect(x - 20, y - 44, 3, 32); g.fillRect(x + 17, y - 44, 3, 32);
    g.fillStyle = "#7fd3ff"; g.fillRect(x - 13, y - 37, 18, 2); g.fillStyle = "#cfd8e6"; g.fillRect(x - 13, y - 32, 26, 2); g.fillRect(x - 13, y - 27, 22, 2); g.fillRect(x - 13, y - 22, 14, 2);
    g.fillStyle = `rgba(255,214,90,${0.6 + 0.4 * glow})`; g.fillRect(x + 9, y - 39, 5, 5);
  }
  drawActor(a: Actor) {
    const g = this.ctx, H = this.world.spriteHeight, sp = a.sprite, s = this.scale;
    g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.ellipse(a.x, a.y + 1, 11, 4, 0, 0, Math.PI * 2); g.fill();
    const frame = a.moving ? Math.floor(a.anim) % 4 : 0;
    if (sp.stillOnly && sp.still) {
      const img = (s >= 2 && sp.still2x) || sp.still; const iw = (img as HTMLImageElement).naturalWidth || 48, ih = (img as HTMLImageElement).naturalHeight || 48;
      const w = (iw / ih) * H; const bob = a.moving ? Math.abs(Math.sin(a.anim * 1.6)) * 3 : Math.sin(this.t * 2.2 + a.x) * 1;
      const tilt = a.moving ? Math.sin(a.anim * 1.6) * 0.08 : 0;
      g.save(); g.translate(a.x, a.y); g.rotate(tilt); if (a.dir === 1) g.scale(-1, 1);
      g.imageSmoothingEnabled = ih > H * s; g.drawImage(img, -w / 2, -H - bob, w, H); g.restore(); g.imageSmoothingEnabled = false;
      return;
    }
    const useIdle = !a.moving && a.dir === 0 && sp.still;
    if (useIdle) {
      const img = (s >= 2 && sp.still2x) || sp.still!; const ih = (img as HTMLImageElement).naturalHeight || 48, iw = (img as HTMLImageElement).naturalWidth || 48;
      const w = (iw / ih) * H; g.imageSmoothingEnabled = ih > H * s; g.drawImage(img, a.x - w / 2, a.y - H, w, H); g.imageSmoothingEnabled = false; return;
    }
    const sh = (s >= 2 && sp.sheet2x) || sp.sheet;
    const w = (sh.fw / sh.fh) * H; const bob = !a.moving && !sp.fromArt ? Math.round(Math.sin(this.t * 2.2 + a.x) * 0.6) : 0;
    g.imageSmoothingEnabled = sh.fh > H * s;
    g.drawImage(sh.img, frame * sh.fw, a.dir * sh.fh, sh.fw, sh.fh, a.x - w / 2, a.y - H + bob, w, H);
    g.imageSmoothingEnabled = false;
  }
  drawDebug() {
    const g = this.ctx, c = this.cell;
    for (let cy = 0; cy < this.gh; cy++) for (let cx = 0; cx < this.gw; cx++) {
      g.fillStyle = this.grid[cy * this.gw + cx] ? "rgba(255,0,0,.25)" : "rgba(0,255,0,.18)"; g.fillRect(cx * c, cy * c, c, c);
    }
    for (const d of this.room.doors) { g.strokeStyle = "#0ff"; g.lineWidth = 2; g.strokeRect(...d.rect); g.fillStyle = "#ff0"; g.fillRect(d.spawn[0] - 3, d.spawn[1] - 3, 6, 6); }
  }

  // ---------- test/debug helpers ----------
  toCss(x: number, y: number) { return { x: ((x - this.camX) * this.scale) / this.dpr, y: ((y - this.camY) * this.scale) / this.dpr }; }
  validate() {
    const problems: string[] = [];
    for (const r of this.world.rooms) {
      const saved = this.room; this.room = r; this.buildGrid();
      const check = (what: string, x: number, y: number) => { if (!this.boxFree(x, y)) problems.push(`${r.id}: ${what} at ${x},${y} is not walkable`); };
      check("spawn", r.spawn[0], r.spawn[1]);
      for (const a of r.agents) check(`agent ${a.id}`, a.x, a.y);
      for (const d of r.doors) {
        check(`door ${d.id} spawn`, d.spawn[0], d.spawn[1]);
        if (inRect(d.spawn[0], d.spawn[1], d.rect)) problems.push(`${r.id}: door ${d.id} spawn is inside its own trigger`);
        const [x, y, w, h] = d.rect; const p = this.findPath(r.spawn[0], r.spawn[1], x + w / 2, y + h / 2);
        const end = p && p.length ? p[p.length - 1] : [r.spawn[0], r.spawn[1]];
        if (!inRect(end[0], end[1], d.rect)) problems.push(`${r.id}: door ${d.id} not reachable from spawn`);
        const tr = this.world.rooms.find((t) => t.id === d.to); if (!tr) problems.push(`${r.id}: door ${d.id} -> missing room ${d.to}`);
        else if (!tr.doors.some((t) => t.id === d.toDoor)) problems.push(`${r.id}: door ${d.id} -> ${d.to} has no door ${d.toDoor}`);
      }
      for (const a of r.agents) {
        const p = this.findPath(r.spawn[0], r.spawn[1], a.x, a.y + 30);
        const end = p && p.length ? p[p.length - 1] : r.spawn; if (Math.hypot(end[0] - a.x, end[1] - a.y) > REACH) problems.push(`${r.id}: can't walk up to ${a.id}`);
      }
      if (r.board) { const p = this.findPath(r.spawn[0], r.spawn[1], r.board.x, r.board.y + 20); const end = p && p.length ? p[p.length - 1] : r.spawn; if (Math.hypot(end[0] - r.board.x, end[1] - r.board.y) > REACH) problems.push(`${r.id}: can't reach board`); }
      this.room = saved; this.buildGrid();
    }
    return problems;
  }
}
