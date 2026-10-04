// End-to-end tests for Agent World (headless Chrome via playwright-core).
//   npm run build && node tests/e2e.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import { start } from "./server.mjs";
const { chromium } = createRequire("/workspace/tools/package.json")("playwright-core");

const PORT = 4790, URL_ = `http://127.0.0.1:${PORT}/agent-world/`;
const OUT = new URL("../test-results/", import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const srv = await start(PORT);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--disable-gpu"] });
let pass = 0, fail = 0; const results = [];
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); results.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " · " + extra : ""}`); console.log(results.at(-1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(name, ctxOpts, setup) {
  const ctx = await browser.newContext({ ...ctxOpts, serviceWorkers: "block" });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console " + m.text()));
  page.on("response", (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url()}`));
  page.on("requestfailed", (r) => errors.push(`failed ${r.url()} ${r.failure()?.errorText}`));
  if (setup) await setup(page);
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__aw && document.body.classList.contains("ready"));
  await sleep(300);
  return { ctx, page, errors, name };
}
const st = (page) => page.evaluate(() => __aw.state());
const waitRoom = (page, id, t = 6000) => page.waitForFunction((id) => { const s = __aw.state(); return s.room === id && !s.transitioning; }, id, { timeout: t }).then(() => true, () => false);
const waitSheet = (page, kind, id, t = 3000) => page.waitForFunction(([k, i]) => { const s = __aw.state().sheet; return s && s.kind === k && (!i || s.id === i); }, [kind, id], { timeout: t }).then(() => true, () => false);
async function holdKey(page, key, ms) { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); await sleep(60); }
async function travel(page, id) { await page.click("#map-btn"); await page.click(`#map-grid [data-travel="${id}"]`); return waitRoom(page, id); }
async function closeSheet(page) { if (await page.locator("#sheet-close").isVisible()) await page.click("#sheet-close"); await sleep(100); }

// touch hold on the joystick via CDP (real touch -> pointer events)
async function padHold(page, cdp, dx, dy, ms) {
  const b = await page.locator("#pad").boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + dx * b.width * 0.4, y: cy + dy * b.height * 0.4 }] });
  const until = Date.now() + ms; while (Date.now() < until) { await sleep(100); await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + dx * b.width * 0.4 + (Date.now() % 2), y: cy + dy * b.height * 0.4 }] }); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(80);
}
async function padHoldUntil(page, cdp, dx, dy, pred, max = 6000) {
  const b = await page.locator("#pad").boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const px = cx + dx * b.width * 0.4, py = cy + dy * b.height * 0.4;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: px, y: py }] });
  const until = Date.now() + max; let hit = false;
  while (Date.now() < until) { await sleep(100); if (await page.evaluate(pred)) { hit = true; break; } }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(80);
  return hit;
}
async function tapWorld(page, p, touch) { if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); }
const clampPt = (p, vp) => ({ x: Math.max(30, Math.min(vp.width - 30, p.x)), y: Math.max(110, Math.min(vp.height - 220, p.y)) });
// Tap an agent; if it's off-screen, tap-to-walk towards it first (like a person would).
async function tapAgent(page, id, touch, vp) {
  for (let i = 0; i < 5; i++) {
    const p = await page.evaluate((id) => __aw.agentScreen(id), id);
    if (onScreen(p, vp) && p.y > 90 && p.y < vp.height - 230) { await tapWorld(page, p, touch); if (await waitSheet(page, "agent", id, 1500)) return true; }
    else { await tapWorld(page, clampPt(p, vp), touch); await sleep(1500); }
  }
  return false;
}
async function tapDoor(page, id, touch, vp, room) {
  const from = (await st(page)).room;
  for (let i = 0; i < 5; i++) {
    const p = await page.evaluate((id) => __aw.doorScreen(id), id);
    if (!p) break;
    if (onScreen(p, vp) && p.y > 90 && p.y < vp.height - 230) await tapWorld(page, p, touch); else await tapWorld(page, clampPt(p, vp), touch);
    if (await waitRoom(page, room, 2500)) return true;
  }
  return (await st(page)).room === room && from !== room;
}
const onScreen = (p, vp) => p && p.x > 10 && p.y > 70 && p.x < vp.width - 10 && p.y < vp.height - 10;

// ---------------- unit: Brisbane time logic ----------------
{
  const { ctx, page, errors } = await open("unit", { viewport: { width: 800, height: 600 } });
  const r = await page.evaluate(() => {
    const T = __aw.time; const at = (iso) => T.bne(new Date(iso));
    return {
      sun: [T.longDate(at("2026-10-04T18:14:00+10:00")), T.workDay(at("2026-10-04T18:14:00+10:00")).work, T.payday(at("2026-10-04T18:14:00+10:00")).text, T.bedtime(at("2026-10-04T18:14:00+10:00"))],
      thu: [T.payday(at("2026-10-08T07:00:00+10:00")).text, T.bedtime(at("2026-10-08T20:00:00+10:00"))],
      fri: [T.payday(at("2026-10-09T07:00:00+10:00")).days, T.bedtime(at("2026-10-09T20:00:00+10:00"))],
      sat: [T.bedtime(at("2026-10-10T20:00:00+10:00")), T.workDay(at("2026-10-10T08:00:00+10:00")).work],
      mon4am: T.workDay(at("2026-10-05T04:00:00+10:00")).text,
      // UTC midnight-ish edge: 2026-10-04T15:30Z is Mon 1:30am in Brisbane
      edge: [at("2026-10-04T15:30:00Z").dow, T.workDay(at("2026-10-04T15:30:00Z")).work],
      gate: [T.hoursBetween("05:00", "13:36"), T.hoursBetween("22:00", "06:30"), T.hoursBetween("x", "1:00")],
    };
  });
  ok("time: Sunday date/work/payday/bedtime", r.sun[0] === "Sunday 4 October 2026" && r.sun[1] === false && r.sun[2] === "4 days to payday · Thu 8 Oct (Randstad)" && !!r.sun[3], JSON.stringify(r.sun));
  ok("time: Thursday is payday, bedtime shown", r.thu[0].startsWith("Payday today") && !!r.thu[1]);
  ok("time: Friday 6 days to payday, no bedtime", r.fri[0] === 6 && r.fri[1] === null);
  ok("time: Saturday no bedtime, not a work day", r.sat[0] === null && r.sat[1] === false);
  ok("time: Monday 4am shows countdown to 5am start", r.mon4am === "Work day · 5:00am start, in 1h 0m", r.mon4am);
  ok("time: Brisbane day computed from UTC correctly", r.edge[0] === 1 && r.edge[1] === true);
  ok("time: gate-to-gate hours", r.gate[0] === 8.6 && r.gate[1] === 8.5 && r.gate[2] === null, JSON.stringify(r.gate));
  const v = await page.evaluate(() => __aw.validate());
  ok("world.json: every spawn/agent/board/door is walkable and reachable", v.length === 0, v.join("; "));
  ok("unit page: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------------- phone + desktop flows ----------------
const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" };
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const linkTargets = new Set();

for (const [label, opts] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  const touch = label === "phone";
  const { ctx, page, errors } = await open(label, opts);
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  const vp = opts.viewport;
  let s = await st(page);
  ok(`${label}: starts in Command Centre`, s.room === "command-centre", JSON.stringify(s));
  ok(`${label}: Apollo art loaded (18 sprites, start room)`, s.art.sprites === 18 && s.art.rooms >= 1, JSON.stringify(s.art));
  ok(`${label}: integer scale`, Number.isInteger(s.scale) && s.scale >= 1, `scale ${s.scale}`);
  if (touch) ok("phone: joystick visible", await page.locator("#pad").isVisible());
  else ok("desktop: joystick hidden, key hint visible", !(await page.locator("#pad").isVisible()) && (await page.locator(".keys-hint").isVisible()));
  if (label === "phone") await page.screenshot({ path: OUT + "phone-command-centre.png" });
  else await page.screenshot({ path: OUT + "desktop-command-centre.png" });

  // movement
  const before = await st(page);
  if (touch) {
    await padHold(page, cdp, -1, 0, 500); const a = await st(page);
    ok("phone: D-pad left moves left", a.x < before.x - 30 && a.dir === 1, `${before.x}->${a.x}`);
    await padHold(page, cdp, 1, 0, 500); const b = await st(page);
    ok("phone: D-pad right moves right", b.x > a.x + 30 && b.dir === 2, `${a.x}->${b.x}`);
  } else {
    await holdKey(page, "ArrowLeft", 450); const a = await st(page);
    ok("desktop: ArrowLeft moves left", a.x < before.x - 30, `${before.x}->${a.x}`);
    await holdKey(page, "KeyD", 450); const b = await st(page);
    ok("desktop: D moves right", b.x > a.x + 30, `${a.x}->${b.x}`);
    await holdKey(page, "KeyS", 150); await holdKey(page, "KeyW", 250); const c = await st(page);
    ok("desktop: W moves up", c.y < b.y, `${b.y}->${c.y}`);
  }
  // walk up to Chronos (he stands just above the spawn) -> panel opens by bumping
  await page.evaluate(() => 0);
  let opened;
  if (touch) opened = await padHoldUntil(page, cdp, 0, -1, () => !!__aw.state().sheet, 4000);
  else { await page.keyboard.down("ArrowUp"); opened = await waitSheet(page, "agent", "chronos", 4000); await page.keyboard.up("ArrowUp"); }
  s = await st(page);
  ok(`${label}: walking into Chronos opens his panel`, opened && s.sheet?.kind === "agent" && s.sheet?.id === "chronos", JSON.stringify(s.sheet));
  const chronosText = await page.locator("#sheet-body").innerText();
  ok(`${label}: Chronos panel has name, title, owns, link`, /Chronos/.test(chronosText) && /Head of Ops/.test(chronosText) && /owns/i.test(chronosText) && (await page.locator('#sheet-body a[data-app="life-os"]').count()) === 1);
  if (touch) await page.screenshot({ path: OUT + "phone-panel-chronos.png" });
  await closeSheet(page);

  // Command Centre board: date, payday, fast travel chips
  const bp = await page.evaluate(() => __aw.boardScreen());
  let boardHow = "tap";
  if (onScreen(bp, vp)) await tapWorld(page, bp, touch);
  else { boardHow = "via Chronos panel (board off-screen)"; await tapWorld(page, await page.evaluate(() => __aw.agentScreen("chronos")), touch); await page.click("[data-open-board]"); }
  const boardOpen = await waitSheet(page, "board", "command-centre");
  const cText = boardOpen ? await page.locator("#sheet-body").innerText() : "";
  const today = await page.evaluate(() => __aw.time.longDate(__aw.time.bne()));
  ok(`${label}: Command Centre board opens`, boardOpen, boardHow);
  ok(`${label}: board shows Brisbane date, payday, next-due empty state, life-os link`, cText.includes(today) && /payday/i.test(cText) && /No data yet/.test(cText) && (await page.locator('#sheet-body a[data-app="life-os"]').count()) === 1, today);
  ok(`${label}: board has fast travel to all 12 other rooms`, (await page.locator("#sheet-body [data-travel]").count()) === 12);
  if (label === "phone") await page.screenshot({ path: OUT + "phone-board-command-centre.png" });
  await closeSheet(page);

  // walk through the bottom door -> hub
  await page.evaluate(() => 0);
  let inHub;
  if (touch) inHub = await padHoldUntil(page, cdp, 0, 1, () => __aw.state().room === "hub", 7000);
  else { await page.keyboard.down("ArrowDown"); inHub = await waitRoom(page, "hub", 7000); await page.keyboard.up("ArrowDown"); }
  await waitRoom(page, "hub");
  ok(`${label}: walking through the bottom door enters the Hallway`, inHub, JSON.stringify(await st(page)));
  await sleep(500);
  await page.screenshot({ path: OUT + `${label}-hub.png` });

  // tap-to-walk to the Treasury door in the hub
  const dp = await page.evaluate(() => __aw.doorScreen("treasury"));
  ok(`${label}: Treasury door is on screen`, onScreen(dp, vp), JSON.stringify(dp));
  ok(`${label}: tap-to-walk through a door changes room (Treasury)`, await tapDoor(page, "treasury", touch, vp, "treasury"), JSON.stringify(await st(page)));
  await sleep(400);
  await page.screenshot({ path: OUT + `${label}-treasury.png` });

  // tap Plutus -> panel with working links
  ok(`${label}: tapping Plutus opens his panel`, await tapAgent(page, "plutus", touch, vp));
  const links = await page.$$eval("#sheet-body a.app", (as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
  ok(`${label}: Plutus links = Pay Ledger, GreenLedger, take-home (new tab)`, links.length === 3 && links.every((l) => l.target === "_blank" && l.rel.includes("noopener")) && links.map((l) => l.href).join() === ["pay-ledger", "green-ledger", "bevchain-take-home"].map((r) => `https://timesnapx.github.io/${r}/`).join(), JSON.stringify(links.map((l) => l.href)));
  links.forEach((l) => linkTargets.add(l.href));
  if (label === "phone") await page.screenshot({ path: OUT + "phone-panel-plutus.png" });
  // open the room board from the agent panel
  await page.click("[data-open-board]");
  ok(`${label}: Treasury board opens from Plutus panel`, await waitSheet(page, "board", "treasury"));
  const tText = await page.locator("#sheet-body").innerText();
  ok(`${label}: Treasury board shows empty states, no invented numbers`, /last pay/i.test(tText) && /No data yet/.test(tText) && !/\$\d/.test(tText));
  await closeSheet(page);

  // fast travel via map
  await page.click("#map-btn");
  ok(`${label}: map opens with 13 rooms`, (await page.locator("#map-grid [data-travel]").count()) === 13);
  if (label === "phone") await page.screenshot({ path: OUT + "phone-map.png" });
  await page.click('#map-grid [data-travel="trading-floor"]');
  ok(`${label}: fast travel to Trading Floor`, await waitRoom(page, "trading-floor"));
  await sleep(400); await page.screenshot({ path: OUT + `${label}-trading-floor.png` });
  // keyboard M opens map on desktop
  if (!touch) { await page.keyboard.press("KeyM"); ok("desktop: M key opens map", (await st(page)).map); await page.keyboard.press("Escape"); ok("desktop: Escape closes map", !(await st(page)).map); }
  // trading board via red-flag strip tap is desktop-only visible; open via agent tap instead
  ok(`${label}: tapping Hades opens his panel (hades-trades link)`, (await tapAgent(page, "hades", touch, vp)) && (await page.locator('#sheet-body a[data-app="hades-trades"]').count()) === 1); await closeSheet(page);

  // more rooms + screenshots
  for (const id of ["depot", "map-room", "library", "forge", "gallery", "dojo", "hearth", "post-office", "pool-hall"]) {
    const ok2 = await travel(page, id); if (!ok2) ok(`${label}: travel ${id}`, false);
    await sleep(350);
    if (["depot", "map-room", "library"].includes(id) || !touch) await page.screenshot({ path: OUT + `${label}-${id}.png` });
  }
  // walk a side door: Depot -> Map Room by tapping the door (phone) or travel + key walk (desktop)
  await travel(page, "map-room");
  ok(`${label}: Map Room side door leads to the Depot`, await tapDoor(page, "depot", touch, vp, "depot"), JSON.stringify(await st(page)));
  // library quick ask: note only, no backend
  await travel(page, "library");
  const lb = await page.evaluate(() => __aw.boardScreen());
  if (onScreen(lb, vp)) await tapWorld(page, lb, touch);
  if (!(await waitSheet(page, "board", "library", 1500))) { await tapAgent(page, "athena", touch, vp); await page.click("[data-open-board]"); }
  await page.fill('[data-ask] input', "test question");
  const reqs = []; page.on("request", (r) => reqs.push(r.url()));
  await page.click('[data-ask] button');
  ok(`${label}: Library quick ask shows the 'ask Athena in Grok Bot' note and sends nothing`, (await page.locator("[data-ask-note]").isVisible()) && reqs.length === 0);
  await closeSheet(page);
  // Map Room board progress
  await travel(page, "map-room");
  await tapAgent(page, "hermes", touch, vp); await page.click("[data-open-board]");
  const mText = await page.locator("#sheet-body").innerText();
  ok(`${label}: Map Room shows HR done, HC next, MC goal`, /HR/.test(mText) && /Next step/.test(mText) && /MC/.test(mText) && (await page.locator('#sheet-body a[data-app="mc-career-tracker"]').count()) === 1);
  await closeSheet(page);
  // Forge lists every app + planned
  await travel(page, "forge");
  await tapAgent(page, "hephaestus", touch, vp); await page.click("[data-open-board]");
  const fl = await page.$$eval("#sheet-body a[data-app]", (as) => as.map((a) => a.href));
  const fText = await page.locator("#sheet-body").innerText();
  ok(`${label}: Forge board lists all 13 apps + Fresh As/TimeSnap planned`, fl.length === 13 && /Fresh As/.test(fText) && /TimeSnap/.test(fText) && (fText.match(/planned/g) || []).length === 2);
  fl.forEach((h) => linkTargets.add(h));
  await closeSheet(page);
  await sleep(300);
  ok(`${label}: no console errors / failed requests`, errors.length === 0, errors.slice(0, 5).join(" | "));
  await ctx.close();
}

// ---------------- status.json data rendering (sample data, test only) ----------------
{
  const sample = {
    updated: "2026-10-04T08:00:00Z",
    nextDue: { title: "TEST item", due: "2026-10-06" },
    treasury: { lastPay: { date: "2026-10-01", net: 1111.11, gross: 1500 }, weekHours: 12.5, expectedNextPay: { date: "2026-10-08", net: 999 }, due: [{ name: "Zeta bill", due: "2026-10-05", amount: 10 }, { name: "Superloop", due: "2026-10-20", amount: 20 }, { name: "RACQ", due: "2026-10-30", amount: 30 }] },
    depot: { shifts: [{ date: "2026-10-01", gateIn: "05:00", gateOut: "13:36", paidHours: 8.1 }] },
    trading: { redFlags: ["TEST flag"], notes: [], watchlist: [{ symbol: "TST", note: "n" }], balance: 123456 },
  };
  const { ctx, page, errors } = await open("status", DESKTOP, (p) => p.route("**/agent-world/status.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sample) })));
  await travel(page, "treasury");
  await tapAgent(page, "plutus", false, DESKTOP.viewport); await page.click("[data-open-board]");
  const items = await page.$$eval("#sheet-body .list li span:first-child", (s) => s.map((x) => x.textContent));
  const tText = await page.locator("#sheet-body").innerText();
  ok("status: Treasury lists RACQ then Superloop first", items[0] === "RACQ" && items[1] === "Superloop" && items[2] === "Zeta bill", items.join(","));
  ok("status: Treasury shows published pay numbers + as-of", tText.includes("$1,111.11") && tText.includes("12.5h") && /Data as of/.test(tText));
  await closeSheet(page);
  await travel(page, "depot");
  await tapAgent(page, "atlas", false, DESKTOP.viewport); await page.click("[data-open-board]");
  const dText = await page.locator("#sheet-body").innerText();
  ok("status: Depot computes gate-to-gate 8.6h and +0.5h vs 7.6h", dText.includes("8.6h") && dText.includes("+0.5h"));
  await closeSheet(page);
  await travel(page, "trading-floor");
  await tapAgent(page, "fortuna", false, DESKTOP.viewport); await page.click("[data-open-board]");
  const trText = await page.locator("#sheet-body").innerText();
  ok("status: Trading board shows red flags + watchlist, never balances", trText.includes("TEST flag") && trText.includes("TST") && !trText.includes("123456") && !trText.includes("123,456"));
  await page.screenshot({ path: OUT + "desktop-board-trading-sample-data.png" });
  ok("status page: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------------- placeholder fallback (no Apollo art) + still-only sprite ----------------
{
  const { ctx, page, errors } = await open("placeholder", PHONE, (p) => p.route("**/agent-world/art.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sprites: ["chronos-idle.png", "chronos-idle@2x.png"], rooms: [] }) })));
  const s = await st(page);
  ok("placeholder: runs with no room art and only a still sprite", s.art.rooms === 0 && s.art.sprites === 1, JSON.stringify(s.art));
  await page.screenshot({ path: OUT + "phone-placeholder-command-centre.png" });
  await travel(page, "hub"); await sleep(300); await page.screenshot({ path: OUT + "phone-placeholder-hub.png" });
  ok("placeholder: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------------- links resolve ----------------
for (const href of [...linkTargets].sort()) {
  let code = 0; try { code = (await fetch(href, { method: "GET", redirect: "follow" })).status; } catch { code = -1; }
  results.push(`LINK ${code} ${href}`); console.log(results.at(-1));
}
await browser.close(); srv.close();
fs.writeFileSync(OUT + "results.txt", results.join("\n") + `\n\n${pass} passed, ${fail} failed\n`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
