import { invoke, $, esc } from "./util.js";
import { applyTheme, loadTheme } from "./theme.js";
import { CHANGELOG } from "./changelog.js";
import { dashboard } from "./pages/dashboard.js";
import { characters } from "./pages/characters.js";
import { codes } from "./pages/codes.js";
import { settings } from "./pages/settings.js";
import { roadmap } from "./pages/roadmap.js";
import { map } from "./pages/map.js";

// Écrans réellement implémentés. Les autres restent en placeholder.
// Un module de page expose `render()` (son HTML) et `init()` (ses branchements).
const PAGES = { dashboard, personnages: characters, codes, settings, roadmap, carte: map };

// --- Écrans -----------------------------------------------------------------
// Source unique de la navigation : la sidebar et les pages en sont générées.
// `id` = état `tab`, `desc` décrit ce que la page contiendra une fois conçue.

const SCREENS = [
  {
    title: "Vue d'ensemble",
    items: [
      { id: "dashboard", label: "Tableau de bord", desc: "Jeu détecté, synchro des vœux, stats de compte HoYoLAB et historique des tirages." },
      { id: "calendrier", label: "Calendrier", desc: "Grille hebdomadaire des bannières, resets, anniversaires et événements." },
      { id: "codes", label: "Codes", desc: "Codes promotionnels : agrégation, échange en un clic et suivi personnel." },
    ],
  },
  {
    title: "Base de données",
    items: [
      { id: "personnages", label: "Personnages", desc: "Grille des personnages, filtres par élément, arme et rareté, accès aux fiches." },
      { id: "armes", label: "Armes", desc: "Catalogue des armes : rareté, type, ATQ de base et statistique secondaire." },
      { id: "artefacts", label: "Artéfacts", desc: "Sets d'artéfacts, effets 2 et 4 pièces, domaines associés." },
      { id: "bestiaire", label: "Bestiaire", desc: "Monstres et boss par catégorie et région, avec leurs butins." },
    ],
  },
  {
    title: "Méta & guides",
    items: [
      { id: "tierlists", label: "Tier lists", desc: "Classements S→D des personnages, filtrables par élément." },
      { id: "equipes", label: "Équipes", desc: "Compositions recommandées, réactions et rotations." },
    ],
  },
  {
    title: "Progression",
    items: [
      { id: "exploration", label: "Exploration", desc: "Progression par région : oculus, coffres et pourcentage." },
      { id: "succes", label: "Succès", desc: "Succès par catégorie, avancement et primo-gemmes à la clé." },
    ],
  },
  {
    title: "Outils",
    items: [
      { id: "carte", label: "Carte interactive", desc: "Carte de Teyvat par région et par type de marqueur." },
    ],
  },
];

// Entrées du pied de sidebar — aussi des écrans à part entière.
const FOOT = [
  { id: "roadmap", label: "Feuille de route", badge: "design", desc: "Aide-mémoire de conception — à retirer de la version finale." },
  { id: "donnees", label: "Données & CGUs", link: true, desc: "Sources de données et mentions légales (outil non officiel)." },
  { id: "reglages", label: "Réglages", link: true, desc: "Langue, dossier du jeu, compte, apparence et gestion des données." },
];

const DEFAULT_TAB = "dashboard";

// --- Rendu du shell ---------------------------------------------------------

/** Section d'origine + libellé + description d'un écran, par son id. */
function screenInfo(id) {
  for (const sec of SCREENS) {
    const it = sec.items.find((i) => i.id === id);
    if (it) return { eyebrow: sec.title, label: it.label, desc: it.desc };
  }
  const f = FOOT.find((i) => i.id === id);
  return f ? { eyebrow: "Gensheet", label: f.label, desc: f.desc } : null;
}

function renderNav() {
  $("#nav").innerHTML = SCREENS.map((sec) => `
    <div class="nav-section">
      <div class="nav-section-title">${sec.title}</div>
      <div class="nav-section-items">
        ${sec.items.map((it) => `
          <button class="nav-item" data-tab="${it.id}">
            <span class="bar"></span>
            <span class="dot"></span>
            <span>${it.label}</span>
          </button>`).join("")}
      </div>
    </div>`).join("");

  $("#sidebar-foot").innerHTML = FOOT.map((it) =>
    it.link
      ? `<button class="foot-link" data-tab="${it.id}">${it.label}</button>`
      : `<button class="roadmap-btn" data-tab="${it.id}">
           <span>${it.label}</span>
           ${it.badge ? `<span class="badge">${it.badge}</span>` : ""}
         </button>`
  ).join("");
}

function renderPages() {
  const ids = [...SCREENS.flatMap((s) => s.items), ...FOOT].map((i) => i.id);
  $("#pages").innerHTML = ids.map((id) => {
    const t = screenInfo(id);
    const body = PAGES[id] ? PAGES[id].render() : placeholder(t.desc);
    return `
      <section class="page" data-page="${id}">
        <header class="page-header">
          <div class="eyebrow">${t.eyebrow}</div>
          <h1>${t.label}</h1>
        </header>
        ${body}
      </section>`;
  }).join("");

  // Chaque page réelle câble ses événements et charge ses données.
  for (const id of Object.keys(PAGES)) {
    const el = document.querySelector(`.page[data-page='${id}']`);
    if (el) PAGES[id].init(el);
  }
}

const placeholder = (desc) => `
  <div class="panel placeholder">
    <span class="glyph">◆</span>
    <h2>À concevoir</h2>
    <p>${desc}</p>
    <span class="tag">bientôt</span>
  </div>`;

function showTab(id) {
  document.querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".page")
    .forEach((p) => p.classList.toggle("active", p.dataset.page === id));
  $(".main").scrollTop = 0;
  // Certaines pages (carte) doivent s'initialiser une fois visibles.
  PAGES[id]?.onShow?.();
}

function wireNav() {
  $(".sidebar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (btn) showTab(btn.dataset.tab);
  });
}

// --- Mises à jour -----------------------------------------------------------

// Version rejetée par l'utilisateur : la bannière ne réapparaît plus pour elle.
const DISMISSED_KEY = "gensheet.dismissedUpdate";
let pendingVersion = null;

async function updateInit() {
  try {
    // Le backend renvoie null hors ligne : aucun message d'erreur au démarrage.
    const info = await invoke("update_check");
    if (!info || localStorage.getItem(DISMISSED_KEY) === info.version) return;
    pendingVersion = info.version;
    $("#update-version").textContent = `${info.current} → ${info.version}`;
    $("#update-banner").hidden = false;
  } catch {
    // Un contrôle de mise à jour raté ne doit jamais gêner le démarrage.
  }
}

function dismissUpdate() {
  $("#update-banner").hidden = true;
  if (pendingVersion) localStorage.setItem(DISMISSED_KEY, pendingVersion);
}

async function runUpdate() {
  const btn = $("#update-btn");
  btn.disabled = true;
  btn.textContent = "Téléchargement…";
  try {
    // L'app redémarre d'elle-même à la fin : rien à faire après.
    await invoke("update_install");
  } catch (e) {
    $("#update-version").textContent = e;
    btn.disabled = false;
    btn.textContent = "Réessayer";
  }
}

// --- Quoi de neuf -----------------------------------------------------------

// Au 1er lancement d'une nouvelle version : pop-up des changements. On mémorise
// la dernière version vue ; à l'install initiale on enregistre sans rien montrer.
const CHANGELOG_KEY = "gensheet.changelogSeen";

function showWhatsNew() {
  const latest = CHANGELOG[0]?.version;
  if (!latest) return;
  const seen = localStorage.getItem(CHANGELOG_KEY);
  localStorage.setItem(CHANGELOG_KEY, latest);
  if (!seen || seen === latest) return; // première install ou rien de neuf
  const idx = CHANGELOG.findIndex((c) => c.version === seen);
  const entries = idx > 0 ? CHANGELOG.slice(0, idx) : [CHANGELOG[0]];
  renderWhatsNew(entries);
}

function renderWhatsNew(entries) {
  const el = document.createElement("div");
  el.className = "modal-backdrop";
  el.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">Quoi de neuf ?</h2>
      ${entries.map((e) => `
        <div class="whatsnew-ver">
          <div class="whatsnew-tag">version ${esc(e.version)}</div>
          <ul>${e.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        </div>`).join("")}
      <button class="btn-primary modal-ok">Compris</button>
    </div>`;
  el.addEventListener("click", (ev) => {
    if (ev.target === el || ev.target.closest(".modal-ok")) el.remove();
  });
  document.body.appendChild(el);
}

// --- Démarrage --------------------------------------------------------------

applyTheme(loadTheme());
renderNav();
renderPages();
wireNav();
showTab(DEFAULT_TAB);

$("#update-btn").addEventListener("click", runUpdate);
$("#update-close").addEventListener("click", dismissUpdate);
updateInit();
showWhatsNew();
