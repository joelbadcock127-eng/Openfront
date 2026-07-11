import version from "resources/version.txt?raw";
import { EventBus } from "../core/EventBus";
import { GameRecord, GameStartInfo } from "../core/Schemas";
import { UserSettings } from "../core/game/UserSettings";
import { joinLobby, type JoinLobbyResult } from "./ClientGameRunner";
import "./FlagInput";
import { FlagInput } from "./FlagInput";
import "./FlagInputModal";
import { FlagInputModal } from "./FlagInputModal";
import { GameInfoModal } from "./GameInfoModal";
import { GameStartingModal } from "./GameStartingModal";
import { HelpModal } from "./HelpModal";
import { showInGameConfirm } from "./InGameModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { initLayout } from "./Layout";
import { modalRouter } from "./ModalRouter";
import { initNavigation } from "./Navigation";
import "./SinglePlayerModal";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { genAnonUsername, UsernameInput } from "./UsernameInput";
import { incrementGamesPlayed, translateText } from "./Utils";
import { installSafariPinchZoomBlocker } from "./utilities/DisableSafariPinchZoom";

import "./components/DesktopNavBar";
import "./components/Footer";
import "./components/MainLayout";
import "./components/MobileNavBar";
import "./components/PlayPage";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./styles.css";
import "./styles/core/typography.css";
import "./styles/core/variables.css";
import "./styles/layout/container.css";
import "./styles/layout/header.css";

declare global {
  interface Window {
    // Ads are permanently disabled in this solo derivative; some upstream
    // components still consult this flag before rendering ad slots.
    adsEnabled: boolean;
    currentPageId?: string;
    showPage?: (pageId: string) => void;
  }

  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    "join-changed": CustomEvent;
    "leave-lobby": CustomEvent;
  }
}

export interface JoinLobbyEvent {
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  source?: "singleplayer";
}

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  private eventBus: EventBus = new EventBus();

  private currentUrl: string | null = null;

  private usernameInput: UsernameInput | null = null;
  private flagInput: FlagInput | null = null;

  private userSettings: UserSettings = new UserSettings();
  private mostRecentJoinEvent: number;

  async initialize(): Promise<void> {
    // This derivative never shows ads.
    window.adsEnabled = false;

    // Register the solo-relevant modals with the URL router.
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
    modalRouter.register("help", { tag: "help-modal", pageId: "page-help" });
    modalRouter.register("language", {
      tag: "language-modal",
      pageId: "page-language",
    });
    modalRouter.register("single-player", {
      tag: "single-player-modal",
      pageId: "page-single-player",
    });
    modalRouter.register("troubleshooting", {
      tag: "troubleshooting-modal",
      pageId: "page-troubleshooting",
    });
    modalRouter.register("flag-input", { tag: "flag-input-modal" });

    // Wait for components to render before setting version
    await customElements.whenDefined("mobile-nav-bar");
    await customElements.whenDefined("desktop-nav-bar");

    const versionElements = document.querySelectorAll(
      "#game-version, .game-version-display",
    );
    const trimmed = version.trim();
    const displayVersion = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
    versionElements.forEach((el) => {
      el.textContent = displayVersion;
    });

    const langSelector = document.querySelector(
      "lang-selector",
    ) as LangSelector;
    if (!langSelector) {
      console.warn("Lang selector element not found");
    }

    this.flagInput = document.querySelector("flag-input") as FlagInput;
    this.usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!this.usernameInput) {
      console.warn("Username input element not found");
    }

    window.addEventListener("beforeunload", () => {
      if (this.lobbyHandle !== null) {
        this.lobbyHandle.stop(true);
      }
    });

    document.addEventListener("join-lobby", this.handleJoinLobby.bind(this));
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));

    const hlpModal = document.querySelector("help-modal") as HelpModal;
    if (!hlpModal || !(hlpModal instanceof HelpModal)) {
      console.warn("Help modal element not found");
    }
    const giModal = document.querySelector("game-info-modal") as GameInfoModal;
    if (!giModal || !(giModal instanceof GameInfoModal)) {
      console.warn("Game info modal element not found");
    }
    const helpButton = document.getElementById("help-button");
    if (helpButton) {
      helpButton.addEventListener("click", () => {
        if (hlpModal && hlpModal instanceof HelpModal) {
          hlpModal.open();
        }
      });
    }

    const flagInputModal = document.querySelector(
      "flag-input-modal",
    ) as FlagInputModal;

    // Attach listener to any flag-input component
    document.querySelectorAll("flag-input").forEach((flagInput) => {
      flagInput.addEventListener("flag-input-click", () => {
        if (flagInputModal && flagInputModal instanceof FlagInputModal) {
          flagInputModal.open();
        }
      });
    });

    const settingsModal = document.querySelector(
      "user-setting",
    ) as UserSettingModal;
    if (!settingsModal || !(settingsModal instanceof UserSettingModal)) {
      console.warn("User settings modal element not found");
    }
    document
      .getElementById("settings-button")
      ?.addEventListener("click", () => {
        if (settingsModal && settingsModal instanceof UserSettingModal) {
          settingsModal.open();
        }
      });

    // Route any deep link (e.g. #modal=single-player)
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.handleUrl());
    } else {
      this.handleUrl();
    }

    const onHashUpdate = () => {
      // Router-managed hash changes (#modal=...) are handled by the router
      // syncing in/out; we don't need to tear down the lobby state for them.
      if (modalRouter.isHashRouted()) {
        modalRouter.routeFromHash();
        return;
      }
      onJoinChanged();
    };

    const leaveGame = () => {
      // redirect to the home page
      window.location.href = "/";
    };

    const onPopState = () => {
      if (this.currentUrl !== null && this.lobbyHandle !== null) {
        console.info("Game is active");

        if (!this.lobbyHandle.stop()) {
          console.info("Player is active, ask before leaving game");

          // We can't block navigation on an async confirmation, so restore the
          // history entry immediately and only leave once the player confirms.
          history.pushState(null, "", this.currentUrl);
          showInGameConfirm(translateText("help_modal.exit_confirmation")).then(
            (isConfirmed) => {
              if (isConfirmed) leaveGame();
            },
          );
          return;
        }

        console.info("Player is not active, leave the game immediately");

        leaveGame();
      } else {
        console.info("Game not active, handle hash update");

        onHashUpdate();
      }
    };

    const onJoinChanged = () => {
      if (this.lobbyHandle !== null) {
        this.handleLeaveLobby();
      }
    };

    // Handle browser navigation & manual hash edits
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashUpdate);
    window.addEventListener("join-changed", onJoinChanged);
  }

  private async handleUrl() {
    const decodedHash = decodeURIComponent(window.location.hash);
    if (modalRouter.routeFromHash()) {
      return;
    }
    if (decodedHash.startsWith("#refresh")) {
      window.location.href = "/";
    }
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    this.mostRecentJoinEvent = event.timeStamp;
    if (this.usernameInput && !this.usernameInput.canPlay()) {
      return;
    }

    console.log(`starting solo game ${lobby.gameID}`);
    if (this.lobbyHandle !== null) {
      console.log("starting game, stopping existing game");
      this.lobbyHandle.stop(true);
      document.body.classList.remove("in-game");
    }
    const newLobbyHandle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: {},
      turnstileToken: null,
      playerName: this.usernameInput?.getUsername() ?? genAnonUsername(),
      playerClanTag: this.usernameInput?.getClanTag() ?? null,
      clanTagCheck: this.usernameInput?.getClanCheck(),
      playerRole: null,
      gameStartInfo: lobby.gameStartInfo ?? lobby.gameRecord?.info,
      gameRecord: lobby.gameRecord,
    });

    if (this.mostRecentJoinEvent !== event.timeStamp) {
      newLobbyHandle.stop(true);
      console.warn("Join requested, but was superseded");
      return;
    }

    this.lobbyHandle = newLobbyHandle;

    this.lobbyHandle.prestart.then(() => {
      console.log("Closing modals");
      document.getElementById("settings-button")?.classList.add("hidden");
      if (this.usernameInput) {
        // fix edge case where username-validation-error is re-rendered and hidden tag removed
        this.usernameInput.validationError = "";
      }
      document
        .getElementById("username-validation-error")
        ?.classList.add("hidden");
      [
        "single-player-modal",
        "game-starting-modal",
        "game-top-bar",
        "help-modal",
        "user-setting",
        "troubleshooting-modal",
        "language-modal",
        "flag-input-modal",
        "lang-selector",
      ].forEach((tag) => {
        const modal = document.querySelector(tag) as HTMLElement & {
          close?: () => void;
          isModalOpen?: boolean;
        };
        if (modal?.close) {
          modal.close();
        } else if (modal && "isModalOpen" in modal) {
          modal.isModalOpen = false;
        }
      });

      // show when the game loads
      const startingModal = document.querySelector(
        "game-starting-modal",
      ) as GameStartingModal;
      if (startingModal && startingModal instanceof GameStartingModal) {
        startingModal.show();
      }
    });

    this.lobbyHandle.join.then(() => {
      incrementGamesPlayed();
      document.body.classList.add("in-game");

      // Ensure there's a homepage entry in history before adding the game entry
      if (window.location.hash === "" || window.location.hash === "#") {
        history.replaceState(null, "", window.location.origin + "#refresh");
      }
      history.pushState(null, "", "/solo");

      // Store current URL for popstate confirmation
      this.currentUrl = window.location.href;
    });
  }

  private async handleLeaveLobby(_event?: CustomEvent) {
    if (this.lobbyHandle === null) {
      return;
    }
    console.log("leaving game");
    this.lobbyHandle.stop(true);
    this.lobbyHandle = null;
    this.currentUrl = null;

    try {
      history.replaceState(null, "", "/");
    } catch (e) {
      console.warn("Failed to restore URL on leave:", e);
    }

    document.body.classList.remove("in-game");
  }
}

// Initialize the client when the DOM is loaded
const bootstrap = () => {
  // Prevent Safari's page-level pinch-zoom, which ignores `user-scalable=no`
  // on iOS and can softlock the HUD. See issue #2330.
  installSafariPinchZoomBlocker();

  initLayout();
  new Client().initialize();
  initNavigation();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
