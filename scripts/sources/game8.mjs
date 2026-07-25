// Parser game8 : page de build d'un perso. Deux mises en page coexistent
// (table label→valeur, ou grille "cartes"). Pour être robuste aux deux, on
// extrait armes et sets en classant les liens <a> de la table via genshin-db ;
// stats principales et sous-stats sont lues dans le texte. Renvoie des builds
// bruts (noms anglais) ; la traduction/rareté se fait en aval.

import * as cheerio from "cheerio";
import { fetchHtml } from "../http.mjs";
import { matchWeapon, matchArtifact } from "../normalize.mjs";

const HOST = "https://game8.co";
const INDEX = "https://game8.co/games/Genshin-Impact/archives/296707"; // Liste de tous les persos.

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALIAS = { tartaglia: "childe" };
// Liens de navigation à ignorer avant classification.
const NAV = /^(weapons?|artifacts?|best|alternative|replacement|other|main|sub|stats?|skill|teams?|sample|talents?)\b/i;

// game8 abrège souvent les noms de famille ("Ayaka" pour "Kamisato Ayaka") :
// on tente le nom complet, un alias, puis chaque mot (le plus long d'abord).
function resolveUrl(idx, enName) {
  const full = norm(enName);
  if (idx[full]) return idx[full];
  if (ALIAS[full] && idx[ALIAS[full]]) return idx[ALIAS[full]];
  const words = enName.split(/\s+/).map(norm).filter((w) => w.length >= 3).sort((a, b) => b.length - a.length);
  for (const w of words) if (idx[w]) return idx[w];
  return null;
}

let indexCache = null;
async function index() {
  if (indexCache) return indexCache;
  indexCache = {};
  const html = await fetchHtml(INDEX);
  if (!html) return indexCache;
  const $ = cheerio.load(html);
  $('a[href*="/Genshin-Impact/archives/"]').each((_, a) => {
    const t = $(a).text().replace(/\s+/g, " ").trim();
    const h = $(a).attr("href");
    if (t && /^[A-Z][a-zA-Z .-]+$/.test(t) && t.length < 25 && !/List|Tier|Guide|Build|Best|All|Map/.test(t)) {
      const k = norm(t);
      if (!indexCache[k]) indexCache[k] = h.startsWith("http") ? h : HOST + h;
    }
  });
  return indexCache;
}

export async function fetchGame8(enName) {
  const idx = await index();
  const url = resolveUrl(idx, enName);
  if (!url) return null;
  const html = await fetchHtml(url);
  if (!html) return null;
  const $ = cheerio.load(html);
  const builds = [];

  $("h3").each((_, el) => {
    const title = $(el).text().trim();
    if (!/builds?/i.test(title)) return;
    // Deux formats de titre : "Furina DPS Builds" et "Support Builds for Gorou".
    const role = title
      .replace(new RegExp("\\bfor\\s+" + reEsc(enName) + "\\b.*$", "i"), "")
      .replace(new RegExp("\\b" + reEsc(enName) + "\\b", "gi"), "")
      .replace(/builds?/i, "")
      .replace(/\s+/g, " ").trim();
    if (!role) return;

    const table = nextTable($, el);
    if (!table) return;
    const { weapons, artifacts } = gear($, table);
    if (!weapons.length && !artifacts.length) return;

    const text = $(table).text();
    builds.push({
      role,
      weapons,
      artifacts,
      mainStats: {
        sands: statOptions(text, "Sands"),
        goblet: statOptions(text, "Goblet"),
        circlet: statOptions(text, "Circlet"),
      },
      subStats: subStats(text),
    });
  });

  return builds.length ? builds : null;
}

// Classe les liens de la table en armes / sets (via genshin-db), dans l'ordre
// d'apparition (= priorité), sans doublon. Robuste aux deux mises en page.
function gear($, table) {
  const weapons = [], artifacts = [], seen = new Set();
  $(table).find("a").each((_, a) => {
    const t = $(a).text().replace(/\s+/g, " ").trim();
    if (t.length < 3 || NAV.test(t)) return;
    const w = matchWeapon(t);
    if (w) { if (!seen.has(w)) { seen.add(w); weapons.push(t); } return; }
    const s = matchArtifact(t);
    if (s && !seen.has(s)) { seen.add(s); artifacts.push(t); }
  });
  return { weapons, artifacts };
}

// Première <table> après un élément (game8 intercale parfois un wrapper).
function nextTable($, el) {
  let n = $(el).next();
  for (let i = 0; i < 6 && n.length; i++) {
    if (n.is("table")) return n;
    const inner = n.find("table").first();
    if (inner.length) return inner;
    n = n.next();
  }
  return null;
}

// Extrait la ligne d'un slot ("Sands: HP% or Energy Recharge") → options.
function statOptions(tableText, slot) {
  const t = tableText.replace(/\s+/g, " ");
  const m = t.match(new RegExp(slot + "\\s*:\\s*(.+?)(?=\\s*(?:Sands|Goblet|Circlet|Artifact|Sample|Best Weapon)\\s*:?|$)", "i"));
  if (!m) return [];
  return m[1].split(/\s+or\s+|,/i).map((s) => s.trim()).filter(Boolean);
}

// Sous-stats : "... Sub Stats: Energy Recharge, CRIT DMG, …".
function subStats(tableText) {
  const t = tableText.replace(/\s+/g, " ");
  const m = t.match(/Sub-?\s?Stats?\s*:?\s*(.+?)(?=\s*(?:Sample|Best|Talent|Notes?|$))/i);
  if (!m) return [];
  return m[1].split(/,|>|›/).map((s) => s.trim()).filter((s) => s && s.length < 30);
}
