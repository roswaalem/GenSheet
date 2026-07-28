//! Page Codes : agrégation communautaire, échange (en un clic ou via la page
//! officielle) et suivi personnel de l'état de chaque code.

import { invoke, $, esc } from "../util.js";

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

// Seuls ces états décrivent un fait ; les incidents techniques (cooldown,
// session morte) ne se posent pas à la main, ils se corrigent en réessayant.
const MANUAL_STATES = ["new", "redeemed", "used", "expired", "invalid"];

// Un code non résolu : jamais échangé avec succès ni refusé définitivement.
const isPending = (c) => !["redeemed", "used", "expired", "invalid"].includes(c.status);

let codesReady = false;
let authWindowOpen = false;
let authPolling = false;

const HELP =
  "Un code toutes les 5 s : l'API refuse plus rapide.&#10;Les récompenses arrivent par courrier en jeu.&#10;Un refus « invalide » peut venir du serveur ; l'état est mémorisé pour ne pas le réessayer.&#10;Seuls les codes encore publiés par les sources restent listés.";

export const codes = {
  render() {
    return `
      <div class="panel codes-bar">
        <p id="codes-status" class="muted">Chargement des codes…</p>
        <div class="btn-row">
          <button class="btn-primary" id="codes-refresh-btn">Actualiser la liste</button>
          <button class="btn-ghost" id="codes-auth-btn">Autoriser l'échange</button>
          <button class="btn-ghost" id="codes-auth-done-btn" hidden>Vérifier la connexion</button>
          <button class="btn-ghost" id="codes-all-btn" hidden>Tout échanger</button>
          <span class="hint" tabindex="0" data-tip="${HELP}">?</span>
        </div>
        <p id="codes-auth-help" class="muted" hidden>
          L'échange direct demande d'autres cookies que la connexion HoYoLAB.
          « Autoriser l'échange » ouvre la page officielle HoYoverse ; la fenêtre se
          referme d'elle-même une fois la connexion faite. Sans cela, chaque code
          ouvre simplement cette page, prérempli.
        </p>
        <div class="input-row">
          <input id="code-input" class="text-input" placeholder="Saisir un code à la main" autocomplete="off" />
          <button class="btn-primary" id="code-add-btn">Échanger ce code</button>
        </div>
        <p id="codes-msg" class="muted"></p>
      </div>

      <div class="panel">
        <table class="data-table" id="codes-table">
          <thead><tr><th>Code</th><th>Récompenses</th><th>Mon état</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>`;
  },

  init() {
    $("#codes-refresh-btn").addEventListener("click", codesRefresh);
    $("#codes-auth-btn").addEventListener("click", codesAuthorize);
    $("#codes-auth-done-btn").addEventListener("click", codesAuthorizeDone);
    $("#codes-all-btn").addEventListener("click", redeemAll);
    $("#code-add-btn").addEventListener("click", redeemTyped);
    $("#code-input").addEventListener("keydown", (e) => { if (e.key === "Enter") redeemTyped(); });
    $("#codes-table tbody").addEventListener("click", redeemFromTable);
    $("#codes-table tbody").addEventListener("change", setCodeStatus);
    codesLoad();
  },
};

function statusSelect(c) {
  // L'état courant peut être un incident : on l'affiche sans le proposer.
  const options = MANUAL_STATES.includes(c.status) ? MANUAL_STATES : [c.status, ...MANUAL_STATES];
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
    : "Aucun code en mémoire : « Actualiser la liste » interroge les sources.";
  $("#codes-status").textContent = view.needs_account
    ? `${inventory} L'échange depuis l'app demande la connexion HoYoLAB du tableau de bord.`
    : inventory;

  const askAuth = view.needs_authorization && !view.needs_account;
  $("#codes-auth-btn").hidden = !askAuth;
  $("#codes-auth-help").hidden = !askAuth;
  $("#codes-auth-done-btn").hidden = !askAuth || !authWindowOpen;
  // Visible dès qu'il y a des codes à essayer ; désactivé tant que l'échange
  // n'est pas autorisé, avec une explication au survol.
  const allBtn = $("#codes-all-btn");
  allBtn.hidden = pending === 0;
  allBtn.disabled = !view.ready;
  allBtn.title = view.ready ? "" : "Autorise d'abord l'échange (bouton « Autoriser l'échange »).";
  // Le bouton doit annoncer ce qu'il fait : sans autorisation, il ouvre la
  // page officielle au lieu d'échanger.
  $("#code-add-btn").textContent = view.ready ? "Échanger ce code" : "Ouvrir la page pour ce code";

  $("#codes-table tbody").innerHTML = view.codes.length
    ? view.codes.map((c) => {
        // La fraîcheur intéresse ; la provenance non.
        const origin = c.last_seen ? `vu le ${esc(c.last_seen.slice(0, 10))}` : "saisi à la main";
        const action = isPending(c)
          ? `<button class="btn-ghost sm" data-code="${esc(c.code)}" data-action="${codesReady ? "redeem" : "open"}">
               ${codesReady ? "Échanger" : "Ouvrir la page"}</button>`
          : "";
        return `<tr>
            <td><code class="code">${esc(c.code)}</code><div class="muted">${origin}</div></td>
            <td class="muted">${esc(c.rewards) || "-"}</td>
            <td>${statusSelect(c)}
                ${c.message ? `<div class="muted">${esc(c.message)}</div>` : ""}</td>
            <td class="right">${action}</td>
          </tr>`;
      }).join("")
    : `<tr><td colspan="4" class="muted">Aucun code en mémoire.</td></tr>`;
}

async function setCodeStatus(event) {
  const select = event.target.closest("select[data-code]");
  if (!select) return;
  try {
    renderCodes(await invoke("codes_set_status", { code: select.dataset.code, status: select.value }));
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

// L'API limite le débit : le backend attend 5 s entre deux échanges.
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
