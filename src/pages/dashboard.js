//! Page Tableau de bord : détection du jeu, synchro des vœux, compte HoYoLAB,
//! statistiques de compte, et analyse des vœux par bannière (pity + chance).

import { invoke, $, esc } from "../util.js";

const PER_PAGE = 15;

let install = null;
let page = 1;
let banners = [];
let selected = null;

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
        <div class="block-title">Vœux — tous confondus</div>
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
  `<div class="stat-tile"><span class="stat-num" id="${id}">–</span><span class="stat-label">${label}</span></div>`;

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
  selectBanner(banners.some((b) => b.banner === selected) ? selected : banners[0].banner);
}

function renderBannerTabs() {
  $("#banner-tabs").innerHTML = banners
    .map((b) => `<button class="seg" data-banner="${b.banner}">${esc(b.label)}</button>`)
    .join("");
}

function selectBanner(key) {
  selected = key;
  page = 1;
  document.querySelectorAll("#banner-tabs .seg")
    .forEach((s) => s.classList.toggle("active", s.dataset.banner === key));
  renderBannerStats(banners.find((b) => b.banner === key));
  loadHistory();
}

function renderBannerStats(b) {
  const avg = b.avg_five_pity != null ? b.avg_five_pity.toFixed(1) : "—";
  const luck = luckInfo(b.luck_delta);
  $("#banner-stats").innerHTML = [
    statTile(b.total, "Tirages"),
    statTile(b.five_stars, "5★ obtenus", "is-5"),
    statTile(b.four_stars, "4★ obtenus", "is-4"),
    statTile(b.pity, "Pity en cours"),
    statTile(avg, "Pity moyen 5★"),
    statTile(luck.text, `Chance${luck.sub ? ` · ${luck.sub}` : ""}`, luck.cls),
  ].join("");

  $("#five-history").innerHTML = b.five_history.length
    ? [...b.five_history].reverse().slice(0, 24)
        .map((f) => `<span class="five-chip ${pityClass(f.pity)}" title="${esc(f.time)}">${esc(f.name)} <b>${f.pity}</b></span>`)
        .join("")
    : `<span class="muted">Aucun 5★ sur cette bannière.</span>`;
}

// Écart au pity moyen : négatif = moins de tirages qu'espéré, donc chanceux.
function luckInfo(delta) {
  if (delta == null) return { text: "—", cls: "", sub: "" };
  const v = Math.abs(delta).toFixed(1);
  if (delta < -0.05) return { text: `−${v}`, cls: "luck-good", sub: "chanceux" };
  if (delta > 0.05) return { text: `+${v}`, cls: "luck-bad", sub: "malchanceux" };
  return { text: "0", cls: "", sub: "dans la moyenne" };
}

const pityClass = (p) => (p <= 40 ? "p-good" : p >= 75 ? "p-bad" : "");

const statTile = (value, label, cls = "") =>
  `<div class="stat-tile"><span class="stat-num ${cls}">${value}</span><span class="stat-label">${label}</span></div>`;

async function loadHistory() {
  const data = await invoke("wish_history", { page, perPage: PER_PAGE, banner: selected });
  const rows = data.items
    .map((w) =>
      `<tr class="rank-${w.rank_type}"><td>${esc(w.name)}</td><td>${esc(w.item_type)}</td>` +
      `<td>${w.rank_type}★</td><td>${esc(w.time)}</td></tr>`)
    .join("");
  $("#history tbody").innerHTML =
    rows || `<tr><td colspan="4" class="muted">Aucun tirage sur cette bannière.</td></tr>`;
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
    `${account.nickname} — UID ${account.uid} (RA ${account.level})`;
  $("#hoyolab-login-btn").hidden = true;
  $("#hoyolab-capture-btn").hidden = true;
  $("#hoyolab-refresh-btn").hidden = false;
}

async function hoyolabLogin() {
  $("#hoyolab-msg").textContent =
    "Connecte-toi dans la fenêtre qui s'ouvre, puis clique « J'ai terminé la connexion ».";
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
  $("#hy-abyss").textContent = s.spiral_abyss || "–";
  $("#hy-chests").textContent = (
    s.common_chest_number + s.exquisite_chest_number + s.precious_chest_number +
    s.luxurious_chest_number + s.magic_chest_number
  ).toLocaleString("fr-FR");
  $("#hy-oculi").textContent =
    s.anemoculus_number + s.geoculus_number + s.dendroculus_number +
    s.electroculus_number + s.hydroculus_number + s.pyroculus_number;
  $("#hy-waypoints").textContent = `${s.way_point_number} / ${s.domain_number}`;
}
