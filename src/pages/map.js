//! Page Carte interactive : fond Teyvat/sous-mondes (pyramide de tuiles v2
//! HoYoLAB) via Leaflet, filtres par catégorie et suivi de complétion. Les
//! données viennent du backend (`map_*`), qui proxy et cache l'API HoYoLAB.
//!
//! Leaflet a besoin d'un conteneur visible : la carte est construite au premier
//! `onShow()`, pas au démarrage.

import { invoke, $, esc } from "../util.js";

const TILE_BASE = "https://act-webstatic.hoyoverse.com/map_manage/map";

let mapId = 2; // Teyvat par défaut ; changé par le sélecteur de sous-monde.
let rootEl = null;
let lmap = null;
let info = null;
const collected = new Set();
const layers = new Map(); // labelId → L.LayerGroup
const labelIndex = new Map(); // labelId → { name, icon }
let hideCollected = false;

export const map = {
  render() {
    return `
      <div class="map-view">
        <aside class="map-sidebar">
          <div class="map-tools">
            <select class="map-sel" id="map-select"></select>
            <label class="map-check"><input type="checkbox" id="map-hide" /> Masquer les récupérés</label>
            <span class="muted" id="map-count"></span>
            <div class="map-io">
              <button class="btn-ghost sm" id="map-export" type="button">Exporter</button>
              <button class="btn-ghost sm" id="map-import" type="button">Importer</button>
              <input type="file" id="map-file" accept="application/json,.json" hidden />
            </div>
          </div>
          <div class="map-cats" id="map-cats"><p class="muted">Chargement des catégories…</p></div>
        </aside>
        <div class="map-canvas" id="map-canvas"></div>
        <button class="map-fs" id="map-fs" type="button" title="Plein écran">⛶</button>
      </div>`;
  },

  init(el) {
    rootEl = el;
    loadMapList();
    loadCategories();
    el.querySelector("#map-cats").addEventListener("change", (e) => {
      const cb = e.target.closest("input[data-label]");
      if (cb) toggleCategory(Number(cb.dataset.label), cb.checked);
    });
    el.querySelector("#map-cats").addEventListener("click", (e) => {
      const head = e.target.closest(".map-group-head");
      if (head) head.parentElement.classList.toggle("open");
    });
    el.querySelector("#map-hide").addEventListener("change", (e) => {
      hideCollected = e.target.checked;
      redrawAll();
    });
    el.querySelector("#map-select").addEventListener("change", (e) => switchMap(Number(e.target.value)));
    el.querySelector("#map-fs").addEventListener("click", () => toggleFullscreen(el));
    el.querySelector("#map-export").addEventListener("click", exportProgress);
    el.querySelector("#map-import").addEventListener("click", () => el.querySelector("#map-file").click());
    el.querySelector("#map-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importProgress(file);
      e.target.value = ""; // permet de réimporter le même fichier
    });
    // Échap quitte le plein écran.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && el.querySelector(".map-view.fullscreen")) toggleFullscreen(el);
    });
  },

  // Appelé par main.js à l'affichage de l'onglet : construit la carte une fois.
  async onShow() {
    if (lmap) { lmap.invalidateSize(); return; }
    await buildMap();
  },
};

async function loadMapList() {
  try {
    const maps = await invoke("map_list");
    $("#map-select").innerHTML = maps
      .map((m) => `<option value="${m.id}" ${m.id === mapId ? "selected" : ""}>${esc(m.name)}</option>`)
      .join("");
  } catch { /* un seul monde si la liste échoue */ }
}

async function loadCategories() {
  const box = $("#map-cats");
  box.innerHTML = `<p class="muted">Chargement des catégories…</p>`;
  labelIndex.clear();
  try {
    const tree = await invoke("map_labels", { mapId });
    box.innerHTML = tree.map(groupHtml).join("") || `<p class="muted">Aucune catégorie.</p>`;
    for (const g of tree) for (const c of g.children || []) labelIndex.set(c.id, { name: c.name, icon: c.icon });
  } catch (e) {
    box.innerHTML = `<p class="muted">Catégories indisponibles (${esc(String(e))}).</p>`;
  }
}

const groupHtml = (g) => `
  <div class="map-group">
    <button class="map-group-head" type="button">${esc(g.name)}</button>
    <div class="map-group-body">
      ${(g.children || []).map((c) => `
        <label class="map-cat">
          <input type="checkbox" data-label="${c.id}" />
          ${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy" />` : ""}
          <span>${esc(c.name)}</span>
        </label>`).join("")}
    </div>
  </div>`;

async function buildMap() {
  const canvas = document.getElementById("map-canvas");
  if (lmap) { lmap.remove(); lmap = null; } else { canvas.innerHTML = ""; }
  try {
    info = await invoke("map_info", { mapId });
  } catch (e) {
    canvas.innerHTML = `<p class="muted map-error">Fond de carte indisponible (${esc(String(e))}).</p>`;
    return;
  }
  const [w, h] = info.total_size;
  const bounds = [[0, 0], [-h, w]];
  // Le niveau le plus fin réellement servi est N1, pas N0 (absent) → le natif est
  // à max_zoom-1. Au-delà, on laisse un cran de sur-zoom (tuiles agrandies).
  const maxNative = info.max_zoom - 1;
  const maxView = info.max_zoom + 1;

  lmap = L.map(canvas, {
    crs: L.CRS.Simple, minZoom: info.min_zoom, maxZoom: maxView,
    zoomControl: true, attributionControl: false,
  });

  // Pyramide v2 : .../{map_id}/{map_version}/{x}_{y}_N{k}.webp, k = -zoom Leaflet
  // (N1 = plus détaillé, N4 = plus large). Le minZoom de la couche doit être
  // négatif, sinon Leaflet ignore les zooms < 0 et ne charge aucune tuile.
  const Tiles = L.TileLayer.extend({
    getTileUrl(c) { return `${TILE_BASE}/${mapId}/${info.map_version}/${c.x}_${c.y}_N${-c.z}.webp`; },
  });
  new Tiles("", {
    tileSize: 256, bounds,
    minZoom: info.min_zoom, maxZoom: maxView,
    minNativeZoom: info.min_zoom, maxNativeZoom: maxNative,
  }).addTo(lmap);
  lmap.fitBounds(bounds);

  collected.clear();
  try { (await invoke("map_collected", { mapId })).forEach((id) => collected.add(id)); } catch { /* suivi vide */ }
  updateCount();
}

// Sauvegarde toute la progression (tous les mondes) en fichier JSON.
async function exportProgress() {
  try {
    const json = await invoke("map_export");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = "gensheet-carte.json";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.warn("export", e);
  }
}

// Fusionne une progression importée puis rafraîchit l'affichage du monde courant.
async function importProgress(file) {
  try {
    await invoke("map_import", { data: await file.text() });
    collected.clear();
    (await invoke("map_collected", { mapId })).forEach((id) => collected.add(id));
    updateCount();
    redrawAll();
  } catch (e) {
    console.warn("import", e);
  }
}

function toggleFullscreen(el) {
  const view = el.querySelector(".map-view");
  const on = view.classList.toggle("fullscreen");
  el.querySelector("#map-fs").textContent = on ? "✕" : "⛶";
  // Leaflet doit se remesurer après le changement de taille du conteneur.
  requestAnimationFrame(() => lmap?.invalidateSize());
}

// Change de monde (Teyvat, Enkanomiya, Gouffre…) : reconstruit tout.
async function switchMap(id) {
  mapId = id;
  for (const g of layers.values()) lmap?.removeLayer(g);
  layers.clear();
  rootEl.querySelectorAll('#map-cats input[data-label]').forEach((cb) => (cb.checked = false));
  await buildMap();
  await loadCategories();
}

// Coordonnée jeu → position Leaflet (origine + axe y inversé).
const toLatLng = (p) => [-(p.y + info.origin[1]), p.x + info.origin[0]];

async function toggleCategory(labelId, on) {
  if (!lmap) return;
  if (!on) {
    const group = layers.get(labelId);
    if (group) { lmap.removeLayer(group); layers.delete(labelId); }
    return;
  }
  const group = L.markerClusterGroup({ maxClusterRadius: 40, chunkedLoading: true });
  layers.set(labelId, group);
  try {
    const points = await invoke("map_points", { mapId, labelIds: [labelId] });
    for (const p of points) addMarker(group, labelId, p);
    lmap.addLayer(group);
  } catch (e) {
    layers.delete(labelId);
    console.warn("map_points", e);
  }
}

function addMarker(group, labelId, p) {
  const done = collected.has(p.id);
  if (done && hideCollected) return;
  const url = labelIndex.get(labelId)?.icon;
  const cls = `map-pin${done ? " done" : ""}`;
  const icon = url
    ? L.icon({ iconUrl: url, iconSize: [30, 30], iconAnchor: [15, 15], className: cls })
    : L.divIcon({ className: `map-dot ${cls}`, iconSize: [12, 12] });
  const marker = L.marker(toLatLng(p), { icon, opacity: done ? 0.4 : 1 });
  marker.on("click", () => toggleCollected(p, marker, group));
  group.addLayer(marker);
}

async function toggleCollected(p, marker, group) {
  const done = !collected.has(p.id);
  done ? collected.add(p.id) : collected.delete(p.id);
  updateCount();
  try { await invoke("map_toggle_point", { mapId, pointId: p.id, done }); } catch { /* garde l'état visuel */ }
  if (done && hideCollected) {
    group.removeLayer(marker);
  } else {
    marker.setOpacity(done ? 0.4 : 1);
    marker.getElement()?.classList.toggle("done", done);
  }
}

// Recharge les couches actives (ex. bascule « masquer les récupérés »).
function redrawAll() {
  for (const labelId of [...layers.keys()]) {
    toggleCategory(labelId, false);
    toggleCategory(labelId, true);
  }
}

function updateCount() {
  const el = document.getElementById("map-count");
  if (el) el.textContent = collected.size ? `${collected.size} récupérés` : "";
}
