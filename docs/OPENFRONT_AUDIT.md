# OpenFront audit — solo derivative

This document records what this derivative ("Frontline Solo") is based on,
what was inspected, and exactly what was retained, removed and changed
relative to upstream OpenFront.

## Baseline

- **Upstream repository**: https://github.com/openfrontio/OpenFrontIO
- **Upstream commit**: `d76691372c3f0dd039aa53236b1bbd2f7eb64100`
  ("Feature/reuse private lobby (#4536)")
- **License**: AGPL-3.0 (code), CC BY-SA 4.0 (`/resources` assets),
  all-rights-reserved (`/proprietary` assets — removed from this fork).

## Live game inspection

The live game at https://openfront.io/ was **not reachable** from the
sandboxed development environment used to build this fork (outbound
connections to openfront.io are reset by the environment's egress policy).
This is stated per the project brief rather than claiming an inspection
that did not happen.

Instead, the **unmodified upstream build was run locally**
(`npm run dev` at the baseline commit) and used as the interface and
interaction reference; it renders the same client as the live service
minus the production integrations. Screens inspected on the unmodified
local build:

- Landing page (nav, username/tag input, public lobby cards, Solo /
  Create / Ranked / Join buttons, footer)
- Single-player setup (map picker with featured/all/favorites/search,
  difficulty cards, mode, options, unit toggles)
- Spawn selection on the live map, spawn countdown
- In-game HUD: leaderboard (top-left), game right sidebar (timer, speed,
  pause, fullscreen, exit), bottom control panel (population/gold,
  troop-worker slider, attack-percentage slider, build bar), events and
  attack displays
- Territory expansion into wilderness, attacks against bots/nations,
  troop-commit behaviour
- Radial action menu (right click), build menu, player panel
- Win/defeat modal, replay panel, settings modal

Controls observed and preserved: left click = select/attack/expand target,
right click = radial action menu, drag = pan, wheel/pinch = zoom, number
keys = structure ghost + click to place, `Escape`/click-away closes menus,
browser context menu suppressed over the map, sliders for troop/worker
split and attack percentage.

## Source directories reviewed

`src/core` (simulation, executions, configuration, worker, pathfinding),
`src/client` (Main, menu modals, HUD layers, render pipeline, LocalServer,
Transport, Api/Auth/Cosmetics), `src/server` (Master/Worker, lobby
services, asset serving, archiving), `resources` and `proprietary` asset
trees, `tests` (unit/integration), build config (vite, tsconfig, eslint).

## Retained functionality

- Full deterministic simulation (`src/core`) — untouched: territory
  expansion/attacks, population/worker/troop economy, gold, cities,
  defense posts, ports & trade, missile silos, SAM launchers, factories,
  transport ships, warships, atom/hydrogen bombs, MIRVs, alliances with
  AI (incl. custom alliance duration option), doomsday clock mode,
  structure upgrades, railroads, veterancy — everything upstream
  single-player supports.
- Single-player runtime: `LocalServer` (in-browser intent relay) + game
  worker; pause/resume, game speed control, replay panel in solo.
- Existing bot/nation AI at all four difficulties.
- WebGL2 renderer, Lit HUD, input handling, mobile/touch layout.
- Win/defeat detection and the win modal (promo content removed).
- Local persistence: settings, username, local single-player stats and
  local archive of finished games.
- Quick chat (phrase-based, offline; see "intentional deviations").
- Full i18n system and translations (keys for removed UI pruned).
- Test suite (1,592 client/core + 160 server tests at time of writing),
  extended with solo-config tests and a Playwright E2E flow.

## Removed functionality

Product surface (deleted from bundle and/or repo):

- Public lobbies/matchmaking/ranked queue, private host/join lobby flows,
  lobby browser and lobby socket polling
- Accounts (Discord/Google/magic-link login), user profiles, rewards,
  token login, session refresh
- Clans (browser, management, history, leaderboards), friends
- Store: cosmetics/patterns/skins/effects purchases, subscriptions,
  currency packs, checkout/purchase-completed flows
- Global leaderboards and online stats views
- News page/box and marketing consent toast
- Ads: Playwire/ramp, Google ads/gtag/Tag Manager, in-game promo layer,
  `ads.txt`
- CrazyGames SDK integration (script removed; SDK wrapper remains as an
  inert no-op since the script never loads)
- Cloudflare Turnstile (not needed: no server matchmaking)
- Cloudflare Insights beacon and all analytics/telemetry (incl. the
  WebGL-init gtag event, now a local console log)
- Multi-tab detection (multiplayer anti-abuse)
- "New lobby"/requeue buttons and multiplayer team modes with humans
- Server: public-game scheduling and lobby broadcasting
  (`MasterLobbyService`), i.e. the server never creates multiplayer games
- External promos: YouTube tutorial embeds, Steam wishlist link, Discord
  invite, Reddit/wiki links

Assets removed (proprietary, all-rights-reserved upstream):

- `proprietary/images` (OpenFront logos, favicon), `proprietary/fonts`
  (OpenFront.ttf), `proprietary/sounds/music` (all background music).
  Replaced by original placeholder branding in `/resources`
  (`FrontlineFavicon.svg`, `icon512_*.png`) or disabled (music).

## Changed functionality

- Landing page reduced to: brand, username/flag input, Solo button,
  derivative notice, footer with AGPL source link and attribution.
- Nav reduced to Play / Settings / Help (+ language selector in footer).
- Solo setup: game mode fixed to FFA vs AI (team-vs-AI selector removed),
  map picker reduced to the enabled solo map registry
  (`src/core/configuration/SoloMaps.ts`, currently **World**),
  achievements/medals UI removed (required an account).
- `Auth.userAuth()` always resolves to guest (no network);
  `getPlayToken()` uses the locally-stored persistent ID.
- `Cosmetics.fetchCosmetics()` returns null (no catalogue); flag/pattern
  cosmetics UI reduced to the free local flag picker.
- Clan tags remain as purely cosmetic name prefixes; the account-based
  ownership check is skipped.
- Win modal shows only the result and exit/keep-playing actions.
- Background music playlist is empty (proprietary tracks removed).
- New opt-in software-WebGL escape hatch (`?softwareGL=1` /
  `localStorage.allowSoftwareGL`) for GPU-less machines and headless E2E.
- Web manifest renamed; unused translation keys pruned across all locales.

## Intentional deviations from the brief

- **Quick chat retained** (brief listed "chat and quick chat" for
  removal): it is phrase-based, fully offline, deterministic (intents via
  LocalServer) and structurally woven into the radial menu and player
  panel. Removing it would have left dead radial-menu entries or required
  invasive changes for no privacy/network benefit. No human-to-human chat
  exists in this build.
- **Emoji reactions retained** for the same reason (offline intents).
- **The full upstream map catalogue remains in `resources/maps`** even
  though only World is enabled; this keeps "add another map" a one-line
  change, per the extensibility requirement.

## Production APIs removed / verified

The client makes **no requests to OpenFront production services**. All
`api.openfront.io` / auth / cosmetics / lobby endpoints are either deleted
with their callers or short-circuited before any fetch. Verified by
(1) code audit of every `fetch(` call site in `src/client`, and
(2) recording all network requests during a full Playwright-driven play
session — zero non-localhost requests (previously youtube.com from the
tutorial embed; now none).

## Remaining legal / attribution notes

- Keep the footer attribution ("modified derivative of OpenFront…",
  © OpenFront™ and Contributors) and the source-code link intact in any
  deployment (AGPL §13 applies to network use).
- CC BY-SA attribution for `/resources` assets (maps, icons, sound
  effects, flags) is in CREDITS.md / LICENSE-ASSETS; keep both files.
- The OpenFront™ name is used only for attribution, not as branding.
- `terms-of-service.html` / `privacy-policy.html` upstream pages were tied
  to the online service and are not linked from the solo build; a real
  deployment should ship its own.
