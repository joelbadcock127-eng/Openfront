import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { Scenario, SCENARIOS } from "../core/configuration/Scenarios";
import { DEFAULT_SOLO_MAP } from "../core/configuration/SoloMaps";
import { DoomsdayClockSpeed } from "../core/game/DoomsdayClock";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../core/game/Game";
import { generateID } from "../core/Util";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/GameConfigSettings";
import "./components/ToggleInputCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import {
  getBotsForCompactMap,
  getNationsForCompactMap,
  getUpdatedDisabledUnits,
  parseBoundedFloatFromInput,
  parseBoundedIntegerFromInput,
  preventDisallowedKeys,
  sliderToNationsConfig,
  toOptionalNumber,
} from "./utilities/GameConfigHelpers";

import { terrainMapFileLoader } from "./TerrainMapFileLoader";

const DEFAULT_OPTIONS = {
  selectedMap: DEFAULT_SOLO_MAP,
  selectedDifficulty: Difficulty.Easy,
  bots: 400,
  infiniteGold: false,
  infiniteTroops: false,
  compactMap: false,
  maxTimer: false,
  maxTimerValue: undefined as number | undefined,
  instantBuild: false,
  randomSpawn: false,
  goldMultiplier: false,
  goldMultiplierValue: undefined as number | undefined,
  startingGold: false,
  startingGoldValue: undefined as number | undefined,
  disabledUnits: [] as UnitType[],
  customAlliances: false,
  customAllianceMinutes: undefined as number | undefined,
  waterNukes: false,
  doomsdayClock: false,
  doomsdayClockSpeed: "normal" as DoomsdayClockSpeed,
} as const;

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
  protected routerName = "single-player";

  @state() private selectedMap: GameMapType = DEFAULT_OPTIONS.selectedMap;
  @state() private selectedDifficulty: Difficulty =
    DEFAULT_OPTIONS.selectedDifficulty;
  @state() private nations: number = 0;
  @state() private defaultNationCount: number = 0;
  @state() private bots: number = DEFAULT_OPTIONS.bots;
  @state() private infiniteGold: boolean = DEFAULT_OPTIONS.infiniteGold;
  @state() private infiniteTroops: boolean = DEFAULT_OPTIONS.infiniteTroops;
  @state() private compactMap: boolean = DEFAULT_OPTIONS.compactMap;
  @state() private maxTimer: boolean = DEFAULT_OPTIONS.maxTimer;
  @state() private maxTimerValue: number | undefined =
    DEFAULT_OPTIONS.maxTimerValue;
  @state() private instantBuild: boolean = DEFAULT_OPTIONS.instantBuild;
  @state() private weatherEnabled: boolean = true;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: number = 2;
  @state() private selectedScenario: string | null = null;
  @state() private empireTitle: string = "";
  @state() private empireColor: string | null = null;
  @state() private victoryEconomic: boolean = false;
  @state() private victoryStraits: boolean = false;
  @state() private randomSpawn: boolean = DEFAULT_OPTIONS.randomSpawn;
  @state() private goldMultiplier: boolean = DEFAULT_OPTIONS.goldMultiplier;
  @state() private goldMultiplierValue: number | undefined =
    DEFAULT_OPTIONS.goldMultiplierValue;
  @state() private startingGold: boolean = DEFAULT_OPTIONS.startingGold;
  @state() private startingGoldValue: number | undefined =
    DEFAULT_OPTIONS.startingGoldValue;

  @state() private disabledUnits: UnitType[] = [
    ...DEFAULT_OPTIONS.disabledUnits,
  ];
  @state() private customAlliances: boolean = DEFAULT_OPTIONS.customAlliances;
  @state() private customAllianceMinutes: number | undefined =
    DEFAULT_OPTIONS.customAllianceMinutes;
  @state() private waterNukes: boolean = DEFAULT_OPTIONS.waterNukes;
  @state() private doomsdayClock: boolean = DEFAULT_OPTIONS.doomsdayClock;
  @state() private doomsdayClockSpeed: DoomsdayClockSpeed =
    DEFAULT_OPTIONS.doomsdayClockSpeed;

  private mapLoader = terrainMapFileLoader;

  connectedCallback() {
    super.connectedCallback();
    void this.loadNationCount();
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("main.solo") || "Solo",
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private static readonly EMPIRE_TITLES = [
    "empire",
    "republic",
    "kingdom",
    "commonwealth",
    "federation",
    "free_state",
  ];

  private static readonly EMPIRE_COLORS = [
    "#e11d48",
    "#f97316",
    "#facc15",
    "#22c55e",
    "#14b8a6",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
  ];

  private applyScenario(scenario: Scenario): void {
    this.selectedScenario = scenario.id;
    this.selectedMap = scenario.map;
    this.selectedDifficulty = scenario.difficulty;
    this.bots = scenario.bots;
    this.weatherEnabled = scenario.weatherEnabled;
    this.victoryEconomic = scenario.victoryCondition === "economic";
    this.victoryStraits = scenario.victoryCondition === "straits";
    void this.loadNationCount();
  }

  /** Compose the empire display name (schema caps usernames at 27 chars). */
  private empireName(base: string): string {
    if (this.empireTitle === "") return base;
    const title = translateText(`identity.title_${this.empireTitle}`);
    return `${title} ${base}`.slice(0, 27).trim();
  }

  private renderIdentityAndScenarios() {
    return html`
      <div class="space-y-4 mb-6">
        <div>
          <div class="text-sm font-semibold text-white/80 pb-2">
            ${translateText("single_modal.scenarios_title")}
          </div>
          <div class="flex flex-wrap gap-2">
            ${SCENARIOS.map(
              (sc) => html`
                <button
                  class="px-3 py-1.5 rounded-lg text-xs border transition-colors ${this
                    .selectedScenario === sc.id
                    ? "bg-blue-600 border-blue-400 text-white"
                    : "bg-white/5 border-white/15 text-white/80 hover:bg-white/10"}"
                  title=${translateText(`scenario.${sc.id}_desc`)}
                  @click=${() => this.applyScenario(sc)}
                >
                  ${translateText(`scenario.${sc.id}`)}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <div>
            <div class="text-sm font-semibold text-white/80 pb-2">
              ${translateText("identity.title_label")}
            </div>
            <select
              class="bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white"
              .value=${this.empireTitle}
              @change=${(e: Event) => {
                this.empireTitle = (e.target as HTMLSelectElement).value;
              }}
            >
              <option value="">${translateText("identity.title_none")}</option>
              ${SinglePlayerModal.EMPIRE_TITLES.map(
                (t) => html`
                  <option value=${t} ?selected=${this.empireTitle === t}>
                    ${translateText(`identity.title_${t}`)}
                  </option>
                `,
              )}
            </select>
          </div>
          <div>
            <div class="text-sm font-semibold text-white/80 pb-2">
              ${translateText("identity.color_label")}
            </div>
            <div class="flex gap-1.5 items-center">
              <button
                class="w-6 h-6 rounded-full border text-[9px] leading-none ${this
                  .empireColor === null
                  ? "border-white ring-2 ring-white/60"
                  : "border-white/30"} bg-white/10 text-white/70"
                title=${translateText("identity.color_auto")}
                @click=${() => {
                  this.empireColor = null;
                }}
              >
                A
              </button>
              ${SinglePlayerModal.EMPIRE_COLORS.map(
                (c) => html`
                  <button
                    class="w-6 h-6 rounded-full border ${this.empireColor === c
                      ? "border-white ring-2 ring-white/60"
                      : "border-white/30"}"
                    style="background:${c}"
                    @click=${() => {
                      this.empireColor = c;
                    }}
                  ></button>
                `,
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  protected renderBody() {
    const inputCards = [
      html`<toggle-input-card
        .labelKey=${"single_modal.max_timer"}
        .checked=${this.maxTimer}
        .inputId=${"end-timer-value"}
        .inputMin=${1}
        .inputMax=${120}
        .inputValue=${this.maxTimerValue}
        .inputAriaLabel=${translateText("single_modal.max_timer")}
        .inputPlaceholder=${translateText("single_modal.max_timer_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleMaxTimerToggle}
        .onInput=${this.handleMaxTimerValueChanges}
        .onKeyDown=${this.handleMaxTimerValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"single_modal.gold_multiplier"}
        .checked=${this.goldMultiplier}
        .inputId=${"gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.goldMultiplierValue}
        .inputAriaLabel=${translateText("single_modal.gold_multiplier")}
        .inputPlaceholder=${translateText(
          "single_modal.gold_multiplier_placeholder",
        )}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleGoldMultiplierToggle}
        .onChange=${this.handleGoldMultiplierValueChanges}
        .onKeyDown=${this.handleGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"single_modal.starting_gold"}
        .checked=${this.startingGold}
        .inputId=${"starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.startingGoldValue}
        .inputAriaLabel=${translateText("single_modal.starting_gold")}
        .inputPlaceholder=${translateText(
          "single_modal.starting_gold_placeholder",
        )}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleStartingGoldToggle}
        .onChange=${this.handleStartingGoldValueChanges}
        .onKeyDown=${this.handleStartingGoldValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"single_modal.custom_alliances"}
        .checked=${this.customAlliances}
        .inputMin=${0}
        .inputMax=${15}
        .inputStep=${1}
        .inputValue=${this.customAllianceMinutes}
        .inputAriaLabel=${translateText("single_modal.custom_alliances")}
        .inputPlaceholder=${translateText("single_modal.mins_placeholder")}
        .defaultInputValue=${0}
        .minValidOnEnable=${0}
        .zeroLabel=${`(${translateText("public_game_modifier.disable_alliances")})`}
        .onToggle=${this.handleCustomAlliancesToggle}
        .onInput=${this.handleCustomAllianceMinutesInput}
        .onKeyDown=${this.handleCustomAllianceMinutesKeyDown}
      ></toggle-input-card>`,
    ];

    return html`
      <div class="flex flex-col h-full">
        <div
          class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pt-4 pb-6 mr-1 mx-auto w-full max-w-5xl"
        >
          ${this.renderIdentityAndScenarios()}
          <game-config-settings
            class="block"
            .sectionGapClass=${"space-y-6"}
            .settings=${{
              map: {
                selected: this.selectedMap,
                useRandom: false,
              },
              difficulty: {
                selected: this.selectedDifficulty,
                disabled: this.nations === 0,
              },
              gameMode: {
                selected: this.gameMode,
              },
              teamCount: {
                selected: this.teamCount,
              },
              options: {
                titleKey: "single_modal.options_title",
                bots: {
                  value: this.bots,
                  labelKey: "single_modal.bots",
                  disabledKey: "single_modal.bots_disabled",
                },
                nations: {
                  value: this.nations,
                  defaultValue: this.defaultNationCount,
                  labelKey: "single_modal.nations",
                  disabledKey: "single_modal.nations_disabled",
                },
                toggles: [
                  {
                    labelKey: "single_modal.instant_build",
                    checked: this.instantBuild,
                  },
                  {
                    labelKey: "single_modal.random_spawn",
                    checked: this.randomSpawn,
                  },
                  {
                    labelKey: "single_modal.infinite_gold",
                    checked: this.infiniteGold,
                  },
                  {
                    labelKey: "single_modal.infinite_troops",
                    checked: this.infiniteTroops,
                  },
                  {
                    labelKey: "single_modal.compact_map",
                    checked: this.compactMap,
                  },
                  {
                    labelKey: "single_modal.weather",
                    checked: this.weatherEnabled,
                  },
                  {
                    labelKey: "single_modal.victory_economic",
                    checked: this.victoryEconomic,
                  },
                  {
                    labelKey: "single_modal.victory_straits",
                    checked: this.victoryStraits,
                  },
                  {
                    labelKey: "single_modal.water_nukes",
                    checked: this.waterNukes,
                  },
                  {
                    labelKey: "single_modal.doomsday_clock",
                    checked: this.doomsdayClock,
                    doomsdayClockSpeed: this.doomsdayClockSpeed,
                  },
                ],
                inputCards,
              },
              unitTypes: {
                titleKey: "single_modal.enables_title",
                disabledUnits: this.disabledUnits,
              },
            }}
            @map-selected=${this.handleConfigMapSelected}
            @difficulty-selected=${this.handleConfigDifficultySelected}
            @game-mode-selected=${this.handleConfigGameModeSelected}
            @team-count-selected=${this.handleConfigTeamCountSelected}
            @doomsday-clock-speed-selected=${this
              .handleConfigDoomsdayClockSpeedSelected}
            @bots-changed=${this.handleBotsChange}
            @nations-changed=${this.handleNationsChange}
            @option-toggle-changed=${this.handleConfigOptionToggleChanged}
            @unit-toggle-changed=${this.handleConfigUnitToggleChanged}
          ></game-config-settings>
        </div>

        <!-- Footer Action -->
        <div class="p-6 border-t border-white/10 bg-black/20 shrink-0">
          <o-button
            variant="primary"
            width="block"
            size="lg"
            translationKey="single_modal.start"
            @click=${this.startGame}
          ></o-button>
        </div>
      </div>
    `;
  }

  protected onClose(): void {
    // Reset all transient form state to ensure clean slate
    this.selectedMap = DEFAULT_OPTIONS.selectedMap;
    this.selectedDifficulty = DEFAULT_OPTIONS.selectedDifficulty;
    this.selectedScenario = null;
    this.empireTitle = "";
    this.empireColor = null;
    this.bots = DEFAULT_OPTIONS.bots;
    this.nations = 0;
    this.defaultNationCount = 0;
    this.infiniteGold = DEFAULT_OPTIONS.infiniteGold;
    this.infiniteTroops = DEFAULT_OPTIONS.infiniteTroops;
    this.compactMap = DEFAULT_OPTIONS.compactMap;
    this.maxTimer = DEFAULT_OPTIONS.maxTimer;
    this.maxTimerValue = DEFAULT_OPTIONS.maxTimerValue;
    this.instantBuild = DEFAULT_OPTIONS.instantBuild;
    this.randomSpawn = DEFAULT_OPTIONS.randomSpawn;
    this.disabledUnits = [...DEFAULT_OPTIONS.disabledUnits];
    this.goldMultiplier = DEFAULT_OPTIONS.goldMultiplier;
    this.goldMultiplierValue = DEFAULT_OPTIONS.goldMultiplierValue;
    this.startingGold = DEFAULT_OPTIONS.startingGold;
    this.startingGoldValue = DEFAULT_OPTIONS.startingGoldValue;
    this.customAlliances = DEFAULT_OPTIONS.customAlliances;
    this.customAllianceMinutes = DEFAULT_OPTIONS.customAllianceMinutes;
    this.waterNukes = DEFAULT_OPTIONS.waterNukes;
    this.doomsdayClock = DEFAULT_OPTIONS.doomsdayClock;
    this.doomsdayClockSpeed = DEFAULT_OPTIONS.doomsdayClockSpeed;
  }

  protected onOpen(): void {
    void this.loadNationCount();
  }

  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    void this.loadNationCount();
  }

  private handleConfigMapSelected = (e: Event) => {
    this.selectedScenario = null;
    const customEvent = e as CustomEvent<{ map: GameMapType }>;
    this.handleMapSelection(customEvent.detail.map);
  };

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  private handleConfigDifficultySelected = (e: Event) => {
    this.selectedScenario = null;
    const customEvent = e as CustomEvent<{ difficulty: Difficulty }>;
    this.handleDifficultySelection(customEvent.detail.difficulty);
  };

  private handleConfigGameModeSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ mode: GameMode }>;
    this.gameMode = customEvent.detail.mode;
  };

  private handleConfigTeamCountSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ count: number }>;
    this.teamCount = customEvent.detail.count;
  };

  private handleConfigDoomsdayClockSpeedSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ speed: DoomsdayClockSpeed }>;
    this.doomsdayClockSpeed = customEvent.detail.speed;
  };

  private handleCompactMapChange(val: boolean) {
    this.compactMap = val;
    this.bots = getBotsForCompactMap(this.bots, val);
    this.nations = getNationsForCompactMap(
      this.nations,
      this.defaultNationCount,
      val,
    );
  }

  private handleConfigOptionToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "single_modal.instant_build":
        this.instantBuild = checked;
        break;
      case "single_modal.random_spawn":
        this.randomSpawn = checked;
        break;
      case "single_modal.infinite_gold":
        this.infiniteGold = checked;
        break;
      case "single_modal.infinite_troops":
        this.infiniteTroops = checked;
        break;
      case "single_modal.compact_map":
        this.handleCompactMapChange(checked);
        break;
      case "single_modal.weather":
        this.weatherEnabled = checked;
        break;
      case "single_modal.victory_economic":
        this.victoryEconomic = checked;
        if (checked) this.victoryStraits = false;
        break;
      case "single_modal.victory_straits":
        this.victoryStraits = checked;
        if (checked) this.victoryEconomic = false;
        break;
      case "single_modal.water_nukes":
        this.waterNukes = checked;
        break;
      case "single_modal.doomsday_clock":
        this.doomsdayClock = checked;
        break;
      default:
        break;
    }
  };

  private handleConfigUnitToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{ unit: UnitType; checked: boolean }>;
    const { unit, checked } = customEvent.detail;
    this.disabledUnits = getUpdatedDisabledUnits(
      this.disabledUnits,
      unit,
      checked,
    );
  };

  private handleBotsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  };

  private handleNationsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.nations = value;
  };

  private handleMaxTimerToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.maxTimer = checked;
    this.maxTimerValue = toOptionalNumber(value);
  };

  private handleGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.goldMultiplier = checked;
    this.goldMultiplierValue = toOptionalNumber(value);
  };

  private handleStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.startingGold = checked;
    this.startingGoldValue = toOptionalNumber(value);
  };

  private handleCustomAlliancesToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.customAlliances = checked;
    this.customAllianceMinutes = toOptionalNumber(value);
  };

  private handleCustomAllianceMinutesKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleCustomAllianceMinutesInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, { min: 0, max: 15 });
    if (value === undefined) {
      return;
    }
    this.customAllianceMinutes = value;
  };

  private handleMaxTimerValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private getEndTimerInput(): HTMLInputElement | null {
    return (
      (this.renderRoot.querySelector(
        "#end-timer-value",
      ) as HTMLInputElement | null) ??
      (this.querySelector("#end-timer-value") as HTMLInputElement | null)
    );
  }

  private handleMaxTimerValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });

    this.maxTimerValue = value;
  };

  private handleGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
  };

  private handleStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.startingGoldValue = undefined;
      input.value = "";
    } else {
      this.startingGoldValue = value;
    }
  };

  private async startGame() {
    // Validate and clamp maxTimer setting before starting
    let finalMaxTimerValue: number | undefined = undefined;
    if (this.maxTimer) {
      if (!this.maxTimerValue || this.maxTimerValue <= 0) {
        console.error("Max timer is enabled but no valid value is set");
        alert(
          translateText("single_modal.max_timer_invalid") ||
            "Please enter a valid max timer value (1-120 minutes)",
        );
        // Focus the input
        const input = this.getEndTimerInput();
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      // Clamp value to valid range
      finalMaxTimerValue = Math.max(1, Math.min(120, this.maxTimerValue));
    }

    console.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: gameID,
          gameStartInfo: {
            gameID: gameID,
            players: [
              {
                clientID,
                username: this.empireName(usernameInput.getUsername()),
                clanTag: usernameInput.getClanTag() ?? null,
                cosmetics: this.empireColor
                  ? { color: { color: this.empireColor } }
                  : {},
              },
            ],
            config: {
              gameMap: this.selectedMap,
              gameMapSize: this.compactMap
                ? GameMapSize.Compact
                : GameMapSize.Normal,
              gameType: GameType.Singleplayer,
              gameMode: this.gameMode,
              playerTeams: this.teamCount,
              difficulty: this.selectedDifficulty,
              maxTimerValue: finalMaxTimerValue,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              donateGold: false,
              donateTroops: false,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              weatherEnabled: this.weatherEnabled,
              victoryCondition: this.victoryEconomic
                ? ("economic" as const)
                : this.victoryStraits
                  ? ("straits" as const)
                  : ("domination" as const),
              randomSpawn: this.randomSpawn,
              disabledUnits: this.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
              nations: sliderToNationsConfig(
                this.nations,
                this.defaultNationCount,
              ),
              ...(this.goldMultiplier && this.goldMultiplierValue
                ? { goldMultiplier: this.goldMultiplierValue }
                : {}),
              ...(this.startingGold && this.startingGoldValue !== undefined
                ? {
                    startingGold: Math.round(
                      this.startingGoldValue * 1_000_000,
                    ),
                  }
                : {}),
              ...(this.customAlliances
                ? { customAllianceDuration: this.customAllianceMinutes ?? 0 }
                : {}),
              ...(this.waterNukes ? { waterNukes: true } : {}),
              ...(this.doomsdayClock
                ? {
                    doomsdayClock: {
                      enabled: true,
                      speed: this.doomsdayClockSpeed,
                    },
                  }
                : {}),
            },
            lobbyCreatedAt: Date.now(),
          },
          source: "singleplayer",
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  private async loadNationCount() {
    const currentMap = this.selectedMap;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      // Only update if the map hasn't changed
      if (this.selectedMap === currentMap) {
        this.defaultNationCount = manifest.nations.length;
        this.nations = this.compactMap
          ? Math.max(0, Math.floor(manifest.nations.length * 0.25))
          : manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      // Leave existing values unchanged so the UI stays consistent
    }
  }
}
