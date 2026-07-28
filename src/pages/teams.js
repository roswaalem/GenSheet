//! Page Équipes : tier list des compositions documentées et composeur.
//!
//! Les équipes et les portraits viennent du jeu de données agrégé (game8 + KQM),
//! les personnages possédés de HoYoLAB. Le composeur note des compositions
//! inédites à partir du roster réellement possédé (`composer.js`).

import { invoke, $, esc } from "../util.js";
import { loadTeams, TIERS } from "../teams-data.js";
import { ARCHETYPE_LABEL } from "../reactions.js";
import { ownedTeams, generateTeams } from "../composer.js";
import { teamCardHtml } from "../team-card.js";

const PAGE_SIZE = 24;
const TRAVELER_IDS = ["10000005", "10000007"];

const HELP =
  "Tier list : toutes les équipes documentées, classées par la qualité de leurs membres et la solidité de leurs associations.&#10;" +
  "Composeur : les équipes jouables avec le roster détecté, puis des compositions inédites notées sur leurs réactions, leur survie et leurs duos.";

let data = null;
let owned = new Set();
let tab = "tierlist";
let limit = PAGE_SIZE;
let anchor = "";
const filters = { tiers: new Set(), archetype: "", query: "", onlyOwned: false };

export const teams = {
  render() {
    return `
      <div class="panel teams-toolbar">
        <div class="segmented" id="teams-tabs">
          <button class="seg active" data-tab="tierlist">Tier list</button>
          <button class="seg" data-tab="composer">Composeur</button>
        </div>
        <span class="hint" tabindex="0" data-tip="${HELP}">?</span>
      </div>
      <div id="teams-body"><p class="muted">Chargement des équipes…</p></div>`;
  },

  init(el) {
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
  },

  // Le jeu de données est volumineux : on ne le charge qu'à la première visite.
  async onShow() {
    if (data) return;
    try {
      data = await loadTeams();
    } catch {
      $("#teams-body").innerHTML = `<div class="panel"><p class="muted">Données d'équipes introuvables : les générer avec <code>npm run data:teams</code>.</p></div>`;
      return;
    }
    await loadOwned();
    renderBody();
  },
};

// --- Contexte joueur --------------------------------------------------------

async function loadOwned() {
  try {
    const mine = await invoke("hoyolab_characters");
    owned = new Set(mine.map((c) => String(c.id)));
    // Le Voyageur est stocké par élément : possédé une fois, possédé partout.
    if (TRAVELER_IDS.some((id) => owned.has(id))) {
      for (const id of Object.keys(data.characters)) if (id.includes("-")) owned.add(id);
    }
  } catch {
    owned = new Set();
  }
}

const charOf = (id) => data.characters[id] ?? {};
const ctx = () => ({ characters: data.characters, owned });

// --- Rendu général ----------------------------------------------------------

function renderBody() {
  $("#teams-body").innerHTML = tab === "tierlist" ? tierListHtml() : composerHtml();
}

function onClick(e) {
  const tabBtn = e.target.closest("#teams-tabs [data-tab]");
  if (tabBtn) {
    tab = tabBtn.dataset.tab;
    limit = PAGE_SIZE;
    document.querySelectorAll("#teams-tabs .seg").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    return renderBody();
  }
  const tierChip = e.target.closest("[data-tier]");
  if (tierChip) {
    const t = tierChip.dataset.tier;
    filters.tiers.has(t) ? filters.tiers.delete(t) : filters.tiers.add(t);
    return renderBody();
  }
  if (e.target.closest("#teams-owned")) {
    filters.onlyOwned = !filters.onlyOwned;
    return renderBody();
  }
  if (e.target.closest("#teams-more")) {
    limit += PAGE_SIZE;
    return renderBody();
  }
}

function onInput(e) {
  if (e.target.id !== "teams-search") return;
  filters.query = e.target.value.trim().toLowerCase();
  limit = PAGE_SIZE;
  renderBody();
}

function onChange(e) {
  if (e.target.id === "teams-archetype") filters.archetype = e.target.value;
  else if (e.target.id === "teams-anchor") anchor = e.target.value;
  else return;
  limit = PAGE_SIZE;
  renderBody();
}

// --- Tier list --------------------------------------------------------------

function tierListHtml() {
  const list = filtered();
  const shown = list.slice(0, limit);
  return `
    <div class="panel teams-filters">
      <input class="text-input" id="teams-search" value="${esc(filters.query)}"
             placeholder="Filtrer par personnage…" autocomplete="off" />
      <select class="text-input" id="teams-archetype">
        <option value="">Tous les archétypes</option>
        ${archetypeOptions()}
      </select>
      <div class="chip-row">
        ${TIERS.map((t) => `<button class="chip tier-chip ${filters.tiers.has(t) ? "active" : ""}" data-tier="${t}">${t}</button>`).join("")}
        <button class="chip ${filters.onlyOwned ? "active" : ""}" id="teams-owned">Mes personnages</button>
      </div>
    </div>
    <p class="muted teams-count">${list.length} équipe(s) : ${data.teams.length} au total</p>
    <div class="team-list">${shown.map((t) => teamCard(t)).join("") || emptyNote()}</div>
    ${list.length > shown.length ? `<button class="btn-ghost" id="teams-more">Afficher plus</button>` : ""}`;
}

function archetypeOptions() {
  const used = new Set(data.teams.map((t) => t.archetype));
  return Object.entries(ARCHETYPE_LABEL)
    .filter(([key]) => used.has(key))
    .map(([key, label]) => `<option value="${key}" ${filters.archetype === key ? "selected" : ""}>${esc(label)}</option>`)
    .join("");
}

function filtered() {
  return data.teams.filter((t) => {
    if (filters.tiers.size && !filters.tiers.has(t.tier)) return false;
    if (filters.archetype && t.archetype !== filters.archetype) return false;
    if (filters.onlyOwned && !t.members.every((m) => owned.has(m.id))) return false;
    if (filters.query && !t.members.some((m) => (charOf(m.id).name ?? "").toLowerCase().includes(filters.query))) return false;
    return true;
  });
}

const emptyNote = () => `<div class="panel"><p class="muted">Aucune équipe ne correspond aux filtres.</p></div>`;

// --- Composeur --------------------------------------------------------------

function composerHtml() {
  if (!owned.size) {
    return `<div class="panel"><p class="muted">Aucun roster détecté : le composeur part des personnages du compte HoYoLAB, à connecter depuis le tableau de bord.</p></div>`;
  }

  const pool = [...owned];
  const pivot = anchor || null;
  const { ready, almost } = ownedTeams(pool, data, pivot);
  const known = new Set(data.teams.map((t) => t.members.map((m) => m.id).sort().join("|")));
  const invented = generateTeams(pool, data, { anchor: pivot, limit: 9, exclude: known });

  return `
    <div class="panel teams-filters">
      <select class="text-input" id="teams-anchor">
        <option value="">Toutes les équipes possibles</option>
        ${anchorOptions(pool)}
      </select>
      <p class="muted">${owned.size} personnage(s) possédé(s) · ${ready.length} équipe(s) documentée(s) jouable(s)</p>
    </div>

    ${section("Prêtes à jouer", "Équipes documentées dont les quatre membres sont possédés.",
      ready.slice(0, limit).map((t) => teamCard(t)).join("") ||
      `<p class="muted">Aucune équipe documentée complète pour l'instant.</p>`)}

    ${section("À un personnage près", "Le membre manquant est remplacé par le meilleur substitut du roster.",
      almost.slice(0, 6).map(almostCard).join("") ||
      `<p class="muted">Rien à signaler.</p>`)}

    ${section("Compositions inédites", "Assemblées à partir du roster, notées sur leurs réactions, leur survie et leurs duos.",
      invented.map(inventedCard).join("") ||
      `<p class="muted">Pas assez de personnages pour proposer autre chose.</p>`)}

    ${ready.length > limit ? `<button class="btn-ghost" id="teams-more">Afficher plus d'équipes prêtes</button>` : ""}`;
}

function anchorOptions(pool) {
  return pool
    .map((id) => ({ id, name: charOf(id).name ?? "" }))
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `<option value="${c.id}" ${anchor === c.id ? "selected" : ""}>Autour de ${esc(c.name)}</option>`)
    .join("");
}

const section = (title, desc, body) => `
  <div class="panel fiche-section">
    <div class="block-title">${title}</div>
    <p class="muted teams-section-desc">${desc}</p>
    <div class="team-list">${body}</div>
  </div>`;

function almostCard({ team, missing, swap }) {
  const members = team.members.map((m) => (m.id === missing.id ? { id: swap, role: m.role, swapped: true } : m));
  return teamCard({ ...team, members }, {
    note: `<span class="team-swap">${esc(charOf(swap).name ?? "?")} remplace ${esc(charOf(missing.id).name ?? "?")}</span>`,
  });
}

function inventedCard(t) {
  const members = t.ids.map((id) => ({ id, role: t.roles.get(id) }));
  return teamCard(
    { members, archetype: t.archetype, score: t.score, sources: [] },
    { badge: `${t.score} %`, reasons: t.reasons }
  );
}

const teamCard = (team, opts) => teamCardHtml(team, ctx(), opts);
