# Gameplay features (solo derivative)

The systems added on top of the upstream OpenFront ruleset, making matches
on the real-world maps more real and more personal. All simulation-side
systems are deterministic (seeded PRNG / pure functions of the tick) and
covered by `tests/WorldGameplay.test.ts`.

## Shipped

| #   | Feature                | What it does                                                                                                                                                                                                    | Where                                       |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 4   | **Real elevation**     | Terrain bands come from NOAA ETOPO1: the Great Dividing Range, Southern Alps and New Guinea highlands are real mountains that slow attacks; water shading is real bathymetry.                                   | pipeline (`scripts/world/elevation.ts`)     |
| 5   | **Rivers**             | Major rivers (Murray–Darling, Fly, Sepik, Waikato…) are thin water with periodic fords: they channel and slow expansion but never disconnect a landmass.                                                        | pipeline (`paintRivers`)                    |
| 6   | **Seasons & monsoon**  | A four-season cycle (~3 min/season); during the wet season, attacks inside the monsoon belt (north of ~20°S) are 35% slower and 15% costlier. Toggleable in solo setup.                                         | `src/core/game/Weather.ts`                  |
| 7   | **AI personalities**   | Every nation and bot rolls a deterministic archetype — aggressive, turtle, opportunist, vengeful — shaping its reserves, reaction speed and target choice (vengeful AIs hold grudges via the relations system). | `src/core/execution/utils/AiPersonality.ts` |
| 11  | **Real resources**     | 24 real deposits (Pilbara iron, Kalgoorlie gold, Hunter coal, NW Shelf gas, Ok Tedi copper…) on their true locations, drawn as obvious mine/derrick buildings. Capturing one pays a 75k gold windfall; owning one pays a strong per-tick bonus, and sites can be developed to level 3 (radial menu → Develop) to multiply the payout. | `WorldExecution` + `ResourceOverlay`        |
| 12  | **Chokepoint control** | Controlling ≥60% of the shoreline around a real strait (Bass, Cook, Torres, Lombok, Makassar, Vitiaz, Foveaux) collects a naval toll. The capture zone is drawn as a control ring with a live readout of the leader's shoreline share vs the 60% threshold.                                                                           | `WorldExecution` + `ResourceOverlay`        |
| 14  | **Capital crisis**     | Your first spawn tile is your capital — humans and nations get a free capital City there, crowned on the map. Losing it halves gold income until you retake it; after ~1 min a small realm relocates its government, but a large empire **shatters**: 2–3 AI successor states split off and only a rump around a surviving city remains yours.                        | `PlayerExecution`                           |
| 16  | **Espionage**          | Radial menu on a rival: steal from their treasury or incite a border uprising (tiles defect to neutral). Costs gold, shared cooldown, can fail and be exposed; always sours relations.                          | `SpyExecution`                              |
| 17  | **Victory conditions** | Solo setup offers land domination (classic), economic victory (hold the majority of resource sites ~5 min) or strait supremacy (control every chokepoint ~5 min).                                               | `WorldExecution` + `WinCheckExecution`      |
| 18  | **World events**       | Seeded, deterministic events: gold rushes at a named deposit (4× payout), trade booms, plagues — announced in the event feed.                                                                                   | `WorldExecution`                            |
| 19  | **Feedback**           | Event-feed styling for all new events; capture/toll sounds (ka-ching) and event pings via the existing sound system; resource/strait markers fade in with zoom.                                                 | client                                      |

## Notes and limits

- Weather, resources, chokepoints and events only run on maps that carry
  the data (the world-pipeline maps); classic maps are unchanged.
- Capital crisis currently affects gold (not troop growth) — the troop
  rate is shared with the client-side view where capital state isn't
  mirrored yet.
- Espionage success/failure is drawn from the deterministic game PRNG:
  replays reproduce the same outcomes.
- The plague/trade-boom events apply globally; regional targeting (and a
  cyclone that disrupts naval movement) are natural extensions once
  per-region state is worth the complexity.

## Also shipped

| #   | Feature              | What it does                                                                                                                                                                                                                                                           | Where                                 |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 3   | **Scenario presets** | Seven one-click starts in solo setup — Battle for Oceania, Outback Rush (economic), Master of the Straits (naval), Tasmanian Campaign, Long White Cloud, Coral Sea Theatre, Impossible Australia — each bundling map, difficulty, bots, victory condition and weather. | `src/core/configuration/Scenarios.ts` |
| 13  | **Empire identity**  | Pick an empire title (Kingdom of / Republic of / …) and a custom territory color in solo setup; the composed name and color flow through the simulation, HUD and map. Flag picker as before.                                                                           | `SinglePlayerModal`                   |
| —   | **Overextension**    | Blitzing new territory builds **unrest** (0–100). A warning fires at 50; at 100 a border region rebels and defects to neutral. Garrisoning (keeping >50% of max troops in reserve) halves unrest gains, and the radial **Invest** action buys it down directly — expansion has an economic cost.                                       | `PlayerExecution` + `StabilizeExecution` |
| —   | **Bigger lobbies**   | The solo bot cap is raised to 1000 (slider + schema); the Battle for Oceania scenario now seeds 600 AI states.                                                                                                                                                          | `Schemas.ts` + solo setup             |

## Still planned (from the feature list)

- **#8 save/resume** (deterministic replay fast-forward — the turn log
  and replay machinery already exist in the engine), and a deeper
  **#19 juice pass** (music, ambient audio, territory-claim animations).
- **Rail links between resource sites** (connect developed sites for a
  network bonus) — deferred; site levels are the first step.
