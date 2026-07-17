import fs from "fs";
import path from "path";
import { SCENARIOS } from "../src/core/configuration/Scenarios";
import { ENABLED_SOLO_MAPS } from "../src/core/configuration/SoloMaps";
import { Difficulty } from "../src/core/game/Game";

describe("scenario presets (#3)", () => {
  const en = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "resources", "lang", "en.json"),
      "utf8",
    ),
  );

  test("every scenario points at an enabled solo map with valid settings", () => {
    for (const s of SCENARIOS) {
      expect(ENABLED_SOLO_MAPS).toContain(s.map);
      expect(Object.values(Difficulty)).toContain(s.difficulty);
      expect(s.bots).toBeGreaterThanOrEqual(0);
      expect(s.bots).toBeLessThanOrEqual(400);
      expect(["domination", "economic", "straits"]).toContain(
        s.victoryCondition,
      );
    }
  });

  test("scenario ids are unique and fully translated", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(en.scenario[id], `scenario.${id}`).toBeTruthy();
      expect(en.scenario[`${id}_desc`], `scenario.${id}_desc`).toBeTruthy();
    }
  });

  test("empire identity translations exist", () => {
    for (const key of [
      "title_label",
      "title_none",
      "title_empire",
      "title_republic",
      "title_kingdom",
      "title_commonwealth",
      "title_federation",
      "title_free_state",
      "color_label",
      "color_auto",
    ]) {
      expect(en.identity[key], `identity.${key}`).toBeTruthy();
    }
  });
});
