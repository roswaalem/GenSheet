//! Page Tableau de bord : détection du jeu, synchro des vœux, compte HoYoLAB,
//! statistiques de compte, et analyse des vœux par bannière (pity + chance).

import { invoke, $, esc } from "../util.js";

const PER_PAGE = 15;
/// Onglet agrégé, sans filtre de bannière.
const ALL = "all";

let install = null;
let page = 1;
let banners = [];
let selected = ALL;

export const dashboard = {
  render() {
    return `
      <div class="dash-setup">
        <div class="panel setup-card">
          <div class="setup-row">
            <div class="setup-info">
              <div class="setup-label">Installation du jeu</div>
              <div class="setup-value mono" id="game-status">Détection du jeu…</div>
            </div>
            <button class="btn-primary" id="sync-btn" disabled>Synchroniser les vœux</button>
          </div>
          <p class="muted" id="sync-status"></p>
        </div>

        <div class="panel setup-card">
          <div class="setup-row">
            <div class="setup-info">
              <div class="setup-label">Compte HoYoLAB</div>
              <div class="setup-value" id="hoyolab-status">Non connecté.</div>
            </div>
            <div class="btn-row">
              <button class="btn-primary" id="hoyolab-login-btn">Se connecter</button>
              <button class="btn-ghost" id="hoyolab-capture-btn" hidden>J'ai terminé la connexion</button>
              <button class="btn-ghost" id="hoyolab-refresh-btn" hidden>Rafraîchir le profil</button>
            </div>
          </div>
          <p class="muted" id="hoyolab-msg"></p>
        </div>
      </div>

      <section class="dash-block" id="hoyolab-stats" hidden>
        <div class="block-title">Compte</div>
        <div class="stat-grid">
          ${tile("hy-days", "Jours d'activité")}
          ${tile("hy-achievements", "Hauts faits")}
          ${tile("hy-abyss", "Abysse")}
          ${tile("hy-chests", "Coffres ouverts")}
          ${tile("hy-oculi", "Oculus collectés")}
          ${tile("hy-waypoints", "Points de tp / domaines")}
        </div>
      </section>

      <section class="dash-block">
        <div class="block-title">Vœux, tous confondus</div>
        <div class="stat-grid is-accent">
          ${tile("stat-total", "Vœux au total")}
          ${tile("stat-primos", "Primo-gemmes dépensées")}
          ${tile("stat-5", "5★ obtenus")}
          ${tile("stat-4", "4★ obtenus")}
        </div>
      </section>

      <section class="dash-block" id="banner-view" hidden>
        <div class="block-title">Par bannière</div>
        <div class="segmented" id="banner-tabs"></div>
        <div class="stat-grid" id="banner-stats"></div>
        <div id="pity-bar"></div>
        <div class="five-history" id="five-history"></div>
        <div class="panel">
          <table class="data-table" id="history">
            <thead><tr><th>Nom</th><th>Type</th><th>Rareté</th><th>Date</th></tr></thead>
            <tbody></tbody>
          </table>
          <div class="pager">
            <button class="btn-ghost" id="prev">←</button>
            <span class="muted" id="page-label"></span>
            <button class="btn-ghost" id="next">→</button>
          </div>
        </div>
      </section>`;
  },

  init() {
    $("#sync-btn").addEventListener("click", syncWishes);
    $("#prev").addEventListener("click", () => { page--; loadHistory(); });
    $("#next").addEventListener("click", () => { page++; loadHistory(); });
    $("#banner-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-banner]");
      if (b) selectBanner(b.dataset.banner);
    });
    $("#hoyolab-login-btn").addEventListener("click", hoyolabLogin);
    $("#hoyolab-capture-btn").addEventListener("click", hoyolabCapture);
    $("#hoyolab-refresh-btn").addEventListener("click", hoyolabRefresh);

    detect().then(loadWishes);
    hoyolabInit();
  },
};

const tile = (id, label) =>
  `<div class="stat-tile"><span class="stat-num" id="${id}">-</span><span class="stat-label">${label}</span></div>`;

// --- Vœux -------------------------------------------------------------------

async function detect() {
  try {
    install = await invoke("detect_game");
    $("#game-status").textContent = install.game_dir;
    $("#sync-btn").disabled = false;
  } catch (e) {
    $("#game-status").textContent = e;
  }
}

async function syncWishes() {
  const btn = $("#sync-btn");
  btn.disabled = true;
  btn.textContent = "Synchronisation…";
  try {
    const url = await invoke("get_wish_url", { dataDir: install.data_dir });
    const report = await invoke("sync_wishes", { wishUrl: url });
    $("#sync-status").textContent =
      `${report.new_items} nouveaux tirages (UID ${report.uid ?? "?"})`;
    await loadWishes();
  } catch (e) {
    $("#sync-status").textContent = e;
  } finally {
    btn.disabled = false;
    btn.textContent = "Synchroniser les vœux";
  }
}

async function loadWishes() {
  const s = await invoke("dashboard_stats");
  $("#stat-total").textContent = s.total_wishes;
  $("#stat-primos").textContent = s.primogems_spent.toLocaleString("fr-FR");
  $("#stat-5").textContent = s.five_stars;
  $("#stat-4").textContent = s.four_stars;

  banners = (await invoke("wish_analysis")).filter((b) => b.total > 0);
  $("#banner-view").hidden = banners.length === 0;
  if (!banners.length) return;

  renderBannerTabs();
  const known = selected === ALL || banners.some((b) => b.banner === selected);
  selectBanner(known ? selected : ALL);
}

function renderBannerTabs() {
  $("#banner-tabs").innerHTML = [
    `<button class="seg" data-banner="${ALL}">Toutes</button>`,
    ...banners.map((b) => `<button class="seg" data-banner="${b.banner}">${esc(b.label)}</button>`),
  ].join("");
}

function selectBanner(key) {
  selected = key;
  page = 1;
  document.querySelectorAll("#banner-tabs .seg")
    .forEach((s) => s.classList.toggle("active", s.dataset.banner === key));
  if (key === ALL) renderAllStats();
  else renderBannerStats(banners.find((b) => b.banner === key));
  loadHistory();
}

// Explications communes aux tuiles, affichées au survol.
const TIPS = {
  pity:
    "Tirages effectués depuis le dernier 5★.\n" +
    "Le compteur repart à zéro à chaque 5★ obtenu.",
  avg:
    "Nombre de tirages qu'un 5★ a coûté en moyenne sur cette bannière,\n" +
    "calculé sur les 5★ déjà obtenus.",
  luck:
    "Écart entre le pity moyen et la moyenne communautaire de référence (62,5 tirages).\n" +
    "Une valeur négative signifie des 5★ tombés plus tôt que cette moyenne, donc de la chance.\n" +
    "C'est un constat sur les tirages passés : les probabilités des tirages à venir restent les mêmes.",
  rate: "Part des tirages ayant donné un 5★, toutes bannières confondues.",
  allPity: "Moyenne des pity de tous les 5★ obtenus, bannières confondues.",
};

// Vue agrégée : seul ce qui garde un sens hors d'une bannière donnée. Le pity
// courant n'en a aucun (chaque bannière a le sien), la fréquence des 5★ oui.
function renderAllStats() {
  const sum = (f) => banners.reduce((n, b) => n + f(b), 0);
  const total = sum((b) => b.total);
  const fives = banners.flatMap((b) => b.five_history);
  const avg = fives.length ? (fives.reduce((n, f) => n + f.pity, 0) / fives.length).toFixed(1) : "-";
  const rate = total ? `${((sum((b) => b.five_stars) / total) * 100).toFixed(2)} %` : "-";

  $("#banner-stats").innerHTML = [
    statTile(total, "Tirages"),
    statTile(sum((b) => b.primogems).toLocaleString("fr-FR"), "Primo-gemmes"),
    statTile(sum((b) => b.five_stars), "5★ obtenus", "is-5"),
    statTile(sum((b) => b.four_stars), "4★ obtenus", "is-4"),
    statTile(rate, "Fréquence des 5★", "", TIPS.rate),
    statTile(avg, "Pity moyen 5★", "", TIPS.allPity),
  ].join("");

  // Le pity n'existe que par bannière : rien à montrer dans la vue agrégée.
  $("#pity-bar").innerHTML = "";
  fiveChips([...fives].sort((a, b) => b.time.localeCompare(a.time)));
}

function renderBannerStats(b) {
  const avg = b.avg_five_pity != null ? b.avg_five_pity.toFixed(1) : "-";
  const luck = luckInfo(b.luck_delta);
  // Tirages restants avant le pity garanti, où le 5★ tombe à coup sûr.
  const left = Math.max(0, b.hard_pity - b.pity);

  const tiles = [
    statTile(b.total, "Tirages"),
    statTile(b.five_stars, "5★ obtenus", "is-5"),
    statTile(b.four_stars, "4★ obtenus", "is-4"),
    statTile(b.pity, "Pity en cours", "", TIPS.pity),
    statTile(left, "5★ assuré dans", "", hardPityTip(b, left)),
    statTile(avg, "Pity moyen 5★", "", TIPS.avg),
    statTile(luck.text, `Chance${luck.sub ? ` · ${luck.sub}` : ""}`, luck.cls, TIPS.luck),
  ];
  // `null` sur les bannières sans 50/50 déductible : la tuile n'a alors rien à dire.
  if (b.guaranteed != null) tiles.push(featuredTile(b, left));
  $("#banner-stats").innerHTML = tiles.join("");

  $("#pity-bar").innerHTML = pityBarHtml(b);
  fiveChips([...b.five_history].reverse(), "Aucun 5★ sur cette bannière.");
}

const pct = (n) => `${n.toFixed(1).replace(/[.,]0$/, "").replace(".", ",")} %`;

// Les termes « soft pity » et « hard pity » sont ceux de la communauté, mais
// ils ne parlent pas d'eux-mêmes : l'infobulle les définit et les chiffre.
function pityTip(b) {
  const dernier = b.hard_pity - 1;
  // Probabilité au n-ième tirage du soft pity, plafonnée : sur la bannière
  // d'arme, la pente atteint la certitude avant même le garanti.
  const taux = (n) => Math.min(100, b.base_rate + b.soft_step * (n - b.soft_pity + 1));
  const fin = taux(dernier) >= 100 ? "la certitude" : pct(taux(dernier));

  return [
    "Tirages depuis le dernier 5★. Le compteur repart à zéro à chaque 5★.",
    "",
    `• 1 à ${b.soft_pity - 1} : ${pct(b.base_rate)} par tirage.`,
    `• ${b.soft_pity} à ${dernier}, soft pity : ${pct(taux(b.soft_pity))} au ${b.soft_pity}e,`,
    `  puis +${b.soft_step} points par tirage, jusqu'à ${fin} au ${dernier}e.`,
    `• ${b.hard_pity}, hard pity : 5★ garanti.`,
  ].join("\n");
}

// La barre dit la mécanique par sa géométrie : un long palier où le taux ne
// bouge pas, puis la zone où il grimpe à chaque tirage. Une barre uniforme
// laisserait croire à une progression régulière, ce qu'elle n'est pas.
function pityBarHtml(b) {
  const soft = Math.round((b.soft_pity / b.hard_pity) * 100);
  const pos = Math.min(100, Math.round((b.pity / b.hard_pity) * 100));
  const note = b.pity >= b.hard_pity
    ? "Hard pity atteint : le prochain tirage donne un 5★."
    : b.pity >= b.soft_pity
      ? "Dans le soft pity : la probabilité augmente à chaque tirage."
      : `Encore ${b.soft_pity - b.pity} tirage(s) avant le soft pity.`;

  const four = Math.min(10, b.pity_four);
  const pips = Array.from({ length: 10 }, (_, i) => `<span class="pip ${i < four ? "on" : ""}"></span>`).join("");

  return `
    <div class="pity">
      <div class="pity-head">
        <span class="pity-title">Pity 5★</span>
        <span class="hint" tabindex="0" data-tip="${esc(pityTip(b))}">?</span>
        <span class="pity-count">${b.pity} <span class="muted">/ ${b.hard_pity}</span></span>
      </div>
      <div class="pity-track" style="--soft: ${soft}%; --pos: ${pos}%">
        <span class="pity-zone"></span>
        <span class="pity-fill"></span>
        <span class="pity-mark"></span>
      </div>
      <div class="pity-scale" style="--soft: ${soft}%">
        <span>0</span>
        <span class="pity-seuil">soft pity ${b.soft_pity}</span>
        <span>hard pity ${b.hard_pity}</span>
      </div>
      <div class="pity-legend">
        <span class="key acquis"></span>tirages effectués
        <span class="key zone"></span>soft pity
      </div>
      <p class="muted pity-note">${note}</p>
      <div class="pity-four">
        <span class="pity-title">4★</span>${pips}
        <span class="muted">${four} / 10</span>
      </div>
    </div>`;
}

const hardPityTip = (b, left) =>
  `5★ garanti au ${b.hard_pity}e tirage sans 5★ : il en reste ${left}.\n` +
  `La plupart tombent avant, à partir du soft pity (${b.soft_pity}e).`;

// Pire cas avant la vedette : un 50/50 perdu coûte un cycle de pity de plus.
function featuredTile(b, left) {
  const worst = b.guaranteed ? left : left + b.hard_pity;
  const tip = b.guaranteed
    ? `Le dernier 5★ obtenu était un personnage permanent : le 50/50 est perdu,\n` +
      `donc le prochain 5★ sera forcément celui en vedette. Au plus tard dans ${worst} tirages.`
    : `Le prochain 5★ a une chance sur deux d'être celui en vedette.\n` +
      `S'il ne l'est pas, le suivant l'est d'office : ${worst} tirages dans le pire des cas.`;
  return statTile(worst, "Vedette assurée dans", b.guaranteed ? "luck-good" : "", tip);
}

function fiveChips(list, empty = "Aucun 5★.") {
  $("#five-history").innerHTML = list.length
    ? list.slice(0, 24)
        .map((f) => `<span class="five-chip ${pityClass(f.pity)}" title="${esc(f.time)}">${esc(f.name)} <b>${f.pity}</b></span>`)
        .join("")
    : `<span class="muted">${empty}</span>`;
}

// Écart au pity moyen : négatif = moins de tirages qu'espéré, donc chanceux.
function luckInfo(delta) {
  if (delta == null) return { text: ", ", cls: "", sub: "" };
  const v = Math.abs(delta).toFixed(1);
  if (delta < -0.05) return { text: `−${v}`, cls: "luck-good", sub: "chanceux" };
  if (delta > 0.05) return { text: `+${v}`, cls: "luck-bad", sub: "malchanceux" };
  return { text: "0", cls: "", sub: "dans la moyenne" };
}

const pityClass = (p) => (p <= 40 ? "p-good" : p >= 75 ? "p-bad" : "");

const statTile = (value, label, cls = "", tip = "") =>
  `<div class="stat-tile"${tip ? ` data-tip="${esc(tip)}" tabindex="0"` : ""}>
     <span class="stat-num ${cls}">${value}</span><span class="stat-label">${label}</span></div>`;

async function loadHistory() {
  // Sans clé de bannière, le backend ne filtre pas : c'est la vue « Toutes ».
  const banner = selected === ALL ? null : selected;
  const data = await invoke("wish_history", { page, perPage: PER_PAGE, banner });
  const rows = data.items
    .map((w) =>
      `<tr class="rank-${w.rank_type}"><td>${esc(w.name)}</td><td>${esc(w.item_type)}</td>` +
      `<td>${w.rank_type}★</td><td>${esc(w.time)}</td></tr>`)
    .join("");
  const vide = selected === ALL ? "Aucun tirage enregistré." : "Aucun tirage sur cette bannière.";
  $("#history tbody").innerHTML = rows || `<tr><td colspan="4" class="muted">${vide}</td></tr>`;
  const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  $("#page-label").textContent = `Page ${page} / ${pages}`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= pages;
}

// --- HoYoLAB ----------------------------------------------------------------

async function hoyolabInit() {
  try {
    const account = await invoke("hoyolab_account");
    if (account) {
      showAccount(account);
      await hoyolabRefresh();
    }
  } catch (e) {
    $("#hoyolab-msg").textContent = e;
  }
}

function showAccount(account) {
  $("#hoyolab-status").textContent =
    `${account.nickname} : UID ${account.uid} (RA ${account.level})`;
  $("#hoyolab-login-btn").hidden = true;
  $("#hoyolab-capture-btn").hidden = true;
  $("#hoyolab-refresh-btn").hidden = false;
}

async function hoyolabLogin() {
  $("#hoyolab-msg").textContent =
    "Connexion à effectuer dans la fenêtre qui s'ouvre, puis « J'ai terminé la connexion ».";
  try {
    await invoke("hoyolab_open_login");
    $("#hoyolab-capture-btn").hidden = false;
  } catch (e) {
    $("#hoyolab-msg").textContent = e;
  }
}

async function hoyolabCapture() {
  const btn = $("#hoyolab-capture-btn");
  btn.disabled = true;
  try {
    showAccount(await invoke("hoyolab_capture"));
    $("#hoyolab-msg").textContent = "";
    await hoyolabRefresh();
  } catch (e) {
    $("#hoyolab-msg").textContent = e;
  } finally {
    btn.disabled = false;
  }
}

async function hoyolabRefresh() {
  const btn = $("#hoyolab-refresh-btn");
  btn.disabled = true;
  try {
    renderProfile(await invoke("hoyolab_profile"));
    $("#hoyolab-msg").textContent = "";
  } catch (e) {
    $("#hoyolab-msg").textContent = e;
  } finally {
    btn.disabled = false;
  }
}

// Seules les stats de compte sont remplies ici. Personnages, farm et
// exploration reviendront avec leurs pages respectives.
function renderProfile(p) {
  const s = p.stats;
  $("#hoyolab-stats").hidden = false;
  $("#hy-days").textContent = s.active_day_number;
  $("#hy-achievements").textContent = s.achievement_number;
  $("#hy-abyss").textContent = s.spiral_abyss || "-";
  $("#hy-chests").textContent = (
    s.common_chest_number + s.exquisite_chest_number + s.precious_chest_number +
    s.luxurious_chest_number + s.magic_chest_number
  ).toLocaleString("fr-FR");
  $("#hy-oculi").textContent =
    s.anemoculus_number + s.geoculus_number + s.dendroculus_number +
    s.electroculus_number + s.hydroculus_number + s.pyroculus_number;
  $("#hy-waypoints").textContent = `${s.way_point_number} / ${s.domain_number}`;
}
