# Agent World art (ASSETS.md)

Drop files into `assets/` and run `npm run build`. The build lists what exists in `docs/art.json`,
and the app only loads listed files, so a missing file never causes a 404. Anything missing
falls back to code-drawn placeholder art (coloured floors/walls, crates, 4-direction characters).

## Characters: `assets/sprites/`

| File | What it is |
| --- | --- |
| `<id>.png` | **Walk sheet**: 4 columns x 4 rows. Rows are **down, left, right, up**; 4 frames each. Any equal frame size works (frame = width/4 x height/4). Apollo's are 192x192 (48px frames). |
| `<id>@2x.png` | Same sheet at double resolution (Apollo's: 384x384, 96px frames). Used when the screen scale is 2x or more, so it stays 1:1 crisp. Optional. |
| `<id>-idle.png` | **Single still image** (front-facing). Shown when the character stands still facing down. Optional. |
| `<id>-idle@2x.png` | Still at double resolution. Optional. |
| `sprites.json` | Optional metadata: `{"frame_size":48,"frames_per_row":4,"rows":["down","left","right","up"],"still":["<id>"]}`. `frames_per_row` changes the column count; ids listed in `still` treat `<id>.png` as a single still. |

- `<id>` is the lowercase agent id from `src/world.json` (`chronos`, `plutus`, ... `hephaestus`), plus `timesnap` for the player.
- Characters are **bottom-aligned**: the bottom-centre of each frame is the feet. Every sprite is drawn
  `spriteHeight` (48) room pixels tall, anchored at the feet, at the screen's integer scale.
- **Only a still image?** Supply just `<id>-idle.png` (or `<id>.png` listed under `still`). The engine
  adds a code-made bob and walk wobble, and mirrors it when walking left.
- Transparent PNG (RGBA). Pixel art is drawn nearest-neighbour; images larger than their on-screen
  size are smoothed when shrunk.

## Rooms: `assets/rooms/<room-id>.png`

- One top-down background per room, **1280x720**, no text (names/labels are drawn by the app).
- Room ids: `command-centre, treasury, trading-floor, hearth, depot, map-room, dojo, library, forge, gallery, post-office, pool-hall, hub`.
- The build also writes a WebP copy (quality 90, ~5x smaller) into `docs/` and the app prefers it.
  A `.webp` you supply yourself is used as-is.

### Collision, doors and spots (in `src/world.json`, room pixels)

All rects are `[x, y, w, h]` in the 1280x720 image's pixels and describe where **feet** can go.

- `walkable`: list of floor rects (union). Include the little corridor into each door.
- `blocked`: furniture/obstacles cut out of the floor.
- `doors[]`: `rect` is the trigger (walk into it while moving towards it, or tap it), `spawn` is where you
  appear when arriving through this door, `face` is the way you face on arrival (into the room),
  `to`/`toDoor` link to the matching door in the other room.
- `agents[]`: home spot (feet) for each agent; they wander a little around it.
- `board`: feet position of the "at a glance" sign; it is drawn by the app and is solid.
- `redflags` (Trading Floor): the red warning strip on the right wall; it is unwalkable and tapping it opens the board.

Check a room after editing with `http://localhost:5173/agent-world/?debug` (`npm run dev`): green = walkable,
red = blocked, cyan boxes = door triggers, yellow dots = arrival spots. `node tests/debug-shots.mjs`
saves the overlay for every room to `.work/`, and the e2e test fails if any spawn, agent, board
or door is unreachable.
