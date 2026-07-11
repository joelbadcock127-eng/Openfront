import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { soloMaps } from "../../../core/configuration/SoloMaps";
import { Difficulty, GameMapType, MapInfo } from "../../../core/game/Game";
import { translateText } from "../../Utils";
import "./MapDisplay";

/**
 * Solo map picker: renders the maps enabled in SoloMaps.ts as a simple
 * grid. The upstream tabbed browser (featured/all/favorites/search/random)
 * was removed along with the multiplayer map catalogue — this derivative
 * ships a single polished map, and additional maps enabled later appear in
 * this grid automatically.
 */
@customElement("map-picker")
export class MapPicker extends LitElement {
  @property({ type: String }) selectedMap: GameMapType = soloMaps[0].type;
  @property({ type: Boolean }) useRandomMap = false;
  @property({ type: Boolean }) showMedals = false;
  @property({ type: Boolean }) randomMapDivider = false;
  @property({ type: String }) searchQuery = "";
  @property({ attribute: false }) mapWins: Map<GameMapType, Set<Difficulty>> =
    new Map();
  @property({ attribute: false }) onSelectMap?: (map: GameMapType) => void;
  @property({ attribute: false }) onSelectRandom?: () => void;

  createRenderRoot() {
    return this;
  }

  private handleMapSelection(mapValue: GameMapType) {
    this.onSelectMap?.(mapValue);
  }

  private renderMapCard(map: MapInfo) {
    return html`
      <div
        @click=${() => this.handleMapSelection(map.type)}
        class="cursor-pointer"
      >
        <map-display
          .mapKey=${map.id}
          .selected=${!this.useRandomMap && this.selectedMap === map.type}
          .translation=${translateText(map.translationKey)}
        ></map-display>
      </div>
    `;
  }

  render() {
    return html`
      <div class="space-y-8">
        <div class="w-full">
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            ${repeat(
              soloMaps,
              (map) => map.id,
              (map) => this.renderMapCard(map),
            )}
          </div>
        </div>
      </div>
    `;
  }
}
