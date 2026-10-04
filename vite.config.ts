import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const ART = path.join(ROOT, "assets");
const BASE = "/agent-world/";

/** List Apollo's art so the app only requests files that exist (no 404s). */
function scanArt() {
  const list = (d: string) => (fs.existsSync(path.join(ART, d)) ? fs.readdirSync(path.join(ART, d)).filter((f) => /^[a-z0-9@_-]+\.(png|webp)$/i.test(f)).sort() : []);
  const sprites = list("sprites"), rooms = list("rooms");
  let spriteMeta: unknown = undefined;
  const metaFile = path.join(ART, "sprites", "sprites.json");
  if (fs.existsSync(metaFile)) { try { spriteMeta = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch { /* ignore bad meta */ } }
  const h = crypto.createHash("sha1");
  for (const [d, fl] of [["sprites", sprites], ["rooms", rooms]] as const) for (const f of fl) { const st = fs.statSync(path.join(ART, d, f)); h.update(`${d}/${f}:${st.size}:${st.mtimeMs}`); }
  return { v: h.digest("hex").slice(0, 10), sprites, rooms, spriteMeta };
}

function artPlugin(): Plugin {
  let outDir = "docs";
  return {
    name: "agent-world-art",
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = (req.url || "").split("?")[0];
        if (u === `${BASE}art.json`) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(scanArt())); return; }
        if (u.startsWith(`${BASE}assets/`)) {
          const f = path.join(ART, decodeURIComponent(u.slice(`${BASE}assets/`.length)));
          if (f.startsWith(ART) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader("content-type", f.endsWith(".json") ? "application/json" : "image/png"); fs.createReadStream(f).pipe(res); return; }
        }
        next();
      });
    },
    writeBundle() {
      const art = scanArt();
      for (const d of ["sprites", "rooms"]) {
        const src = path.join(ART, d), dst = path.join(outDir, "assets", d);
        fs.mkdirSync(dst, { recursive: true });
        for (const f of (art as any)[d] as string[]) fs.copyFileSync(path.join(src, f), path.join(dst, f));
      }
      // Room backgrounds are big PNGs (1-2 MB). Ship WebP (quality 90, ~5x smaller) for phones;
      // the PNG stays as the fallback if conversion isn't available. Cached in .cache/rooms-webp.
      const cache = path.join(ROOT, ".cache", "rooms-webp"); fs.mkdirSync(cache, { recursive: true });
      const webp: string[] = [];
      for (const f of art.rooms.filter((f) => f.endsWith(".png"))) {
        const id = f.slice(0, -4), srcF = path.join(ART, "rooms", f), st = fs.statSync(srcF);
        const cached = path.join(cache, `${id}-${st.size}-${Math.round(st.mtimeMs)}.webp`);
        try {
          if (!fs.existsSync(cached)) execFileSync("python3", ["-c", "import sys;from PIL import Image;Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2],'WEBP',quality=90,method=6)", srcF, cached]);
          fs.copyFileSync(cached, path.join(outDir, "assets", "rooms", `${id}.webp`));
          fs.rmSync(path.join(outDir, "assets", "rooms", f)); webp.push(`${id}.webp`);
        } catch { webp.push(f); }
      }
      art.rooms = [...webp, ...art.rooms.filter((f) => !f.endsWith(".png"))].sort();
      fs.writeFileSync(path.join(outDir, "art.json"), JSON.stringify(art));
      // Precache the app shell + built code (art is cached on first use).
      const files: string[] = ["./"];
      const walk = (d: string, rel = "") => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f), r = rel + f; if (fs.statSync(p).isDirectory()) { if (f !== "assets") walk(p, r + "/"); } else if (!["sw.js", "status.json", "index.html"].includes(r) && !r.endsWith(".map")) files.push(r); } };
      walk(outDir);
      const swPath = path.join(outDir, "sw.js");
      const sw = fs.readFileSync(swPath, "utf8").replace("/*__PRECACHE__*/", files.map((f) => JSON.stringify(f)).join(", "))
        .replace(/const VERSION = "[^"]*";/, `const VERSION = "${crypto.createHash("sha1").update(files.join()).update(art.v).digest("hex").slice(0, 8)}";`);
      fs.writeFileSync(swPath, sw);
      fs.writeFileSync(path.join(outDir, ".nojekyll"), "");
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [artPlugin()],
  build: { outDir: "docs", emptyOutDir: true, assetsDir: "app", target: "es2020", sourcemap: false },
});
