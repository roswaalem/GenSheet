// Ponts partagés entre le shell et les pages.

// Hors Tauri (aperçu navigateur), `invoke` lève simplement : le shell s'affiche
// quand même, seuls les appels backend échouent (et sont déjà try/catch).
export const invoke =
  window.__TAURI__?.core?.invoke ??
  (async () => { throw new Error("Backend Tauri indisponible."); });

export const $ = (sel, root = document) => root.querySelector(sel);

// Les chaînes venues de l'API finissent en innerHTML : on les échappe.
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
