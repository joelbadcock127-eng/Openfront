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
| 11  | **Real resources**     | 24 real deposits (Pilbara iron, Kalgoorlie gold, Hunter coal, NW Shelf gas, Ok Tedi copper…) on their true locations; owning one pays a per-tick gold bonus. Marked on the map with names.                      | `WorldExecution` + `ResourceOverlay`        |
| 12  | **Chokepoint control** | Controlling ≥60% of the shoreline around a real strait (Bass, Cook, Torres, Lombok, Makassar, Vitiaz, Foveaux) collects a naval toll.                                                                           | `WorldExecution`                            |
| 14  | **Capital crisis**     | Your first spawn tile is your capital. Losing it halves gold income until you retake it — or after ~1 min the government relocates to a surviving city.                                                         | `PlayerExecution`                           |
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

## Still planned (from the feature list)

- **#3 scenario presets**, **#8 save/resume** (deterministic replay
  fast-forward — the turn log and replay machinery already exist),
  **#13 richer empire identity** (custom nation naming/colors beyond the
  existing name+flag), and a deeper **#19 juice pass** (music, ambient
  audio, territory-claim animations).
