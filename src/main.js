const { invoke } = window.__TAURI__.core;

let install = null;
let page = 1;
const PER_PAGE = 15;

const $ = (sel) => document.querySelector(sel);

document.querySelectorAll(".nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("visible"));
    btn.classList.add("active");
    $("#" + btn.dataset.panel).classList.add("visible");
  });
});

async function detect() {
  try {
    install = await invoke("detect_game");
    $("#game-status").textContent = "Jeu détecté : " + install.game_dir;
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
    await refresh();
  } catch (e) {
    $("#sync-status").textContent = e;
  } finally {
    btn.disabled = false;
    btn.textContent = "Synchroniser les vœux";
  }
}

async function refresh() {
  const s = await invoke("dashboard_stats");
  $("#stat-total").textContent = s.total_wishes;
  $("#stat-5").textContent = s.five_stars;
  $("#stat-4").textContent = s.four_stars;
  $("#stat-primos").textContent = s.primogems_spent.toLocaleString("fr-FR");
  $("#stat-pity").textContent = s.pity_character;
  await loadHistory();
}

async function loadHistory() {
  const data = await invoke("wish_history", { page, perPage: PER_PAGE, rank: null });
  const rows = data.items.map((w) =>
    `<tr class="rank-${w.rank_type}"><td>${w.name}</td><td>${w.item_type}</td>` +
    `<td>${w.rank_type}★</td><td>${w.time}</td></tr>`
  ).join("");
  $("#history tbody").innerHTML =
    rows || `<tr><td colspan="4">Aucun tirage — lance une synchronisation.</td></tr>`;
  const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  $("#page-label").textContent = `Page ${page} / ${pages}`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= pages;
}

// --- HoYoLAB ---------------------------------------------------------------

// API-provided strings end up in innerHTML: escape them.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function showAccount(account) {
  $("#hoyolab-status").textContent =
    `Connecté : ${account.nickname} — UID ${account.uid} (RA ${account.level})`;
  $("#hoyolab-login-btn").hidden = true;
  $("#hoyolab-capture-btn").hidden = true;
  $("#hoyolab-refresh-btn").hidden = false;
}

async function hoyolabLogin() {
  $("#hoyolab-msg").textContent =
    "Connecte-toi dans la fenêtre qui s'ouvre, puis reviens ici et clique « J'ai terminé la connexion ».";
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
    const account = await invoke("hoyolab_capture");
    showAccount(account);
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
    const p = await invoke("hoyolab_profile");
    renderProfile(p);
    $("#hoyolab-msg").textContent = "";
  } catch (e) {
    $("#hoyolab-msg").textContent = e;
  } finally {
    btn.disabled = false;
  }
}

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

  $("#chars-status").textContent =
    `${p.avatars.length} personnages sur le compte ${p.account.nickname} (UID ${p.account.uid}).`;

  $("#char-grid").innerHTML = p.avatars
    .slice()
    .sort((a, b) => b.rarity - a.rarity || b.level - a.level)
    .map((a) => `
      <div class="card char rarity-${a.rarity}">
        <img src="${esc(a.image)}" alt="" loading="lazy" />
        <strong>${esc(a.name)}</strong>
        <span class="muted">Nv. ${a.level} · C${a.actived_constellation_num} · ${esc(a.element)}</span>
      </div>`)
    .join("");

  ownedAvatars = p.avatars;
  loadFarm();

  const ex = p.explorations.filter((e) => e.exploration_percentage > 0);
  $("#explorations").hidden = ex.length === 0;
  $("#explorations-list").innerHTML = ex
    .map((e) => `
      <div class="explo">
        <span>${esc(e.name)}</span>
        <div class="bar"><div style="width:${e.exploration_percentage / 10}%"></div></div>
        <span class="muted">${(e.exploration_percentage / 10).toFixed(1)} %</span>
      </div>`)
    .join("");
}

// --- Codes promo -----------------------------------------------------------

// Deux axes distincts : ce que disent les sources, et ce que j'en ai fait.
const CODE_STATES = {
  new: ["Jamais essayé", "pending"],
  redeemed: ["Échangé", "ok"],
  used: ["Déjà utilisé", "done"],
  expired: ["Expiré", "done"],
  invalid: ["Invalide", "done"],
  cooldown: ["Limite atteinte", "warn"],
  auth: ["Session à renouveler", "warn"],
  error: ["Échec", "warn"],
};

// Seuls ces états décrivent un fait : les incidents techniques (cooldown,
// session morte) ne se posent pas à la main, ils se corrigent en réessayant.
const MANUAL_STATES = ["new", "redeemed", "used", "expired", "invalid"];

// Un code non résolu : jamais échangé avec succès ni refusé définitivement.
// Les échecs temporaires restent réessayables. Les codes morts, eux, ne sont
// plus dans la liste du tout.
const isPending = (c) => !["redeemed", "used", "expired", "invalid"].includes(c.status);

let codesReady = false;
let authWindowOpen = false;
let authPolling = false;

function statusSelect(c) {
  // L'état courant peut être un incident : on l'affiche sans le proposer.
  const options = MANUAL_STATES.includes(c.status)
    ? MANUAL_STATES
    : [c.status, ...MANUAL_STATES];
  return `<select data-code="${esc(c.code)}" class="state">${options
    .map((s) => {
      const [label] = CODE_STATES[s] ?? [s];
      return `<option value="${esc(s)}"${s === c.status ? " selected" : ""}>${label}</option>`;
    })
    .join("")}</select>`;
}

function renderCodes(view) {
  codesReady = view.ready;
  const pending = view.codes.filter(isPending).length;

  const inventory = view.codes.length
    ? `${view.codes.length} codes connus, ${pending} à essayer.`
    : "Aucun code en mémoire — « Actualiser la liste » interroge les sources.";
  $("#codes-status").textContent = view.needs_account
    ? `${inventory} L'échange depuis l'app demande la connexion HoYoLAB du tableau de bord.`
    : inventory;

  const askAuth = view.needs_authorization && !view.needs_account;
  $("#codes-auth-btn").hidden = !askAuth;
  $("#codes-auth-help").hidden = !askAuth;
  $("#codes-auth-done-btn").hidden = !askAuth || !authWindowOpen;
  $("#codes-all-btn").hidden = !view.ready || pending === 0;
  // Le bouton doit annoncer ce qu'il fait : sans autorisation, il ouvre la
  // page officielle au lieu d'échanger.
  $("#code-add-btn").textContent = view.ready
    ? "Échanger ce code"
    : "Ouvrir la page pour ce code";

  $("#codes-table tbody").innerHTML = view.codes.length
    ? view.codes.map((c) => {
        const origin = c.last_seen
          ? `${esc(c.source)} · vu le ${esc(c.last_seen.slice(0, 10))}`
          : "saisi à la main";
        const action = isPending(c)
          ? `<button data-code="${esc(c.code)}" data-action="${codesReady ? "redeem" : "open"}">
               ${codesReady ? "Échanger" : "Ouvrir la page"}</button>`
          : "";
        return `<tr>
            <td><code>${esc(c.code)}</code><div class="muted">${origin}</div></td>
            <td class="muted">${esc(c.rewards) || "—"}</td>
            <td>${statusSelect(c)}
                ${c.message ? `<div class="muted">${esc(c.message)}</div>` : ""}</td>
            <td class="right">${action}</td>
          </tr>`;
      }).join("")
    : `<tr><td colspan="4">Aucun code en mémoire.</td></tr>`;
}

async function setCodeStatus(event) {
  const select = event.target.closest("select[data-code]");
  if (!select) return;
  try {
    renderCodes(await invoke("codes_set_status", {
      code: select.dataset.code,
      status: select.value,
    }));
  } catch (e) {
    $("#codes-msg").textContent = e;
  }
}

async function codesLoad(command = "codes_list") {
  try {
    renderCodes(await invoke(command));
  } catch (e) {
    $("#codes-msg").textContent = e;
  }
}

async function codesRefresh() {
  const btn = $("#codes-refresh-btn");
  btn.disabled = true;
  $("#codes-msg").textContent = "Interrogation des sources…";
  try {
    const view = await invoke("codes_refresh");
    renderCodes(view);
    const { added, removed } = view.sync;
    $("#codes-msg").textContent = added || removed
      ? `${added} nouveau(x), ${removed} retiré(s) car plus publié(s).`
      : "Liste déjà à jour.";
  } catch (e) {
    $("#codes-msg").textContent = e;
  } finally {
    btn.disabled = false;
  }
}

async function codesAuthorize() {
  try {
    await invoke("codes_open_gift", { code: null });
    authWindowOpen = true;
    $("#codes-auth-done-btn").hidden = false;
    $("#codes-msg").textContent =
      "Connexion sur la page officielle : la fenêtre se referme dès que c'est fait.";
    pollAuthorization();
  } catch (e) {
    $("#codes-msg").textContent = e;
  }
}

// Inutile de faire cliquer sur un second bouton : on surveille la fenêtre de
// connexion jusqu'à ce que les cookies d'échange apparaissent.
async function pollAuthorization() {
  if (authPolling) return;
  authPolling = true;
  const deadline = Date.now() + 5 * 60 * 1000;
  try {
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 2000));
      // Une erreur ici signifie que la fenêtre a été fermée : on abandonne.
      const view = await invoke("codes_authorize");
      if (view) {
        authWindowOpen = false;
        renderCodes(view);
        $("#codes-msg").textContent = "Échange autorisé.";
        return;
      }
    }
    $("#codes-msg").textContent =
      "Connexion non détectée : « Vérifier la connexion » relance le contrôle.";
  } catch {
    authWindowOpen = false;
    $("#codes-msg").textContent = "Fenêtre de connexion fermée avant la fin.";
    await codesLoad();
  } finally {
    authPolling = false;
  }
}

async function codesAuthorizeDone() {
  try {
    const view = await invoke("codes_authorize");
    if (view) {
      authWindowOpen = false;
      renderCodes(view);
      $("#codes-msg").textContent = "Échange autorisé.";
    } else {
      $("#codes-msg").textContent = "Connexion pas encore terminée sur la page officielle.";
    }
  } catch (e) {
    authWindowOpen = false;
    $("#codes-msg").textContent = e;
  }
}

// L'API limite le débit : le backend attend 5 s entre deux échanges, donc
// chaque appel peut bloquer d'autant.
async function redeemOne(code) {
  $("#codes-msg").textContent = `Échange de ${code}…`;
  const outcome = await invoke("codes_redeem", { code });
  $("#codes-msg").textContent = `${code} : ${outcome.message}`;
  return outcome;
}

async function redeemFromTable(event) {
  const btn = event.target.closest("button[data-code]");
  if (!btn) return;
  const code = btn.dataset.code;
  if (btn.dataset.action === "open") {
    await invoke("codes_open_gift", { code });
    return;
  }
  btn.disabled = true;
  try {
    await redeemOne(code);
    await codesLoad();
  } catch (e) {
    $("#codes-msg").textContent = e;
    btn.disabled = false;
  }
}

async function redeemAll() {
  const btn = $("#codes-all-btn");
  btn.disabled = true;
  try {
    const view = await invoke("codes_list");
    const pending = view.codes.filter(isPending);
    for (const [i, c] of pending.entries()) {
      $("#codes-msg").textContent = `Échange ${i + 1}/${pending.length} : ${c.code}…`;
      const outcome = await redeemOne(c.code);
      // Inutile d'insister si la session est morte ou si l'API nous freine.
      if (outcome.status === "auth" || outcome.status === "cooldown") break;
    }
    await codesLoad();
  } catch (e) {
    $("#codes-msg").textContent = e;
  } finally {
    btn.disabled = false;
  }
}

async function redeemTyped() {
  const input = $("#code-input");
  const code = input.value.trim();
  if (!code) return;
  if (!codesReady) {
    await invoke("codes_open_gift", { code });
    return;
  }
  try {
    await redeemOne(code);
    input.value = "";
    await codesLoad();
  } catch (e) {
    $("#codes-msg").textContent = e;
  }
}

// --- Farm ------------------------------------------------------------------

const DAYS = [
  ["monday", "Lun"], ["tuesday", "Mar"], ["wednesday", "Mer"], ["thursday", "Jeu"],
  ["friday", "Ven"], ["saturday", "Sam"], ["sunday", "Dim"],
];

// Le jour est calculé côté interface : seul le navigateur connaît le fuseau
// local, et un sélecteur permet de préparer les jours suivants.
let farmDay = DAYS[(new Date().getDay() + 6) % 7][0];
let ownedAvatars = [];

function renderFarmDays() {
  $("#farm-days").innerHTML = DAYS.map(([key, label]) =>
    `<button data-day="${key}" class="day${key === farmDay ? " active" : ""}">${label}</button>`
  ).join("");
}

async function loadFarm(refresh = false) {
  if (!ownedAvatars.length) return;
  $("#farm").hidden = false;
  renderFarmDays();
  $("#farm-msg").textContent = "Croisement des donjons et des matériaux…";
  try {
    const plan = await invoke("farm_plan", {
      day: farmDay,
      avatarIds: ownedAvatars.map((a) => a.id),
      refresh,
    });
    renderFarm(plan);
  } catch (e) {
    $("#farm-msg").textContent = e;
    $("#farm-list").innerHTML = "";
  }
}

function renderFarm(plan) {
  const byId = new Map(ownedAvatars.map((a) => [a.id, a]));
  const total = plan.domains.reduce((n, d) => n + d.character_ids.length, 0);

  const notes = [];
  if (plan.day === "sunday") notes.push("Dimanche : tous les donjons sont ouverts.");
  if (plan.unknown_ids.length) {
    notes.push(`${plan.unknown_ids.length} personnage(s) absent(s) des données Ambr.`);
  }
  $("#farm-msg").textContent = plan.domains.length
    ? `${plan.domains.length} donjon(s), ${total} personnage(s) concerné(s). ${notes.join(" ")}`
    : `Aucun donjon utile ce jour-là. ${notes.join(" ")}`;

  $("#farm-list").innerHTML = plan.domains.map((d) => `
    <div class="domain">
      <div class="domain-head">
        <strong>${esc(d.name)}</strong>
        <span class="muted">${d.materials.map(esc).join(", ") || "—"}</span>
      </div>
      <div class="domain-chars">
        ${d.character_ids.map((id) => {
          const a = byId.get(id);
          if (!a) return "";
          return `<span class="chip rarity-${a.rarity}">
              <img src="${esc(a.image)}" alt="" loading="lazy" />${esc(a.name)}</span>`;
        }).join("")}
      </div>
    </div>`).join("");
}

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

// --- Mises à jour ----------------------------------------------------------

async function updateInit() {
  try {
    // Le backend renvoie null hors ligne : aucun message d'erreur au démarrage.
    const info = await invoke("update_check");
    if (!info) return;
    $("#update-version").textContent = `${info.current} → ${info.version}`;
    $("#update-banner").hidden = false;
  } catch {
    // Un contrôle de mise à jour raté ne doit jamais gêner le démarrage.
  }
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

$("#sync-btn").addEventListener("click", syncWishes);
$("#prev").addEventListener("click", () => { page--; loadHistory(); });
$("#next").addEventListener("click", () => { page++; loadHistory(); });
$("#hoyolab-login-btn").addEventListener("click", hoyolabLogin);
$("#hoyolab-capture-btn").addEventListener("click", hoyolabCapture);
$("#hoyolab-refresh-btn").addEventListener("click", hoyolabRefresh);
$("#codes-refresh-btn").addEventListener("click", codesRefresh);
$("#codes-auth-btn").addEventListener("click", codesAuthorize);
$("#codes-auth-done-btn").addEventListener("click", codesAuthorizeDone);
$("#codes-all-btn").addEventListener("click", redeemAll);
$("#code-add-btn").addEventListener("click", redeemTyped);
$("#code-input").addEventListener("keydown", (e) => { if (e.key === "Enter") redeemTyped(); });
$("#codes-table tbody").addEventListener("click", redeemFromTable);
$("#codes-table tbody").addEventListener("change", setCodeStatus);
$("#farm-days").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-day]");
  if (!btn) return;
  farmDay = btn.dataset.day;
  loadFarm();
});

$("#update-btn").addEventListener("click", runUpdate);
$("#update-close").addEventListener("click", () => { $("#update-banner").hidden = true; });

detect().then(refresh);
hoyolabInit();
codesLoad();
updateInit();