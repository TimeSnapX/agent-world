# Agent World

TimeSnap's AI agent dashboard as a walkable top-down pixel world. Walk between rooms, bump into or
tap an agent to see who they are, what they own and their apps, and read each room's
"at a glance" board.

Live (once published): https://timesnapx.github.io/agent-world/

## Controls

| | Phone | Desktop |
| --- | --- | --- |
| Walk | Joystick/D-pad (bottom left), or tap the floor to walk there | Arrow keys or WASD, or click the floor |
| Talk / read | Walk into an agent or board, tap them, or press **A** | Walk into them, click, or press E / Enter / Space |
| Change room | Walk (or tap) into a glowing door | same |
| Fast travel | **Map** button (top right) | **Map** button or M |
| Close | ✕ | ✕ or Esc |

## Rooms

Command Centre (Chronos, start) · Treasury (Plutus) · Trading Floor (Fortuna, Hades, Argus) ·
Hearth (Hestia) · Depot (Atlas) · Map Room (Hermes, next to the Depot) · Dojo (Hygieia) ·
Library (Athena, Thoth, Prometheus) · Forge (Hephaestus, Daedalus) · Gallery (Apollo, next to the Forge) ·
Post Office (Iris) · Pool Hall (Artemis) · Hallway (fountain plaza with 12 doors).

Everything about the world (rooms, agents, who is where, doors, collision, app links) lives in
**`src/world.json`**. See ASSETS.md for art + collision, DATA.md for board data.

## Develop

```
npm install
npm run dev                 # http://localhost:5173/agent-world/   (?debug shows collision)
npm run build               # type-check + build to docs/ (what GitHub Pages serves)
npm test                    # e2e: phone 412x915 + desktop, screenshots to test-results/
node /workspace/pwa-check/check.mjs http://127.0.0.1:4799/agent-world/   # with `npm run preview` running
```

Vite + vanilla TypeScript, one canvas, no runtime dependencies. Built output is committed in
`docs/` and Pages serves `main:/docs`. Installable PWA (manifest id/scope `/agent-world/`,
network-first service worker that never handles cross-origin requests or `status.json`).
