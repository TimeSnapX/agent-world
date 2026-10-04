// Collision overlay screenshots of every room: node tests/debug-shots.mjs
import { createRequire } from "node:module";
import { start } from "./server.mjs";
const { chromium } = createRequire("/workspace/tools/package.json")("playwright-core");
const srv = await start(4791);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
p.on("console", (m) => m.type() === "error" && console.log("console", m.text()));
await p.goto("http://127.0.0.1:4791/agent-world/?debug", { waitUntil: "networkidle" });
await p.waitForFunction(() => window.__aw);
console.log(JSON.stringify(await p.evaluate(() => __aw.validate()), null, 1));
const out = process.argv[2] || "/workspace/agent-world/.work";
for (const r of await p.evaluate(() => __aw.world.rooms.map((r) => r.id))) {
  await p.evaluate((id) => { const g = window.__awGame; }, r);
  await p.evaluate((id) => document.querySelector(`[data-travel]`) , r);
  await p.keyboard.press("KeyM");
  await p.click(`#map-grid [data-travel="${r}"]`);
  await p.waitForFunction((id) => __aw.state().room === id && !__aw.state().transitioning, r);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/dbg-${r}.png` });
}
await b.close(); srv.close();
