/**
 * Central branding configuration for this derivative project.
 *
 * This game is a modified derivative of OpenFront (https://openfront.io),
 * an AGPL-3.0 licensed project. It is NOT the official OpenFront service.
 * All user-facing branding must come from this file so the game can be
 * renamed by editing a single location.
 */
export const BRANDING = {
  /** Working title. Placeholder brand — rename here. */
  gameName: "Frontline Solo",
  /** Short tagline shown on the landing page. */
  tagline: "A solo territorial strategy game",
  /** Public URL of this derivative's source code (AGPL-3.0 requirement). */
  sourceCodeUrl: "https://github.com/joelbadcock127-eng/Openfront",
  /** Upstream project this game is derived from. */
  upstream: {
    name: "OpenFront",
    repoUrl: "https://github.com/openfrontio/OpenFrontIO",
    siteUrl: "https://openfront.io",
    /** Exact upstream commit this derivative is based on. */
    commit: "d76691372c3f0dd039aa53236b1bbd2f7eb64100",
  },
  license: "AGPL-3.0",
} as const;
