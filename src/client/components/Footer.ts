import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { BRANDING } from "../../core/configuration/Branding";

@customElement("page-footer")
export class Footer extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <footer
        class="[.in-game_&]:hidden bg-zinc-900/90 backdrop-blur-md flex flex-col items-center justify-center gap-1 pt-1 pb-3 text-white/50 w-full border-t border-white/10 shrink-0 relative z-50"
      >
        <div
          class="flex items-center justify-center gap-4 lg:gap-6 pt-2 w-full relative"
        >
          <a
            href=${BRANDING.sourceCodeUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs hover:text-white transition-colors underline"
          >
            Source code (${BRANDING.license})
          </a>
          <a
            href=${BRANDING.upstream.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs hover:text-white transition-colors underline"
          >
            Based on ${BRANDING.upstream.name}
          </a>
          <lang-selector
            class="absolute right-4 top-0 sm:top-[10px]"
          ></lang-selector>
        </div>
        <div
          class="text-xs mt-1 lg:mt-2 flex flex-col items-center justify-center gap-1 px-4 text-center"
        >
          <span>
            ${BRANDING.gameName} is a modified derivative of
            ${BRANDING.upstream.name} (© OpenFront™ and Contributors,
            ${BRANDING.license}). It is not affiliated with the official
            ${BRANDING.upstream.name} service.
          </span>
          <span>
            Map and asset attributions are listed in the repository's CREDITS.md
            and LICENSE-ASSETS files.
          </span>
        </div>
      </footer>
    `;
  }
}
