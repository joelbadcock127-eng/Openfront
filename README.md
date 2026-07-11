# Frontline Solo

**Frontline Solo** is a fully playable, browser-based **solo territorial
strategy game**: expand your nation across the map, manage population and
gold, build cities, defenses, ports, silos and warships, and out-play
AI-controlled opponents until you conquer the map — or get eliminated.

It is a **modified derivative of [OpenFront](https://github.com/openfrontio/OpenFrontIO)**
(the open-source territorial strategy game behind [openfront.io](https://openfront.io/)),
stripped down to a standalone single-player experience. It is **not** the
official OpenFront service and is not affiliated with OpenFront Inc.

> "Frontline Solo" is a temporary working title. All branding lives in
> [`src/core/configuration/Branding.ts`](src/core/configuration/Branding.ts) —
> rename the game by editing that one file.

## Attribution & licensing

- **Source code**: GNU Affero General Public License v3.0 (see
  [LICENSE](LICENSE)). This repository is a derivative of
  [openfrontio/OpenFrontIO](https://github.com/openfrontio/OpenFrontIO),
  based on upstream commit `d76691372c3f0dd039aa53236b1bbd2f7eb64100`.
  Copyright © OpenFront™ and Contributors; modifications © the contributors
  of this repository. As required by the AGPL, the running game links to
  this repository's source from its footer.
- **Assets**: files under [`/resources`](resources) are CC BY-SA 4.0
  (attribution: "OpenFront" / "OpenFront Inc.") — see
  [LICENSE-ASSETS](LICENSE-ASSETS) and [CREDITS.md](CREDITS.md). Upstream's
  proprietary assets (logos, favicon, font, music) have been **removed**;
  the placeholder mark in `resources/images/FrontlineFavicon.svg` and
  `resources/icons/icon512_*.png` is original to this fork.
- For license history, see [LICENSING.md](LICENSING.md). A full record of
  what changed relative to upstream is in
  [docs/OPENFRONT_AUDIT.md](docs/OPENFRONT_AUDIT.md) and
  [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md).

## Playing

The whole game runs locally in your browser: the deterministic simulation
runs in a Web Worker on your machine, and a small local Node server serves
the static assets (and archives finished solo games locally). **No accounts,
no matchmaking, no external services** — the game makes no requests to
OpenFront production servers.

1. Open the game → enter (or keep) a player name.
2. **Solo** → pick difficulty (Easy / Medium / Hard / Impossible), number of
   AI bots and nations, and optional rule tweaks (instant build, gold
   multiplier, disabled unit types, doomsday clock…).
3. **Start Game** → click a valid land tile to choose your spawn.
4. Expand into neutral land, attack neighbours (left click), open the radial
   action menu (right click) to build structures, send transport ships
   across water, and manage your troop/worker and attack-percentage sliders
   in the bottom HUD.
5. Win by conquering the map; lose by being eliminated.

Requires a browser with GPU-accelerated WebGL2. On machines without one you
can opt into slow software rendering with `?softwareGL=1` (or
`localStorage.setItem("allowSoftwareGL", "1")`).

## Prerequisites

- [npm](https://www.npmjs.com/) (v10.9.2 or higher)
- A modern web browser (Chrome, Firefox, Edge, etc.)

## Installation

```bash
git clone https://github.com/joelbadcock127-eng/Openfront.git
cd Openfront
npm run inst
```

Do NOT use `npm install` — `npm run inst` runs the safer
`npm ci --ignore-scripts`, installing exactly the versions in
`package-lock.json` without running install scripts.

## Development commands

```bash
npm run dev         # dev server → http://localhost:9000
npm test            # unit/integration tests (vitest)
npm run test:e2e    # browser end-to-end test (Playwright)
npm run lint        # eslint
npx tsc --noEmit    # typecheck
npm run format      # prettier
```

## Production build

```bash
npm run build-prod  # typecheck + vite build → static/
npm run tunnel      # production build + serve it with the Node server
```

## Architecture (solo build)

The upstream architecture is preserved — see
[docs/Architecture.md](docs/Architecture.md) for the deep dive:

- **`src/core`** — deterministic simulation: game state, executions
  (attacks, construction, nukes, trade…), pathfinding, seeded PRNG
  (`PseudoRandom`), map loading. Runs in a **Web Worker**
  (`src/core/worker`) so the UI thread stays smooth. Identical seeds and
  intents produce identical outcomes.
- **`src/client`** — WebGL2 renderer (`src/client/render`), Lit-based HUD
  (`src/client/hud`), input handling, and the solo menu flow.
  Single-player games run against **`src/client/LocalServer.ts`**, an
  in-browser stand-in for the multiplayer relay: your intents loop straight
  back into the local simulation, so gameplay is fully offline.
- **`src/server`** — small Node server used to serve the built client and
  archive finished solo games locally. Public-lobby scheduling and all
  multiplayer endpoints are disabled in this fork.

### AI system

The AI is upstream's bot/nation AI, unchanged: bots and nations spawn,
expand into neutral land, attack and defend, build structures, use naval
units, and respond to the player (see `src/core/execution/`, e.g.
`BotBehavior.ts`, `FakeHumanExecution.ts`). The **difficulty setting**
(Easy / Medium / Hard / Impossible) alters AI decision quality, aggression
and economy via `src/core/configuration/` rather than giving flat cheats.

### Map system

Maps live in `resources/maps/<id>/` (binary terrain + `manifest.json` with
nations/spawns) and are registered in `src/core/game/Maps.gen.ts`. The solo
build enables a single polished map (**World** — large land masses,
navigable oceans, coasts, islands and chokepoints, so every system incl.
navy and long-range weapons is exercised) via
[`src/core/configuration/SoloMaps.ts`](src/core/configuration/SoloMaps.ts).

### How to add another map

Add one line to `ENABLED_SOLO_MAPS` in
[`src/core/configuration/SoloMaps.ts`](src/core/configuration/SoloMaps.ts) —
every upstream map already ships in `resources/maps/`. To build a brand new
map, see [docs/MAP_GUIDE.md](docs/MAP_GUIDE.md).

### How to change branding

Edit [`src/core/configuration/Branding.ts`](src/core/configuration/Branding.ts)
(game name, tagline, source URL) and replace the placeholder art
(`resources/images/FrontlineFavicon.svg`, `resources/icons/icon512_*.png`,
`resources/manifest.json` name fields). Do not reuse OpenFront's name or
logos as your brand.

## Source-code availability (AGPL)

If you deploy this game (including as a network service), the AGPL-3.0
requires you to offer the complete corresponding source to your users.
This build satisfies that with the "Source code" link in the page footer —
keep `BRANDING.sourceCodeUrl` pointing at the repository that actually
contains the code you deploy.

## Known limitations

- One map is enabled (by design for this version); the full upstream map
  catalogue remains in `resources/maps` and can be enabled per-map.
- Background music is disabled (upstream's music is a proprietary asset);
  sound effects are intact.
- Multiplayer, accounts, clans, cosmetics stores, online replays and all
  other online services are intentionally removed — see
  [docs/OPENFRONT_AUDIT.md](docs/OPENFRONT_AUDIT.md) for the complete list
  and rationale.
- Quick-chat (phrase-based messages to AI players) is retained since it
  runs fully offline and is woven into the radial menu.
