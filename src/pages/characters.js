//! Page Personnages : grille filtrable (Mes / Tous) + fiche personnage.
//!
//! Le catalogue vient d'Ambr (`character_catalog`) ; les personnages possédés
//! et leur build viennent de HoYoLAB. La jointure se fait par l'id.

import { invoke, $, esc } from "../util.js";
import { loadTeams, archetypeLabel } from "../teams-data.js";
import { teamCardHtml } from "../team-card.js";

const ELEMENTS = [
  ["anemo", "Anémo"], ["cryo", "Cryo"], ["dendro", "Dendro"], ["electro", "Électro"],
  ["geo", "Géo"], ["hydro", "Hydro"], ["pyro", "Pyro"],
];
const WEAPONS = [
  ["sword", "Épée à une main"], ["claymore", "Épée à deux mains"],
  ["polearm", "Arme d'hast"], ["bow", "Arc"], ["catalyst", "Catalyseur"],
];

const HELP =
  "« Mes personnages » : ceux du compte HoYoLAB connecté.&#10;« Tous » : le roster complet via Ambr.&#10;Filtres cumulatifs : élément, arme, rareté.&#10;Cliquer une carte pour ouvrir la fiche (arme et artéfacts pour les personnages possédés).";

let catalog = [];
// Pourquoi le catalogue manque, le cas échéant : « Tous » l'affiche au lieu de
// se réduire silencieusement aux personnages possédés.
let catalogError = null;
let owned = new Map();
let mode = "mine";
let query = "";
const filters = { elements: new Set(), weapons: new Set(), rarities: new Set() };

export const characters = {
  render() {
    return `
      <div id="chars-grid-view">
        <div class="panel chars-toolbar">
          <div class="segmented" id="chars-mode">
            <button class="seg" data-mode="mine">Mes personnages</button>
            <button class="seg" data-mode="all">Tous les personnages</button>
          </div>
          <input class="text-input" id="chars-search" placeholder="Rechercher un personnage…" autocomplete="off" />
          <div class="chip-row" id="rarity-filters">
            <button class="chip r5" data-rarity="5">5★</button>
            <button class="chip r4" data-rarity="4">4★</button>
          </div>
          <button class="chip" id="chars-group">Regrouper les voyageurs</button>
          <span class="hint" tabindex="0" data-tip="${HELP}">?</span>
        </div>

        <div class="chip-row" id="element-filters"></div>
        <div class="chip-row" id="weapon-filters"></div>

        <p class="muted" id="chars-count"></p>
        <div class="char-grid" id="char-grid"></div>
      </div>

      <div id="chars-detail-view" hidden></div>`;
  },

  init() {
    $("#element-filters").innerHTML = ELEMENTS
      .map(([k, l]) => `<button class="chip" data-element="${k}" style="--elem: var(--${k})"><span class="chip-dot"></span>${l}</button>`)
      .join("");
    $("#weapon-filters").innerHTML = WEAPONS
      .map(([k, l]) => `<button class="chip" data-weapon="${k}">${l}</button>`)
      .join("");

    $("#chars-mode").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (b) { mode = b.dataset.mode; markMode(); renderGrid(); }
    });
    $("#chars-search").addEventListener("input", (e) => {
      query = e.target.value.trim().toLowerCase();
      renderGrid();
    });
    $("#chars-group").addEventListener("click", () => setGroup(!groupTravelers));
    $("#rarity-filters").addEventListener("click", (e) => toggleFilter(e, "rarities", "rarity"));
    $("#element-filters").addEventListener("click", (e) => toggleFilter(e, "elements", "element"));
    $("#weapon-filters").addEventListener("click", (e) => toggleFilter(e, "weapons", "weapon"));

    $("#char-grid").addEventListener("click", openFromEvent);
    $("#char-grid").addEventListener("keydown", (e) => { if (e.key === "Enter") openFromEvent(e); });
    $("#chars-detail-view").addEventListener("click", (e) => {
      if (e.target.closest(".char-back")) return showGrid();
      const tab = e.target.closest("[data-role]");
      if (tab) selectRole(Number(tab.dataset.role));
    });
    $("#chars-detail-view").addEventListener("change", (e) => {
      if (e.target.id === "asc-from" || e.target.id === "asc-to") updateAscension();
    });

    markGroup();
    loadData();
  },

  // Ouvre une fiche depuis n'importe où dans l'app : tout composant portant
  // data-char passe par ici (voir la délégation dans main.js).
  openCharacter(id) {
    openDetail(id);
  },
};

// --- Données ----------------------------------------------------------------

async function loadData() {
  try {
    catalog = await invoke("character_catalog");
    catalogError = catalog.length ? null : "réponse vide";
  } catch (e) {
    catalog = [];
    catalogError = String(e);
  }
  try {
    const list = await invoke("hoyolab_characters");
    owned = new Map(list.map((c) => [c.id, c]));
  } catch {
    owned = new Map();
  }
  if (owned.size) await loadTravelerElements();
  if (!owned.size) mode = "all"; // pas connecté : on montre le catalogue complet
  markMode();
  renderGrid();
}

// Élément HoYoLAB (EN ou FR) → clé de couleur, pour les persos absents du
// catalogue (catalogue indisponible, ou sortie trop récente).
const ELEMENT_KEYS = {
  Anemo: "anemo", Wind: "anemo", "Anémo": "anemo",
  Cryo: "cryo", Ice: "cryo",
  Dendro: "dendro", Grass: "dendro",
  Electro: "electro", Electric: "electro", "Électro": "electro",
  Geo: "geo", Rock: "geo", "Géo": "geo",
  Hydro: "hydro", Water: "hydro",
  Pyro: "pyro", Fire: "pyro",
};
const elementKey = (s) => ELEMENT_KEYS[s] || "autre";

// Chaque élément du Voyageur s'obtient auprès de la Statue des Sept d'une
// région : son niveau vaut 0 tant qu'elle n'a pas été activée.
const REGION_ELEMENTS = [
  ["mondstadt", "anemo"], ["liyue", "geo"], ["inazuma", "electro"],
  ["sumeru", "dendro"], ["fontaine", "hydro"], ["natlan", "pyro"],
];
const sansAccent = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

// Éléments débloqués, ou `null` quand l'information manque : toutes les
// variantes sont alors montrées plutôt qu'aucune.
let travelerElements = null;

// Regroupement des variantes du Voyageur sous une seule carte, mémorisé d'une
// session à l'autre. Un seul état : séparer depuis la carte revient à éteindre
// le bouton, qui ne peut donc pas afficher autre chose que la grille montre.
const GROUP_KEY = "gensheet.groupTravelers";
const TRAVELER_GROUP = "travelers";
let groupTravelers = localStorage.getItem(GROUP_KEY) === "1";

async function loadTravelerElements() {
  try {
    const profile = await invoke("hoyolab_profile");
    const found = new Set();
    for (const region of profile.explorations ?? []) {
      if (region.level < 1) continue;
      const name = sansAccent(region.name);
      const hit = REGION_ELEMENTS.find(([r]) => name.includes(r));
      if (hit) found.add(hit[1]);
    }
    // Mondstadt est acquis dès le prologue : son absence trahit une lecture
    // incomplète, auquel cas mieux vaut ne rien masquer.
    travelerElements = found.has("anemo") ? found : null;
  } catch {
    travelerElements = null;
  }
}

// Union du catalogue Ambr et des persos possédés HoYoLAB : les possédés
// restent visibles même si le catalogue manque (hors ligne, backend pas encore
// recompilé, ou sortie trop récente pour Ambr).
function buildList() {
  // Le Voyageur a une carte par élément ; HoYoLAB n'en connaît qu'un, celui
  // équipé : seule la variante correspondante porte les données du compte.
  const ownedFor = (c) => {
    const o = owned.get(c.id);
    if (!o) return null;
    if (!c.key.includes("-")) return o;
    // Voyageur : chaque élément débloqué compte comme possédé, l'élément
    // actuellement équipé n'étant qu'un état parmi ceux déjà obtenus.
    return !travelerElements || travelerElements.has(c.element) ? o : null;
  };

  const list = catalog.map((c) => ({
    key: c.key, id: c.id, name: c.name, rarity: c.rarity,
    element: c.element, elementLabel: c.element_label,
    weapon: c.weapon, weaponLabel: c.weapon_label, icon: c.icon,
    owned: ownedFor(c),
  }));

  // Possédés absents du catalogue (hors ligne, ou sortie trop récente).
  const known = new Set(catalog.map((c) => c.id));
  for (const [id, o] of owned) {
    if (known.has(id)) continue;
    list.push({
      key: String(id), id, name: o.name, rarity: o.rarity,
      element: elementKey(o.element), elementLabel: o.element,
      weapon: "", weaponLabel: ", ", icon: o.icon, owned: o,
    });
  }

  list.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));
  return list;
}

function applyFilters(list) {
  return list.filter((c) => {
    if (mode === "mine" && !c.owned) return false;
    if (query && !c.name.toLowerCase().includes(query)) return false;
    if (filters.elements.size && !filters.elements.has(c.element)) return false;
    if (filters.weapons.size && !filters.weapons.has(c.weapon)) return false;
    if (filters.rarities.size && !filters.rarities.has(String(c.rarity))) return false;
    return true;
  });
}

// --- Grille -----------------------------------------------------------------

function setGroup(on) {
  groupTravelers = on;
  localStorage.setItem(GROUP_KEY, on ? "1" : "0");
  markGroup();
  renderGrid();
}

// Le libellé annonce ce que le clic va faire, pas l'état courant.
function markGroup() {
  const btn = $("#chars-group");
  btn.classList.toggle("active", groupTravelers);
  btn.textContent = groupTravelers ? "Séparer les voyageurs" : "Regrouper les voyageurs";
}

// Une carte unique à la place des variantes du Voyageur, prenant la place de
// la première pour ne pas bousculer l'ordre de la grille.
function groupTravelerCards(list) {
  if (!groupTravelers) return list;
  const variants = list.filter((c) => c.key.includes("-"));
  if (variants.length < 2) return list;

  // L'Anémo sert de visage au groupe ; à défaut, la première variante venue.
  const face = variants.find((c) => c.element === "anemo") ?? variants[0];
  const card = {
    ...face,
    key: TRAVELER_GROUP,
    name: "Voyageurs",
    sub: `${variants.length} éléments : cliquer pour séparer`,
  };

  let placed = false;
  const out = [];
  for (const c of list) {
    if (!c.key.includes("-")) out.push(c);
    else if (!placed) { out.push(card); placed = true; }
  }
  return out;
}

function renderGrid() {
  const all = buildList();
  const list = groupTravelerCards(applyFilters(all));
  const total = mode === "mine" ? owned.size : all.length;
  const kind = mode === "mine" ? "possédé(s)" : "affiché(s)";
  // Sans catalogue, « Tous » ne peut montrer que les personnages du compte :
  // le dire, plutôt que d'afficher une grille identique sans explication.
  $("#chars-count").textContent =
    mode === "all" && catalogError
      ? `Catalogue indisponible (${catalogError}), seuls les personnages du compte sont listés.`
      : `${list.length} personnage(s) ${kind} sur ${total}`;
  $("#char-grid").innerHTML =
    list.map(cardHtml).join("") ||
    `<p class="muted">Aucun personnage ne correspond aux filtres.</p>`;
}

function cardHtml(c) {
  const sub = c.sub ?? (c.owned
    ? `Nv. ${c.owned.level} · C${c.owned.actived_constellation_num} · ${c.elementLabel}`
    : `${c.rarity}★ · ${c.weaponLabel}`);
  return `
    <div class="char-card ${c.owned ? "owned" : ""}" data-id="${esc(c.key)}" tabindex="0"
         style="--elem: var(--${c.element})">
      <div class="char-portrait">
        <img src="${esc(c.icon)}" alt="" loading="lazy" />
        <span class="elem-dot"></span>
        <span class="rarity-pill r${c.rarity}">${c.rarity}★</span>
      </div>
      <div class="char-plate">
        <div class="char-name">${esc(c.name)}</div>
        <div class="char-sub">${esc(sub)}</div>
      </div>
    </div>`;
}

function toggleFilter(event, setName, attr) {
  const btn = event.target.closest(`[data-${attr}]`);
  if (!btn) return;
  const value = btn.dataset[attr];
  const set = filters[setName];
  set.has(value) ? set.delete(value) : set.add(value);
  btn.classList.toggle("active");
  renderGrid();
}

function markMode() {
  document.querySelectorAll("#chars-mode .seg")
    .forEach((s) => s.classList.toggle("active", s.dataset.mode === mode));
}

// --- Fiche ------------------------------------------------------------------

function openFromEvent(event) {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  // La carte de groupe sépare au lieu d'ouvrir une fiche : elle n'en a pas.
  if (card.dataset.id === TRAVELER_GROUP) return setGroup(false);
  openDetail(card.dataset.id);
}

function showGrid() {
  $("#chars-grid-view").hidden = false;
  $("#chars-detail-view").hidden = true;
}

let currentId = null;
let currentDetail = null;
let currentReco = null;
let recoRole = 0;
// Plage de niveaux choisie pour les matériaux d'ascension (null = plage complète).
const ascRange = { from: null, to: null };

// Builds recommandés agrégés (embarqués, offline). Chargés une seule fois.
let buildsData = null;
async function loadBuilds() {
  if (!buildsData) {
    buildsData = await fetch("data/builds.fr.json").then((r) => r.json()).catch(() => ({}));
  }
  return buildsData;
}

// Meilleures équipes du personnage affiché (jeu de données des équipes).
let currentTeams = null;

async function openDetail(key) {
  // `key` distingue les variantes du Voyageur ; `c.id` reste l'id numérique
  // attendu par HoYoLAB et par les builds recommandés.
  const c = buildList().find((x) => x.key === key);
  if (!c) return;
  currentId = key;
  currentDetail = null;
  currentReco = null;
  currentTeams = null;
  recoRole = 0;
  ascRange.from = null;
  ascRange.to = null;
  $("#chars-grid-view").hidden = true;
  $("#chars-detail-view").hidden = false;
  renderDetail(c, { loading: true });

  let build = null;
  let detail = null;
  const tasks = [
    invoke("character_detail", { key }).then((d) => { detail = d; }).catch(() => {}),
    loadBuilds().then((all) => { currentReco = all[c.id] ?? null; }),
    loadTeams().then((d) => { currentTeams = d; }).catch(() => {}),
  ];
  if (c.owned) {
    tasks.push(invoke("hoyolab_character_build", { characterId: c.id })
      .then((b) => { build = b; })
      .catch(() => {}));
  }
  await Promise.all(tasks);
  if (currentId === key) renderDetail(c, { build, detail });
}

function renderDetail(c, { build = null, detail = null, loading = false } = {}) {
  currentDetail = detail;
  const facts = [
    ["Élément", c.elementLabel],
    ["Arme", c.weaponLabel || "-"],
    ["Rareté", `${c.rarity}★`],
  ];
  if (c.owned) {
    facts.push(["Niveau", c.owned.level]);
    facts.push(["Constellation", `C${c.owned.actived_constellation_num}`]);
  }
  if (build) {
    facts.push(["Arme équipée", build.weapon || "-"]);
    facts.push(["Valeur critique", build.crit_value.toFixed(1)]);
  }

  $("#chars-detail-view").innerHTML = `
    <button class="btn-ghost char-back">← Personnages</button>
    <div class="panel hero" style="--elem: var(--${c.element})">
      <div class="hero-portrait">
        <img src="${esc(c.icon)}" alt="" loading="lazy" />
        <span class="elem-dot"></span>
      </div>
      <div class="hero-info">
        <div class="puce-row">
          <span class="puce r${c.rarity}">${c.rarity}★</span>
          <span class="puce elem"><span class="elem-dot sm"></span>${esc(c.elementLabel)}</span>
          ${c.weaponLabel ? `<span class="puce">${esc(c.weaponLabel)}</span>` : ""}
        </div>
        <h2 class="hero-name">${esc(c.name)}</h2>
        <div class="facts">
          ${facts.map(([k, v]) => `<div class="fact"><span class="fact-k">${k}</span><span class="fact-v">${esc(String(v))}</span></div>`).join("")}
        </div>
      </div>
    </div>
    ${recoBuildsHtml(currentReco)}
    ${teamsHtml(c.id, loading)}
    ${buildSection(c, build, loading)}
    ${detailSections(detail, loading)}`;
}

// --- Meilleures équipes -----------------------------------------------------

const TEAMS_SHOWN = 6;

// Les équipes désignent le Voyageur par élément : le posséder, c'est disposer
// de toutes ses variantes.
function ownedTeamKeys() {
  const keys = new Set([...owned.keys()].map(String));
  for (const c of catalog) if (owned.has(c.id)) keys.add(c.key);
  return keys;
}

function teamsHtml(id, loading) {
  if (!currentTeams) {
    return sectionNote(loading ? "Recherche des meilleures équipes…" : "Équipes indisponibles pour ce personnage.");
  }
  const list = currentTeams.byCharacter.get(String(id)) ?? [];
  if (!list.length) return sectionNote("Aucune équipe documentée pour ce personnage.");

  const ctx = { characters: currentTeams.characters, owned: ownedTeamKeys() };
  return `
    <div class="panel fiche-section">
      <div class="asc-head">
        <div class="block-title">Meilleures équipes</div>
        <span class="muted">${list.length} équipe(s) documentée(s)</span>
      </div>
      <div class="team-list">
        ${list.slice(0, TEAMS_SHOWN).map((t) => teamCardHtml(t, ctx, { title: archetypeLabel(t.archetype) })).join("")}
      </div>
    </div>`;
}

// --- Builds recommandés (agrégés depuis game8/KQM/GameWith) ------------------

function recoBuildsHtml(reco) {
  if (!reco || !reco.roles?.length) {
    return sectionNote("Builds recommandés indisponibles pour ce personnage.");
  }
  const role = reco.roles[recoRole] ?? reco.roles[0];
  // Toujours montrer le rôle : onglets si plusieurs, sinon un simple badge.
  const header = reco.roles.length > 1
    ? `<div class="segmented reco-tabs">${reco.roles
        .map((r, i) => `<button class="seg ${i === recoRole ? "active" : ""}" data-role="${i}">${esc(r.name)}</button>`)
        .join("")}</div>`
    : `<span class="reco-role-badge">${esc(role.name)}</span>`;
  return `
    <div class="panel fiche-section">
      <div class="asc-head">
        <div class="block-title">Builds recommandés</div>
        ${header}
      </div>
      <div id="reco-body">${recoRoleHtml(role)}</div>
    </div>`;
}

function recoRoleHtml(r) {
  // `link` rend l'entrée cliquable vers sa fiche (voir wireEntityLinks).
  const items = (list, attr = null) => list
    .map((it) => {
      const link = attr && it.id ? ` ${attr}="${it.id}" tabindex="0" role="button"` : "";
      return `<span class="reco-item r${it.rarity}"${link}>${it.icon ? `<img class="reco-ic" src="${esc(it.icon)}" alt="" loading="lazy" />` : ""}${esc(it.name)}${it.refine ? `<span class="reco-refine">R${it.refine}</span>` : ""}</span>`;
    })
    .join("");
  const statLine = (label, opts) => opts.length
    ? `<div class="reco-stat"><span class="reco-stat-k">${label}</span><span>${esc(opts.join(" · "))}</span></div>`
    : "";
  return `
    <div class="reco-block"><div class="rm-label">Armes</div><div class="reco-row">${items(r.weapons, "data-weapon")}</div></div>
    <div class="reco-block"><div class="rm-label">Artéfacts</div><div class="reco-row">${items(r.artifacts)}</div></div>
    <div class="reco-block"><div class="rm-label">Statistiques principales</div>
      ${statLine("Sablier", r.mainStats.sands)}
      ${statLine("Coupe", r.mainStats.goblet)}
      ${statLine("Couronne", r.mainStats.circlet)}
    </div>
    <div class="reco-block"><div class="rm-label">Sous-statistiques (priorité)</div>
      <div class="reco-substats">${esc(r.subStats.join(" › "))}</div></div>`;
}

// Change de rôle sans recharger la fiche.
function selectRole(i) {
  if (!currentReco || i === recoRole) return;
  recoRole = i;
  document.querySelectorAll(".reco-tabs .seg").forEach((b, j) => b.classList.toggle("active", j === i));
  $("#reco-body").innerHTML = recoRoleHtml(currentReco.roles[i]);
}

const sectionNote = (text) => `<div class="panel fiche-section"><p class="muted">${text}</p></div>`;

// Arme + artéfacts (HoYoLAB), selon que le perso est possédé et chargé.
function buildSection(c, build, loading) {
  if (build) return artifactsHtml(build);
  if (c.owned) return sectionNote(loading ? "Lecture de l'arme et des artéfacts…" : "Arme et artéfacts indisponibles (HoYoLAB injoignable).");
  return sectionNote("Arme et artéfacts visibles pour les personnages possédés, une fois le compte HoYoLAB connecté (tableau de bord).");
}

// Talents, constellations et matériaux d'ascension (Ambr).
function detailSections(detail, loading) {
  if (detail) return talentsHtml(detail) + constellationsHtml(detail) + ascensionHtml(detail);
  return sectionNote(loading
    ? "Chargement des talents, constellations et matériaux…"
    : "Talents et matériaux indisponibles (Ambr injoignable).");
}

// Le texte des talents/constellations (Ambr) contient un balisage de jeu qu'on
// réduit en texte brut : {LINK#…}…{/LINK}, {c#hex}…{/c}, <color=…>, etc.
const stripMarkup = (s) =>
  String(s ?? "")
    .replace(/\{NON_BREAK_SPACE\}/g, " ")
    .replace(/\{NICKNAME\}/g, "Voyageur")
    .replace(/<\/?color[^>]*>/gi, "")
    .replace(/\{[^{}]*\}/g, "");

// Texte de description : nettoyé, échappé, avec les retours à la ligne préservés.
// Ambr renvoie parfois des "\n" littéraux (backslash + n), pas de vrais newlines.
const fmt = (text) => esc(stripMarkup(text)).replace(/\\n|\n/g, "<br>");

function talentsHtml(d) {
  if (!d.talents.length) return "";
  return `
    <div class="panel fiche-section">
      <div class="block-title">Talents</div>
      <div class="detail-list">
        ${d.talents.map((t) => `
          <div class="detail-row">
            <img class="detail-icon" src="${esc(t.icon)}" alt="" loading="lazy" />
            <div>
              <div class="rm-label">${esc(t.name)} <span class="detail-kind">${esc(t.kind)}</span></div>
              ${t.description ? `<div class="detail-desc">${fmt(t.description)}</div>` : ""}
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

function constellationsHtml(d) {
  if (!d.constellations.length) return "";
  return `
    <div class="panel fiche-section">
      <div class="block-title">Constellations</div>
      <div class="detail-list">
        ${d.constellations.map((c, i) => `
          <div class="detail-row">
            <img class="detail-icon" src="${esc(c.icon)}" alt="" loading="lazy" />
            <div>
              <div class="rm-label">C${i + 1} · ${esc(c.name)}</div>
              ${c.description ? `<div class="detail-desc">${fmt(c.description)}</div>` : ""}
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

const ascFroms = (d) => d.ascension.map((p) => p.from_level);
const ascTos = (d) => d.ascension.map((p) => p.max_level);

function ascensionHtml(d) {
  if (!d.ascension.length) return "";
  const froms = ascFroms(d);
  const tos = ascTos(d);
  const from = ascRange.from ?? froms[0];
  const to = ascRange.to ?? tos[tos.length - 1];
  const opt = (levels, sel, label) =>
    levels.map((l, i) => `<option value="${l}" ${l === sel ? "selected" : ""}>${label(l, i)}</option>`).join("");
  // Le premier palier part du niveau 1 : 1→20 ne coûte aucun matériau.
  const fromLabel = (l, i) => (i === 0 ? "niv. 1-20" : `niv. ${l}`);
  const toLabel = (l) => `niv. ${l}`;
  return `
    <div class="panel fiche-section">
      <div class="asc-head">
        <div class="block-title">Matériaux d'ascension</div>
        <div class="asc-range">
          <label>de <select id="asc-from">${opt(froms, from, fromLabel)}</select></label>
          <span class="asc-arrow">→</span>
          <label>à <select id="asc-to">${opt(tos, to, toLabel)}</select></label>
        </div>
      </div>
      <div id="asc-result">${ascResultHtml(d, from, to)}</div>
    </div>`;
}

// Somme les matériaux et le mora des paliers compris dans la plage [from, to].
function ascResultHtml(d, from, to) {
  const byName = new Map();
  let mora = 0;
  for (const p of d.ascension) {
    if (p.from_level < from || p.max_level > to) continue;
    mora += p.mora;
    for (const m of p.materials) {
      const cur = byName.get(m.name);
      if (cur) cur.count += m.count;
      else byName.set(m.name, { ...m });
    }
  }
  const materials = [...byName.values()].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  if (!materials.length) return `<p class="muted">Aucun matériau sur cette plage.</p>`;
  const moraLine = mora ? `<div class="asc-mora muted">${mora.toLocaleString("fr-FR")} mora</div>` : "";
  return `
    <div class="mat-grid">
      ${materials.map((m) => `
        <div class="mat">
          <img class="mat-icon r${m.rank}" src="${esc(m.icon)}" alt="" loading="lazy" />
          <div class="mat-info"><div class="mat-name">${esc(m.name)}</div><div class="muted">×${m.count}</div></div>
        </div>`).join("")}
    </div>${moraLine}`;
}

// Recalcule la liste quand un menu change, en gardant from < to.
function updateAscension() {
  const d = currentDetail;
  if (!d) return;
  let from = Number($("#asc-from").value);
  let to = Number($("#asc-to").value);
  if (from >= to) {
    // Ramène la borne d'arrivée au premier palier au-dessus du départ.
    to = ascTos(d).find((l) => l > from) ?? to;
    $("#asc-to").value = String(to);
  }
  ascRange.from = from;
  ascRange.to = to;
  $("#asc-result").innerHTML = ascResultHtml(d, from, to);
}

function artifactsHtml(build) {
  const advice = build.advice.length
    ? `<div class="panel fiche-section">
         <div class="block-title">Stats conseillées (HoYoLAB)</div>
         ${build.advice.map((a) => `<div class="advice-line">${esc(a)}</div>`).join("")}
       </div>`
    : "";
  const relics = build.relics.length
    ? `<div class="panel fiche-section">
         <div class="block-title">Artéfacts · valeur critique ${build.crit_value.toFixed(1)}</div>
         <div class="artifacts">${build.relics.map(relicHtml).join("")}</div>
       </div>`
    : `<div class="panel fiche-section"><p class="muted">Aucun artéfact équipé.</p></div>`;
  return advice + relics;
}

function relicHtml(r) {
  // main_ok vaut null sur la fleur et la plume : rien à juger.
  const verdict = r.main_ok === null ? ""
    : r.main_ok ? `<span class="badge ok">adaptée</span>`
                : `<span class="badge warn">hors conseils</span>`;
  const subs = r.subs.length
    ? r.subs.map((s) => `
        <div class="sub ${s.wanted ? "wanted" : ""}">
          <span>${esc(s.label)}</span><span>${esc(s.value)}</span>
          <span class="muted">${s.times ? "×" + (s.times + 1) : ""}</span>
        </div>`).join("")
    : `<div class="sub"><span class="muted">Aucune sous-statistique</span></div>`;
  return `
    <div class="artifact r${r.rarity}">
      <div class="artifact-ic">
        ${r.icon ? `<img src="${esc(r.icon)}" alt="" loading="lazy" />` : ""}
        <span class="artifact-lv">+${r.level}</span>
      </div>
      <div class="artifact-slot">${esc(r.slot)}</div>
      <strong class="artifact-set">${esc(r.set || r.slot)}</strong>
      <div class="artifact-main">
        <span class="am-k">${esc(r.main.label)}</span>
        <span class="am-v">${esc(r.main.value)}</span>
        ${verdict}
      </div>
      <div class="artifact-subs">${subs}</div>
    </div>`;
}
