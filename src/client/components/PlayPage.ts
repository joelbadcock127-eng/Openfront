import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { BRANDING } from "../../core/configuration/Branding";
import { SinglePlayerModal } from "../SinglePlayerModal";
import { UsernameInput } from "../UsernameInput";

@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  private openSinglePlayerModal = () => {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput && !usernameInput.canPlay()) return;
    (
      document.querySelector("single-player-modal") as SinglePlayerModal
    )?.open();
  };

  render() {
    return html`
      <div
        id="page-play"
        class="flex flex-col gap-2 w-full px-0 lg:px-4 min-h-0"
      >
        <!-- Mobile: Fixed top bar -->
        <div
          class="lg:hidden fixed left-0 right-0 top-0 z-40 pt-[env(safe-area-inset-top)] bg-surface border-b border-white/10"
        >
          <div
            class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center h-14 px-2 gap-2"
          >
            <button
              id="hamburger-btn"
              class="col-start-1 justify-self-start h-10 shrink-0 aspect-[4/3] flex text-white/90 rounded-md items-center justify-center transition-colors"
              data-i18n-aria-label="main.menu"
              aria-expanded="false"
              aria-controls="sidebar-menu"
              aria-haspopup="dialog"
              data-i18n-title="main.menu"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="size-8"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>

            <div
              class="col-start-2 flex items-center justify-center min-w-0 text-white font-bold uppercase tracking-widest"
            >
              ${BRANDING.gameName}
            </div>

            <div
              aria-hidden="true"
              class="col-start-3 justify-self-end h-10 shrink-0 aspect-[4/3]"
            ></div>
          </div>
        </div>

        <div class="w-full pb-4 lg:pb-0 flex flex-col gap-4">
          <!-- Mobile: spacer for fixed top bar -->
          <div class="lg:hidden h-[calc(env(safe-area-inset-top)+56px)]"></div>

          <!-- Title / tagline -->
          <div class="flex flex-col items-center gap-1 pt-4 lg:pt-8">
            <h1
              class="text-3xl lg:text-5xl font-bold text-white uppercase tracking-widest text-center"
            >
              ${BRANDING.gameName}
            </h1>
            <p class="text-white/60 text-sm lg:text-base text-center">
              ${BRANDING.tagline}
            </p>
          </div>

          <!-- Username + flag -->
          <div
            class="px-2 py-2 bg-surface border-y border-white/10 overflow-visible lg:flex lg:items-center lg:gap-x-2 lg:h-[60px] lg:p-3 lg:relative lg:z-20 lg:border-y-0 lg:rounded-xl lg:max-w-2xl lg:w-full lg:mx-auto"
          >
            <div class="flex items-center gap-2 min-w-0 w-full">
              <username-input
                class="flex-1 min-w-0 h-10 lg:h-[50px]"
              ></username-input>
              <flag-input
                id="flag-input-desktop"
                show-select-label
                class="shrink-0 h-10 w-10 lg:h-[50px] lg:w-[50px]"
              ></flag-input>
            </div>
          </div>

          <!-- Solo play button -->
          <div class="px-4 lg:px-0 lg:max-w-2xl lg:w-full lg:mx-auto">
            <button
              id="solo-play-button"
              @click=${this.openSinglePlayerModal}
              class="relative flex items-center justify-center w-full h-16 lg:h-20 rounded-lg bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-y-105 hover:scale-x-[1.01] transition-all duration-200 text-lg lg:text-xl font-medium text-white uppercase tracking-wider text-center"
              data-i18n="main.solo"
            ></button>
          </div>

          <!-- Derivative notice -->
          <p class="text-center text-xs text-white/40 px-4">
            ${BRANDING.gameName} is a modified derivative of
            <a
              href=${BRANDING.upstream.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-white/70"
              >${BRANDING.upstream.name}</a
            >
            and is not the official ${BRANDING.upstream.name} service.
          </p>
        </div>
      </div>
    `;
  }
}
