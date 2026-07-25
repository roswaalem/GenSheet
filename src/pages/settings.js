//! Page Réglages : couleur d'accent et densité de l'interface.
//! D'autres réglages (langue, dossier du jeu, compte) viendront brancher le
//! backend ; pour l'instant, seul l'habillage est configurable.

import { $ } from "../util.js";
import { ACCENTS, DENSITIES, applyTheme, loadTheme, saveTheme } from "../theme.js";

let theme = loadTheme();

export const settings = {
  render() {
    return `
      <div class="settings-grid">
        <div class="panel settings-group">
          <div class="block-title">Couleur d'accent</div>
          <div class="swatches" id="accent-choices">
            ${ACCENTS.map((a) => `
              <button class="swatch" data-accent="${a.key}" title="${a.label}"
                      style="--sw:${a.hex}"><span></span>${a.label}</button>`).join("")}
          </div>
        </div>

        <div class="panel settings-group">
          <div class="block-title">Densité</div>
          <div class="segmented" id="density-choices">
            ${DENSITIES.map((d) => `<button class="seg" data-density="${d.key}">${d.label}</button>`).join("")}
          </div>
        </div>
      </div>

      <div class="panel settings-note muted">
        Gensheet est un outil non officiel, sans affiliation à HoYoverse.
        Les autres réglages (langue, dossier du jeu, déconnexion) arriveront
        avec le branchement du backend.
      </div>`;
  },

  init() {
    $("#accent-choices").addEventListener("click", (e) => {
      const b = e.target.closest("[data-accent]");
      if (b) update({ accent: b.dataset.accent });
    });
    $("#density-choices").addEventListener("click", (e) => {
      const b = e.target.closest("[data-density]");
      if (b) update({ density: b.dataset.density });
    });
    markActive();
  },
};

function update(change) {
  theme = { ...theme, ...change };
  saveTheme(theme);
  applyTheme(theme);
  markActive();
}

function markActive() {
  document.querySelectorAll("#accent-choices .swatch")
    .forEach((s) => s.classList.toggle("active", s.dataset.accent === theme.accent));
  document.querySelectorAll("#density-choices .seg")
    .forEach((s) => s.classList.toggle("active", s.dataset.density === theme.density));
}
