//! Page Armes : grille filtrable (type, rareté) + fiche d'une arme.
//!
//! Même structure que la page Personnages, dont elle reprend les composants de
//! grille et de fiche. Tout vient du catalogue Ambr, mis en cache côté Rust.

import { invoke, $, esc } from "../util.js";
import { loadTeams, ROLE_LABEL } from "../teams-data.js";

const KINDS = [
  ["sword", "Épée à une main"], ["claymore", "Épée à deux mains"],
  ["polearm", "Arme d'hast"], ["bow", "Arc"], ["catalyst", "Catalyseur"],
];
const RARITIES = [5, 4, 3];

const HELP =
  "Catalogue complet des armes.&#10;Filtres cumulatifs : type et rareté.&#10;" +
  "Cliquer une carte ouvre la fiche : statistiques de départ et passif à chaque raffinement.";

let catalog = [];
let catalogError = null;
let query = "";
const filters = { kinds: new Set(), rarities: new Set() };

export const weapons = {
  render() {
    return `
      <div id="weapons-grid-view">
        <div class="panel chars-toolbar">
          <input class="text-input" id="weapons-search" placeholder="Rechercher une arme…" autocomplete="off" />
          <div class="chip-row" id="weapon-rarity-filters">
            ${RARITIES.map((r) => `<button class="chip r${r}" data-rarity="${r}">${r}★</button>`).join("")}
          </div>
          <span class="hint" tabindex="0" data-tip="${HELP}">?</span>
        </div>

        <div class="chip-row" id="weapon-kind-filters">
          ${KINDS.map(([k, l]) => `<button class="chip" data-kind="${k}">${l}</button>`).join("")}
        </div>

        <p class="muted" id="weapons-count"></p>
        <div class="char-grid" id="weapon-grid"></div>
      </div>

      <div id="weapon-detail-view" hidden></div>`;
  },

  init() {
    $("#weapons-search").addEventListener("input", (e) => {
      query = e.target.value.trim().toLowerCase();
      renderGrid();
    });
    $("#weapon-rarity-filters").addEventListener("click", (e) => toggleFilter(e, "rarities", "rarity"));
    $("#weapon-kind-filters").addEventListener("click", (e) => toggleFilter(e, "kinds", "kind"));

    $("#weapon-grid").addEventListener("click", openFromEvent);
    $("#weapon-grid").addEventListener("keydown", (e) => { if (e.key === "Enter") openFromEvent(e); });
    $("#weapon-detail-view").addEventListener("click", (e) => {
      if (e.target.closest(".weapon-back")) return showGrid();
      const step = e.target.closest("[data-refine]");
      if (step) selectRefinement(Number(step.dataset.refine));
    });

    loadData();
  },

  // Ouvre une fiche depuis n'importe où dans l'app (composants [data-weapon]).
  openWeapon(id) {
    openDetail(Number(id));
  },
};

// --- Données ----------------------------------------------------------------

async function loadData() {
  try {
    catalog = await invoke("weapon_catalog");
    catalogError = catalog.length ? null : "réponse vide";
  } catch (e) {
    catalog = [];
    catalogError = String(e);
  }
  renderGrid();
}

function applyFilters(list) {
  return list.filter((w) => {
    if (query && !w.name.toLowerCase().includes(query)) return false;
    if (filters.kinds.size && !filters.kinds.has(w.kind)) return false;
    if (filters.rarities.size && !filters.rarities.has(String(w.rarity))) return false;
    return true;
  });
}

function toggleFilter(event, setName, attr) {
  const btn = event.target.closest(`[data-${attr}]`);
  if (!btn) return;
  const set = filters[setName];
  const value = btn.dataset[attr];
  set.has(value) ? set.delete(value) : set.add(value);
  btn.classList.toggle("active");
  renderGrid();
}

// --- Grille -----------------------------------------------------------------

function renderGrid() {
  const list = applyFilters(catalog);
  $("#weapons-count").textContent = catalogError
    ? `Catalogue indisponible (${catalogError}).`
    : `${list.length} arme(s) sur ${catalog.length}`;
  $("#weapon-grid").innerHTML =
    list.map(cardHtml).join("") || `<p class="muted">Aucune arme ne correspond aux filtres.</p>`;
}

const cardHtml = (w) => `
  <div class="char-card is-weapon" data-id="${w.id}" tabindex="0">
    <div class="char-portrait">
      <img src="${esc(w.icon)}" alt="" loading="lazy" />
      <span class="rarity-pill r${w.rarity}">${w.rarity}★</span>
    </div>
    <div class="char-plate">
      <div class="char-name">${esc(w.name)}</div>
      <div class="char-sub">${esc(w.sub_stat || w.kind_label)}</div>
    </div>
  </div>`;

function openFromEvent(event) {
  const card = event.target.closest("[data-id]");
  if (card) openDetail(Number(card.dataset.id));
}

function showGrid() {
  $("#weapons-grid-view").hidden = false;
  $("#weapon-detail-view").hidden = true;
}

// --- Personnages qui tirent parti de l'arme ---------------------------------

const TIERS = ["S", "A", "B", "C"];
const USERS_SHOWN = 18;

/// Rang du couple arme/personnage : sa place dans les armes recommandées pour
/// ce rôle, avancée d'un cran par guide supplémentaire qui la confirme, un
/// choix unanime sur trois sources vaut mieux qu'un avis isolé bien placé.
function comboTier(position, sources) {
  const score = position - (sources.length - 1);
  if (score <= 0) return "S";
  if (score <= 2) return "A";
  if (score <= 4) return "B";
  return "C";
}

// Provenance de chaque arme, générée hors ligne (npm run data:weapons).
let obtainById = null;

async function loadObtain() {
  if (!obtainById) {
    obtainById = await fetch("data/weapons.fr.json").then((r) => r.json()).catch(() => ({}));
  }
  return obtainById;
}

// Index inverse des builds : arme → personnages, meilleur rang retenu quand un
// personnage la recommande sur plusieurs rôles.
let usersByWeapon = null;

async function loadWeaponUsers() {
  if (usersByWeapon) return usersByWeapon;
  const builds = await fetch("data/builds.fr.json").then((r) => r.json()).catch(() => ({}));
  const map = new Map();

  for (const [charId, entry] of Object.entries(builds)) {
    if (charId === "_meta") continue;
    for (const role of entry.roles ?? []) {
      (role.weapons ?? []).forEach((w, position) => {
        if (!w.id) return;
        const tier = comboTier(position, w.sources ?? []);
        const list = map.get(w.id) ?? [];
        const seen = list.find((u) => u.charId === charId);
        if (!seen) list.push({ charId, role: role.name, tier });
        else if (TIERS.indexOf(tier) < TIERS.indexOf(seen.tier)) Object.assign(seen, { role: role.name, tier });
        map.set(w.id, list);
      });
    }
  }
  usersByWeapon = map;
  return map;
}

function usersHtml(users, characters) {
  if (!users?.length) {
    return `<div class="panel fiche-section"><p class="muted">Aucun personnage ne la recommande dans les builds agrégés.</p></div>`;
  }
  const items = [...users]
    .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))
    .slice(0, USERS_SHOWN)
    .map((u) => {
      const c = characters[u.charId] ?? {};
      const name = c.name ?? u.charId;
      return `
        <span class="reco-item" data-char="${esc(u.charId)}" tabindex="0" role="button"
              title="${esc(ROLE_LABEL[u.role] ?? u.role)}">
          ${c.icon ? `<img class="reco-ic" src="${esc(c.icon)}" alt="" loading="lazy" />` : ""}
          ${esc(name)}<span class="tier-badge t-${u.tier}">${u.tier}</span>
        </span>`;
    })
    .join("");
  return `
    <div class="panel fiche-section">
      <div class="block-title">Meilleure sur</div>
      <p class="muted teams-section-desc">Rang du couple arme/personnage, d'après la place de l'arme dans ses builds.</p>
      <div class="reco-row">${items}</div>
    </div>`;
}

// --- Fiche ------------------------------------------------------------------

let currentId = null;
let currentDetail = null;
let currentUsers = null;
let currentObtain = null;
let refinement = 0;

async function openDetail(id) {
  const w = catalog.find((x) => x.id === id);
  if (!w) return;
  currentId = id;
  currentDetail = null;
  currentUsers = null;
  refinement = 0;
  $("#weapons-grid-view").hidden = true;
  $("#weapon-detail-view").hidden = false;
  renderDetail(w, { loading: true });

  let detail = null;
  await Promise.all([
    invoke("weapon_detail", { id }).then((d) => { detail = d; }).catch(() => {}),
    loadObtain().then((all) => { currentObtain = all[id]?.obtain ?? []; }).catch(() => {}),
    Promise.all([loadWeaponUsers(), loadTeams()])
      .then(([byWeapon, teams]) => { currentUsers = { list: byWeapon.get(id) ?? [], characters: teams.characters }; })
      .catch(() => {}),
  ]);
  if (currentId === id) renderDetail(w, { detail });
}

function renderDetail(w, { detail = null, loading = false } = {}) {
  currentDetail = detail;
  const facts = [
    ["Type", w.kind_label],
    ["Rareté", `${w.rarity}★`],
    ["ATQ de base", detail ? detail.base_atk.toFixed(0) : "…"],
    ["Statistique secondaire", w.sub_stat || "-"],
  ];
  if (detail?.sub_value) facts.push(["Valeur au niveau 1", detail.sub_value]);
  if (currentObtain?.length) facts.push(["Provenance", currentObtain.join(" · ")]);

  $("#weapon-detail-view").innerHTML = `
    <button class="btn-ghost weapon-back">← Armes</button>
    <div class="panel hero">
      <div class="hero-portrait is-weapon">
        <img src="${esc(w.icon)}" alt="" loading="lazy" />
      </div>
      <div class="hero-info">
        <div class="puce-row">
          <span class="puce r${w.rarity}">${w.rarity}★</span>
          <span class="puce">${esc(w.kind_label)}</span>
          ${w.sub_stat ? `<span class="puce">${esc(w.sub_stat)}</span>` : ""}
        </div>
        <h2 class="hero-name">${esc(w.name)}</h2>
        <div class="facts">
          ${facts.map(([k, v]) => `<div class="fact"><span class="fact-k">${k}</span><span class="fact-v">${esc(String(v))}</span></div>`).join("")}
        </div>
      </div>
    </div>
    ${affixHtml(detail, loading)}
    ${currentUsers ? usersHtml(currentUsers.list, currentUsers.characters) : ""}
    ${loreHtml(detail)}`;
}

// Passif : un onglet par raffinement, le texte changeant sans recharger.
function affixHtml(detail, loading) {
  if (!detail) {
    return `<div class="panel fiche-section"><p class="muted">${loading ? "Lecture de la fiche…" : "Fiche indisponible."}</p></div>`;
  }
  if (!detail.refinements.length) {
    return `<div class="panel fiche-section"><p class="muted">Cette arme n'a pas de passif.</p></div>`;
  }
  const tabs = detail.refinements
    .map((_, i) => `<button class="seg ${i === refinement ? "active" : ""}" data-refine="${i}">R${i + 1}</button>`)
    .join("");
  return `
    <div class="panel fiche-section">
      <div class="asc-head">
        <div class="block-title">${esc(detail.affix_name)}</div>
        <div class="segmented reco-tabs">${tabs}</div>
      </div>
      <p class="advice-line" id="affix-text">${esc(detail.refinements[refinement])}</p>
    </div>`;
}

function selectRefinement(i) {
  if (!currentDetail || i === refinement) return;
  refinement = i;
  document.querySelectorAll("#weapon-detail-view [data-refine]")
    .forEach((b, j) => b.classList.toggle("active", j === i));
  $("#affix-text").textContent = currentDetail.refinements[i];
}

const loreHtml = (detail) =>
  detail?.description
    ? `<div class="panel fiche-section fiche-note">${esc(detail.description)}</div>`
    : "";
