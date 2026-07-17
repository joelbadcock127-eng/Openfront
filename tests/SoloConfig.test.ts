import { BRANDING } from "../src/core/configuration/Branding";
import {
  DEFAULT_SOLO_MAP,
  ENABLED_SOLO_MAPS,
  soloMaps,
} from "../src/core/configuration/SoloMaps";
import { GameMapType, maps } from "../src/core/game/Game";

describe("Solo map registry", () => {
  test("at least one map is enabled and each maps to a registry entry", () => {
    expect(ENABLED_SOLO_MAPS.length).toBeGreaterThanOrEqual(1);
    expect(soloMaps.length).toBe(ENABLED_SOLO_MAPS.length);
    for (const info of soloMaps) {
      expect(ENABLED_SOLO_MAPS).toContain(info.type);
      expect(maps.find((m) => m.type === info.type)).toBeDefined();
      expect(info.id.length).toBeGreaterThan(0);
      expect(info.translationKey.length).toBeGreaterThan(0);
    }
  });

  test("default map is the first enabled map (the continuous world)", () => {
    expect(DEFAULT_SOLO_MAP).toBe(ENABLED_SOLO_MAPS[0]);
    expect(DEFAULT_SOLO_MAP).toBe(GameMapType.WorldOceania);
  });
});

describe("Branding config", () => {
  test("does not use the upstream name as the game's own brand", () => {
    expect(BRANDING.gameName.toLowerCase()).not.toContain("openfront");
  });

  test("keeps AGPL attribution and source availability info", () => {
    expect(BRANDING.license).toBe("AGPL-3.0");
    expect(BRANDING.sourceCodeUrl).toMatch(/^https:\/\//);
    expect(BRANDING.upstream.repoUrl).toContain("openfrontio/OpenFrontIO");
    expect(BRANDING.upstream.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
