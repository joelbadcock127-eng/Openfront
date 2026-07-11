/**
 * Post-build step for a fully static (server-less) deploy.
 *
 * The production `vite build` leaves `static/index.html` as an EJS template
 * whose placeholders are normally filled per-request by the Node game server
 * (see src/server/RenderHtml.ts). A static host (Vercel, Netlify, GitHub
 * Pages, S3, …) serves the file as-is, so the template must be rendered at
 * build time instead.
 *
 * This script renders `static/index.html` in place, mirroring RenderHtml.ts
 * but with static values: no CDN (assets stay root-relative), a single
 * simulated worker (the solo game runs entirely client-side via LocalServer),
 * and no Turnstile. It reads the same `static/asset-manifest.json` the server
 * reads at runtime, so asset hashing stays consistent with the build.
 */
import ejs from "ejs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildAssetUrl, type AssetManifest } from "../src/core/AssetUrls";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, "..", "static");
const htmlPath = path.join(staticDir, "index.html");
const manifestPath = path.join(staticDir, "asset-manifest.json");

function loadManifest(): AssetManifest {
  if (!fs.existsSync(manifestPath)) {
    // A production build always writes this; its absence means the caller ran
    // this before `vite build`.
    throw new Error(
      `Missing ${manifestPath}. Run the production build first (npm run build-prod).`,
    );
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as AssetManifest;
}

function main(): void {
  const manifest = loadManifest();
  const template = fs.readFileSync(htmlPath, "utf8");

  // Vercel/CI expose the commit SHA; fall back to a stable label so the
  // rendered file is deterministic in local builds.
  const gitCommit =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? "static";
  // Empty CDN base: bundle refs (/assets/…) and public assets (/_assets/…)
  // are served from the deploy root.
  const cdnBase = "";
  // Auth is guest-only in the solo build; this is only used to derive URLs
  // that are never fetched offline.
  const jwtAudience = process.env.DOMAIN ?? "localhost";

  const rendered = ejs.render(template, {
    gitCommit: JSON.stringify(gitCommit),
    assetManifest: JSON.stringify(manifest),
    cdnBase: JSON.stringify(cdnBase),
    // Raw (unquoted) value used to prefix Vite's /assets/ refs in the
    // template. Empty → root-relative, correct for a static host.
    cdnBaseRaw: cdnBase,
    gameEnv: JSON.stringify("prod"),
    // The solo simulation runs in-browser; a single "worker" keeps
    // ClientEnv.workerIndex()/gameCreationRate() well-defined.
    numWorkers: JSON.stringify(1),
    turnstileSiteKey: JSON.stringify(""),
    jwtAudience: JSON.stringify(jwtAudience),
    instanceId: JSON.stringify("static"),
    manifestHref: buildAssetUrl("manifest.json", manifest, cdnBase),
    faviconHref: buildAssetUrl(
      "images/FrontlineFavicon.svg",
      manifest,
      cdnBase,
    ),
    backgroundImageUrl: buildAssetUrl(
      "images/background.webp",
      manifest,
      cdnBase,
    ),
  });

  if (rendered.includes("<%")) {
    // Guard against a placeholder the render forgot — that would ship broken
    // JS to the browser.
    throw new Error(
      "Rendered index.html still contains unresolved EJS placeholders",
    );
  }

  fs.writeFileSync(htmlPath, rendered);
  console.log(`Rendered static ${htmlPath} (commit ${gitCommit})`);
}

main();
