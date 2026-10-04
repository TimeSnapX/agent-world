// "At a glance" boards. REAL DATA ONLY: everything comes from the browser clock
// or from the optional status.json (schema in DATA.md). Missing data shows an
// empty state; nothing here invents numbers.
import type { World, RoomDef } from "./types";
import { bne, longDate, workDay, payday, bedtime, hoursBetween } from "./time";

export type Status = Record<string, any> | null;
export interface StatusState { data: Status; error: string | null }

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const EMPTY = `<p class="empty">No data yet</p>`;
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const aud = (v: unknown) => { const n = num(v); return n == null ? null : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" }); };
const hrs = (v: number) => `${Math.round(v * 100) / 100}h`;
const arr = (v: unknown): any[] | null => (Array.isArray(v) ? v : null);
const row = (k: string, v: string | null) => `<div class="kv"><span>${esc(k)}</span><b>${v == null ? `<em class="empty">No data yet</em>` : v}</b></div>`;
const list = (items: any[] | null, fmt: (x: any) => string, none = "None recorded") =>
  items == null ? EMPTY : items.length ? `<ul class="list">${items.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul>` : `<p class="empty">${esc(none)}</p>`;
const section = (title: string, body: string) => `<section class="blk"><h3>${esc(title)}</h3>${body}</section>`;
const fmtDate = (s: unknown) => { if (typeof s !== "string" || !s) return ""; const d = new Date(s.length === 10 ? s + "T00:00:00+10:00" : s); return isNaN(+d) ? esc(s) : d.toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short" }); };
const dueItem = (x: any) => `<span>${esc(x?.name ?? x?.title ?? "Item")}</span><span class="muted">${[aud(x?.amount), x?.due ? `due ${fmtDate(x.due)}` : "", x?.status ? esc(x.status) : ""].filter(Boolean).join(" · ")}</span>`;

export function appLinks(world: World, ids: string[]): string {
  if (!ids.length) return "";
  return `<div class="links">${ids.filter((id) => world.apps[id]).map((id) => `<a class="app" href="${esc(world.apps[id].url)}" target="_blank" rel="noopener" data-app="${esc(id)}">${esc(world.apps[id].name)} <span aria-hidden="true">↗</span></a>`).join("")}</div>`;
}

export function boardHtml(kind: string, room: RoomDef, world: World, st: StatusState, extras: { art: { sprites: number; rooms: number } }): string {
  const s = st.data || {};
  const n = bne();
  let body = "";
  switch (kind) {
    case "command": {
      const w = workDay(n), p = payday(n), b = bedtime(n);
      const nd = s.nextDue;
      body += section("Today", `${row("Date", esc(longDate(n)))}${row("Work", esc(w.text))}${row("Payday", esc(p.text))}${b ? row("Bedtime", esc(b)) : ""}`);
      body += section("Next due", nd && (nd.title || nd.name) ? `<p>${esc(nd.title || nd.name)}${nd.due ? ` <span class="muted">· ${fmtDate(nd.due)}</span>` : ""}</p>` : EMPTY);
      body += section("Go to a room", `<div class="rooms">${world.rooms.filter((r) => r.id !== room.id).map((r) => `<button class="chip" data-travel="${esc(r.id)}">${esc(r.name)}</button>`).join("")}</div>`);
      break;
    }
    case "treasury": {
      const t = s.treasury || {};
      const lp = t.lastPay;
      body += section("Last pay", lp ? `${row("Net", aud(lp.net))}${row("Gross", aud(lp.gross))}${lp.date ? row("Paid", fmtDate(lp.date)) : ""}` : EMPTY);
      body += section("This week", row("Hours", num(t.weekHours) != null ? hrs(t.weekHours) : null));
      const np = t.expectedNextPay;
      body += section("Expected next pay", np ? `${row("Net", aud(np.net))}${np.date ? row("Date", fmtDate(np.date)) : ""}` : EMPTY);
      const due = arr(t.due);
      const pri = (x: any) => { const nm = String(x?.name || "").toLowerCase(); return nm.includes("racq") ? 0 : nm.includes("superloop") ? 1 : 2; };
      const sorted = due && [...due].sort((a, b) => pri(a) - pri(b) || String(a?.due || "9").localeCompare(String(b?.due || "9")));
      body += section("Debts and bills due", list(sorted, dueItem, "Nothing due"));
      break;
    }
    case "hearth": {
      const h = s.hearth || {};
      body += section("Upcoming bills and admin", list(arr(h.upcoming), dueItem, "Nothing coming up"));
      body += section("Failed payments", list(arr(h.failedPayments), (x) => `<span>${esc(x?.name ?? "Payment")}</span><span class="muted">${[aud(x?.amount), x?.date ? fmtDate(x.date) : ""].filter(Boolean).join(" · ")}</span>`, "None recorded"));
      break;
    }
    case "depot": {
      const shifts = arr(s.depot?.shifts);
      const ORD = 7.6;
      if (shifts == null) body += section("This week's shifts", EMPTY);
      else if (!shifts.length) body += section("This week's shifts", `<p class="empty">No shifts recorded this week</p>`);
      else {
        let gt = 0, pt = 0;
        const rows = shifts.map((x) => {
          const g = x?.gateIn && x?.gateOut ? hoursBetween(x.gateIn, x.gateOut) : null; const p = num(x?.paidHours);
          if (g != null) gt += g; if (p != null) pt += p;
          const diff = p == null ? "" : `${p - ORD >= 0 ? "+" : ""}${hrs(p - ORD)}`;
          return `<tr><td>${fmtDate(x?.date) || "?"}</td><td>${x?.gateIn ? esc(x.gateIn) + "–" + esc(x.gateOut ?? "?") : "–"}</td><td>${g == null ? "–" : hrs(g)}</td><td>${p == null ? "–" : hrs(p)}</td><td>${diff || "–"}</td></tr>`;
        }).join("");
        body += section("This week's shifts", `<table class="tbl"><thead><tr><th>Day</th><th>Gate</th><th>Gate to gate</th><th>Paid</th><th>vs 7.6h</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total</td><td>${hrs(gt)}</td><td>${hrs(pt)}</td><td></td></tr></tfoot></table>`);
      }
      body += `<p class="note">Ordinary day is 7.6 paid hours.</p>`;
      break;
    }
    case "maproom": {
      const c = s.career || {};
      const steps = ["HR", "HC", "MC"]; const cur = steps.includes(c.current) ? c.current : "HR";
      const idx = steps.indexOf(cur);
      const pct = Math.round(((idx + 1) / steps.length) * 100);
      body += section("Licence path", `<div class="steps">${steps.map((x, i) => `<div class="step ${i <= idx ? "done" : i === idx + 1 ? "next" : ""}"><b>${x}</b><span>${i <= idx ? (i === idx ? "Current licence" : "Done") : i === idx + 1 ? "Next step" : "Goal"}</span></div>`).join("")}</div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><p class="muted">${esc(cur)} held · next ${esc(steps[idx + 1] || "done")}</p>`);
      if (c.notes) body += section("Notes", `<p>${esc(c.notes)}</p>`);
      break;
    }
    case "dojo": {
      const d = s.dojo || {};
      const target = num(d.sleepTargetHours); const sleep = arr(d.sleep);
      body += section("Sleep vs target", `${row("Target", target != null ? hrs(target) : null)}${sleep == null ? EMPTY : sleep.length ? `<ul class="list">${sleep.slice(-7).map((x) => { const h = num(x?.hours); return `<li><span>${fmtDate(x?.date)}</span><span class="${target != null && h != null ? (h >= target ? "ok" : "bad") : "muted"}">${h == null ? "?" : hrs(h)}${target != null && h != null ? ` (${h - target >= 0 ? "+" : ""}${hrs(h - target)})` : ""}</span></li>`; }).join("")}</ul>` : `<p class="empty">No nights logged</p>`}`);
      body += section("Taekwondo", list(arr(d.taekwondo), (x) => `<span>${fmtDate(x?.date)}</span><span class="muted">${esc(x?.note ?? "")}</span>`, "No sessions logged"));
      body += section("Streaks", list(arr(d.streaks), (x) => `<span>${esc(x?.name ?? "Streak")}</span><b>${num(x?.days) ?? "?"} days</b>`, "No streaks yet"));
      break;
    }
    case "trading": {
      const t = s.trading || {};
      body += section("Red flags", `<div class="flags">${list(arr(t.redFlags), (x) => `<span>⚠ ${esc(typeof x === "string" ? x : x?.text)}</span>`, "No red flags logged")}</div>`);
      body += section("Research notes", list(arr(t.notes), (x) => `<span><b>${esc(x?.title ?? "")}</b> ${esc(x?.body ?? "")}</span><span class="muted">${fmtDate(x?.date)}</span>`, "No notes yet"));
      body += section("Watchlist", list(arr(t.watchlist), (x) => `<span><b>${esc(x?.symbol ?? "")}</b></span><span class="muted">${esc(x?.note ?? "")}</span>`, "Watchlist is empty"));
      body += `<p class="note">Research and watchlist only. Balances and wallet keys are never shown here.</p>`;
      break;
    }
    case "library": {
      const q = s.library?.lastQuestion;
      body += section("Last question asked", q && (q.text || typeof q === "string") ? `<p>“${esc(q.text ?? q)}”${q.date ? ` <span class="muted">· ${fmtDate(q.date)}</span>` : ""}</p>` : EMPTY);
      body += section("Quick ask", `<form class="ask" data-ask><input name="q" placeholder="What do you want to know?" aria-label="Question for Athena" autocomplete="off"><button class="btn">Ask</button></form><p class="note" data-ask-note hidden>Ask Athena in Grok Bot. This board has no backend, so nothing was sent.</p>`);
      break;
    }
    case "forge": {
      const live = Object.entries(world.apps);
      body += section("Every app", `<ul class="list">${live.map(([id, a]) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener" data-app="${esc(id)}">${esc(a.name)} ↗</a><span class="muted">${esc(id)}</span></li>`).join("")}${world.plannedApps.map((p) => `<li><span>${esc(p)}</span><span class="tag">planned</span></li>`).join("")}</ul>`);
      break;
    }
    case "gallery": {
      body += section("Latest work", list(arr(s.gallery?.recent), (x) => x?.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title ?? x.url)} ↗</a>` : `<span>${esc(x?.title ?? "")}</span>`, "Nothing posted yet"));
      body += section("Agent World art", `${row("Sprites from Apollo", `${extras.art.sprites} of ${Object.keys(world.agents).length + 1}`)}${row("Rooms from Apollo", `${extras.art.rooms} of ${world.rooms.length}`)}`);
      break;
    }
    case "post": {
      const p = s.post || {};
      body += section("Inbox", `${row("Unread important", num(p.unreadImportant) != null ? String(p.unreadImportant) : null)}${row("Drafts awaiting review", num(p.draftsAwaitingReview) != null ? String(p.draftsAwaitingReview) : null)}`);
      break;
    }
    case "pool": {
      const p = s.pool || {}; const nc = p.nextComp;
      body += section("Next comp night · Sporties", nc && nc.date ? `<p>${fmtDate(nc.date)}${nc.time ? ` · ${esc(nc.time)}` : ""}${nc.venue && nc.venue !== "Sporties" ? ` · ${esc(nc.venue)}` : ""}</p>` : EMPTY);
      body += section("Bracket", list(arr(p.bracket), (x) => `<span>${esc(x?.round ?? "")} ${esc(x?.match ?? "")}</span><span class="muted">${esc(x?.result ?? "")}</span>`, "No bracket yet"));
      break;
    }
    default: body += EMPTY;
  }
  if (room.links.length) body += section("Apps", appLinks(world, room.links));
  const upd = st.error ? `<p class="foot">Couldn't load status.json (${esc(st.error)}). Showing empty states.</p>`
    : s.updated ? `<p class="foot">Data as of ${esc(new Date(s.updated).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short" }))} (Brisbane)</p>`
    : kind === "command" || kind === "forge" || kind === "maproom" ? "" : `<p class="foot">No status data published yet.</p>`;
  return body + upd;
}
