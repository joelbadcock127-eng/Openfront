/**
 * Deterministic AI personalities for nations and bot tribes.
 *
 * Each AI actor rolls an archetype from its seeded PseudoRandom (same
 * seed ⇒ same personality, replay-safe). The archetype sets the classic
 * attack ratios, scales reaction speed, and biases the target-selection
 * strategy order (see AiAttackBehavior): a vengeful nation prioritises
 * retaliation and grudges (the engine's relations system), a turtle
 * hoards reserves, an aggressor picks on the weak early and often.
 */
import { PseudoRandom } from "../../PseudoRandom";

export type AiArchetype = "aggressive" | "turtle" | "opportunist" | "vengeful";

export interface AiPersonality {
  archetype: AiArchetype;
  triggerRatio: number;
  reserveRatio: number;
  expandRatio: number;
  /** Multiplier on the difficulty-based attack cadence (lower = faster). */
  attackRateMultiplier: number;
  /** Strategy names moved to the front of the difficulty order. */
  priorityStrategies: string[];
}

export function rollPersonality(random: PseudoRandom): AiPersonality {
  const archetype = (["aggressive", "turtle", "opportunist", "vengeful"] as const)[
    random.nextInt(0, 4)
  ];
  switch (archetype) {
    case "aggressive":
      return {
        archetype,
        triggerRatio: random.nextInt(40, 50) / 100,
        reserveRatio: random.nextInt(20, 28) / 100,
        expandRatio: random.nextInt(18, 25) / 100,
        attackRateMultiplier: 0.75,
        priorityStrategies: ["weakest", "victim"],
      };
    case "turtle":
      return {
        archetype,
        triggerRatio: random.nextInt(62, 72) / 100,
        reserveRatio: random.nextInt(45, 55) / 100,
        expandRatio: random.nextInt(8, 12) / 100,
        attackRateMultiplier: 1.3,
        priorityStrategies: ["retaliate"],
      };
    case "opportunist":
      return {
        archetype,
        triggerRatio: random.nextInt(50, 60) / 100,
        reserveRatio: random.nextInt(30, 38) / 100,
        expandRatio: random.nextInt(12, 18) / 100,
        attackRateMultiplier: 1,
        priorityStrategies: ["veryWeak", "afk", "victim"],
      };
    case "vengeful":
      return {
        archetype,
        triggerRatio: random.nextInt(50, 60) / 100,
        reserveRatio: random.nextInt(28, 36) / 100,
        expandRatio: random.nextInt(12, 18) / 100,
        attackRateMultiplier: 0.9,
        priorityStrategies: ["retaliate", "hated", "betray"],
      };
  }
}
