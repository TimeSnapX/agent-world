import "./style.css";
import worldJson from "./world.json";
import type { World, RoomDef } from "./types";
import { Game, type Interactable } from "./game";
import { loadManifest } from "./art";
import { boardHtml, appLinks, esc, type StatusState } from "./boards";
import * as time from "./time";

const world = worldJson as unknown as World;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const canvas = $<HTMLCanvasElement>("#world");
const sheet = $("#sheet"), sheetBody = $("#sheet-body"), mapEl = $("#map"), roomName = $("#room-name"), roomSub = $("#room-sub"), prompt = $<HTMLButtonElement>("#prompt");
const status: StatusState = { data: null, error: null };
let game: Game; let current: Interactable | null = null;
export const currentPanel = () => current;

async function loadStatus() {
  if (!navigator.onLine) { status.error = "offline"; return; } // never served from cache, so don't try
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}status.json`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    status.data = await r.json(); status.error = null;
  } catch (e) { status.data = null; status.error = navigator.onLine ? (e as Error).message : "offline"; }
}

// ---------- panels ----------
function openSheet(html: string, label: string) {
  sheetBody.innerHTML = html; sheet.hidden = false; sheet.setAttribute("aria-label", label);
  sheet.classList.add("open"); keys.clear(); applyKeys();
  ($<HTMLButtonElement>("#sheet-close")).focus({ preventScroll: true });
}
function closeSheet() { sheet.hidden = true; sheet.classList.remove("open"); current = null; canvas.focus({ preventScroll: true }); }
function portrait(id: string): string {
  const sp = game.sprites.get(id); if (!sp) return "";
  const c = document.createElement("canvas"); c.width = 96; c.height = 96; const g = c.getContext("2d")!; g.imageSmoothingEnabled = false;
  const img = sp.still2x || sp.still; 
  if (img) g.drawImage(img, 0, 0, 96, 96);
  else { const sh = sp.sheet2x || sp.sheet; g.drawImage(sh.img, 0, 0, sh.fw, sh.fh, 0, 0, 96, 96); }
  return c.toDataURL();
}
function openAgent(id: string) {
  const a = world.agents[id]; current = { kind: "agent", id };
  const room = game.room;
  const html = `<header class="who"><img class="portrait" alt="" src="${portrait(id)}"><div><h2>${esc(a.name)}</h2><p class="title">${esc(a.title)}</p><p class="muted">${esc(room.name)}</p></div></header>
  <section class="blk"><h3>Owns</h3><ul class="owns">${a.owns.map((o) => `<li>${esc(o)}</li>`).join("")}</ul></section>
  <section class="blk"><h3>Apps</h3>${a.links.length ? appLinks(world, a.links) : `<p class="empty">No app of its own yet. Ask ${esc(a.name)} in Grok Bot.</p>`}</section>
  ${room.board ? `<button class="btn wide" data-open-board>Open ${esc(room.board.title)} board</button>` : ""}`;
  openSheet(html, `${a.name}, ${a.title}`);
  sheet.dataset.kind = "agent"; sheet.dataset.id = id;
}
function openBoard(room: RoomDef = game.room) {
  if (!room.board) return; current = { kind: "board" };
  const owner = room.owner ? world.agents[room.owner] : null;
  openSheet(`<header class="who board"><div><p class="eyebrow">${esc(room.name)} · at a glance</p><h2>${esc(room.board.title)}</h2>${owner ? `<p class="muted">Board kept by ${esc(owner.name)}</p>` : ""}</div></header>${boardHtml(room.board.kind, room, world, status, { art: game.artCount })}`, `${room.name} board`);
  sheet.dataset.kind = "board"; sheet.dataset.id = room.id;
}
sheet.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("#sheet-close")) return closeSheet();
  if (t.closest("[data-open-board]")) return openBoard();
  const tr = t.closest<HTMLElement>("[data-travel]"); if (tr) { closeSheet(); game.go(tr.dataset.travel!); return; }
});
sheet.addEventListener("submit", (e) => {
  const f = (e.target as HTMLElement).closest("[data-ask]"); if (!f) return;
  e.preventDefault(); const note = sheet.querySelector<HTMLElement>("[data-ask-note]"); if (note) note.hidden = false;
});

// ---------- fast travel map ----------
function renderMap() {
  const cells = world.rooms.map((r) => {
    const [c, rr, cs = 1, rs = 1] = r.map; const who = r.agents.map((a) => world.agents[a.id].name).join(", ");
    return `<button class="mcell ${r.id === game.room.id ? "here" : ""} ${world.priorityRooms.includes(r.id) ? "pri" : ""}" style="grid-column:${c + 1} / span ${cs};grid-row:${rr + 1} / span ${rs}" data-travel="${esc(r.id)}"><b>${esc(r.name)}</b>${who ? `<small>${esc(who)}</small>` : `<small>${r.id === "hub" ? "Fountain plaza" : ""}</small>`}</button>`;
  }).join("");
  const order = [...world.priorityRooms, ...world.rooms.map((r) => r.id).filter((id) => !world.priorityRooms.includes(id))];
  const listHtml = order.map((id) => { const r = world.rooms.find((x) => x.id === id)!; return `<li><button data-travel="${esc(r.id)}" class="${r.id === game.room.id ? "here" : ""}"><span>${esc(r.name)}</span><small>${esc(r.agents.map((a) => world.agents[a.id].name).join(", "))}</small></button></li>`; }).join("");
  $("#map-grid").innerHTML = cells; $("#map-list").innerHTML = listHtml;
}
function openMap() { renderMap(); mapEl.hidden = false; keys.clear(); applyKeys(); ($<HTMLButtonElement>("#map-close")).focus({ preventScroll: true }); }
function closeMap() { mapEl.hidden = true; canvas.focus({ preventScroll: true }); }
mapEl.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t === mapEl || t.closest("#map-close")) return closeMap();
  const tr = t.closest<HTMLElement>("[data-travel]"); if (tr) { closeMap(); closeSheet(); game.go(tr.dataset.travel!); }
});
$("#map-btn").addEventListener("click", () => (mapEl.hidden ? openMap() : closeMap()));

// ---------- keyboard ----------
const keys = new Set<string>();
const KEYMAP: Record<string, [number, number]> = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
function applyKeys() { let x = 0, y = 0; for (const k of keys) { const v = KEYMAP[k]; if (v) { x += v[0]; y += v[1]; } } game?.setInput(Math.sign(x), Math.sign(y)); }
const modalOpen = () => !sheet.hidden || !mapEl.hidden;
addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea");
  if (e.code === "Escape") { if (!mapEl.hidden) closeMap(); else if (!sheet.hidden) closeSheet(); return; }
  if (typing) return;
  if (e.code === "KeyM") { e.preventDefault(); mapEl.hidden ? openMap() : closeMap(); return; }
  if (modalOpen()) return;
  if (KEYMAP[e.code]) { e.preventDefault(); keys.add(e.code); applyKeys(); return; }
  if (e.code === "Enter" || e.code === "Space" || e.code === "KeyE") { e.preventDefault(); game.action(); }
});
addEventListener("keyup", (e) => { if (keys.delete(e.code)) applyKeys(); });
addEventListener("blur", () => { keys.clear(); applyKeys(); });

// ---------- on-screen joystick / D-pad ----------
const pad = $("#pad"), knob = $("#knob"); let padId: number | null = null;
function padMove(e: PointerEvent) {
  if (modalOpen()) { game.setInput(0, 0); return; }
  const r = pad.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy; const R = r.width / 2; const d = Math.hypot(dx, dy);
  const kx = d > R * 0.6 ? (dx / d) * R * 0.6 : dx, ky = d > R * 0.6 ? (dy / d) * R * 0.6 : dy;
  knob.style.transform = `translate(${kx}px, ${ky}px)`;
  if (d < R * 0.22) { game.setInput(0, 0); pad.dataset.dir = ""; return; }
  // 8-way snap feels like a D-pad but steers like a stick
  const a = Math.atan2(dy, dx); const oct = Math.round(a / (Math.PI / 4));
  const v = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]][(oct + 8) % 8];
  pad.dataset.dir = String((oct + 8) % 8);
  game.setInput(v[0], v[1]);
}
pad.addEventListener("pointerdown", (e) => { if (modalOpen()) return; e.preventDefault(); padId = e.pointerId; pad.setPointerCapture(e.pointerId); padMove(e); });
pad.addEventListener("pointermove", (e) => { if (e.pointerId === padId) padMove(e); });
const padUp = (e: PointerEvent) => { if (e.pointerId !== padId) return; padId = null; knob.style.transform = ""; pad.dataset.dir = ""; game.setInput(0, 0); };
pad.addEventListener("pointerup", padUp); pad.addEventListener("pointercancel", padUp);
$("#btn-a").addEventListener("click", () => game.action());
prompt.addEventListener("click", () => game.action());

// ---------- tap to walk ----------
let down: { x: number; y: number; id: number } | null = null;
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
canvas.addEventListener("pointerup", (e) => {
  if (!down || down.id !== e.pointerId) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
  if (moved > 12 || modalOpen()) return;
  const r = canvas.getBoundingClientRect(); game.tap(e.clientX - r.left, e.clientY - r.top);
});

// ---------- boot ----------
(async () => {
  const [manifest] = await Promise.all([loadManifest(), loadStatus()]);
  game = new Game(canvas, world, manifest, {
    onRoom(r) {
      roomName.textContent = r.name;
      const who = r.agents.map((a) => world.agents[a.id].name);
      roomSub.textContent = who.length ? who.join(" · ") : "Fountain plaza · 12 doors";
      document.title = `${r.name} · Agent World`;
      if (!mapEl.hidden) renderMap();
    },
    onInteract(it) { if (it.kind === "agent") openAgent(it.id); else openBoard(); },
    onNearby(_it, label) { prompt.hidden = !label; prompt.textContent = label ? `A · ${label}` : ""; },
    blocked: modalOpen,
  });
  await game.init();
  document.body.classList.add("ready");
  // Test + debug surface (read-only helpers; no network or storage access).
  (window as any).__aw = {
    world, time,
    state: () => ({ room: game.room.id, x: Math.round(game.player.x), y: Math.round(game.player.y), dir: game.player.dir, scale: game.scale, transitioning: game.transitioning, sheet: sheet.hidden ? null : { kind: sheet.dataset.kind, id: sheet.dataset.id }, map: !mapEl.hidden, art: game.artCount, frames: game.frames }),
    agentScreen: (id: string) => { const a = game.agents.find((x) => x.id === id); return a ? game.toCss(a.x, a.y - 20) : null; },
    boardScreen: () => (game.room.board ? game.toCss(game.room.board.x, game.room.board.y - 24) : null),
    doorScreen: (id: string) => { const d = game.room.doors.find((x) => x.id === id); return d ? game.toCss(d.rect[0] + d.rect[2] / 2, d.rect[1] + d.rect[3] / 2) : null; },
    validate: () => game.validate(),
  };
  setInterval(loadStatus, 5 * 60_000);
})();
