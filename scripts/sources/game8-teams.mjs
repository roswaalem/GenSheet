// Parser game8 pour les équipes et la tier list.
//
// Deux gisements (les capacités viennent désormais des descriptions de
// talents, côté Ambr, voir sources/ambr-abilities.mjs) :
//  - la tier list (rang SS→C par personnage ET par rôle, lu dans les `alt`) ;
//  - l'article « Best Team Comps », qui liste 2 à 4 équipes pour tout le roster ;
//  - la section « Best Team Comps » de chaque page de personnage, plus fournie
//    et rangée par archétype (Freeze, Bloom, Vaporize…).
//
// Une équipe est une table dont la 1re ligne donne les rôles (« Main DPS »,
// « Sub-DPS/Support »…) et dont chaque ligne suivante aligne 4 personnages.

import * as cheerio from "cheerio";
import { fetchHtml } from "../http.mjs";
import { characterUrl } from "./game8.mjs";

const TIER_LIST = "https://game8.co/games/Genshin-Impact/archives/297465";
const ALL_TEAMS = "https://game8.co/games/Genshin-Impact/archives/301819";

const txt = ($, el) => $(el).text().replace(/\s+/g, " ").trim();
const ROLE_RE = /dps|support|flex|healer|buffer|shield/i;

// --- Tier list --------------------------------------------------------------

/** [{ name, role, tier }] : le rang d'un personnage dans un rôle donné. */
export async function fetchTiers() {
  const html = await fetchHtml(TIER_LIST);
  if (!html) return [];
  const $ = cheerio.load(html);
  const out = [];

  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    const head = $(rows[0]).find("th,td").map((_, c) => txt($, c)).get();
    // En-tête attendu : une colonne vide (le tier) puis les trois rôles.
    if (head.length !== 4 || !head.slice(1).every((h) => ROLE_RE.test(h))) return;

    rows.slice(1).each((_, tr) => {
      const cells = $(tr).find("th,td");
      const tier = ($(cells[0]).find("img").attr("alt") || "").replace(/\s*tier\s*/i, "").trim();
      if (!tier) return;
      cells.slice(1).each((i, cell) => {
        $(cell).find("img").each((_, img) => {
          const name = characterFromAlt($(img).attr("alt"));
          if (name) out.push({ name, role: head[i + 1], tier });
        });
      });
    });
  });
  return out;
}

// « Genshin - Kamisato Ayaka DPS Rank » → « Kamisato Ayaka ».
function characterFromAlt(alt) {
  const m = String(alt ?? "").match(/^Genshin\s*-\s*(.+?)\s+(?:Main[\s-]?)?(?:Sub[\s-]?)?(?:DPS|Support)\s+Rank$/i);
  return m ? m[1].trim() : null;
}

// --- Équipes ----------------------------------------------------------------

/** Équipes de l'article global, pour tout le roster. */
export async function fetchAllTeams() {
  const html = await fetchHtml(ALL_TEAMS);
  if (!html) return [];
  const $ = cheerio.load(html);
  return teamsUnder($, $("body"));
}

/** Équipes de la page d'un personnage, rangées par archétype. */
export async function fetchCharacterTeams(enName) {
  const url = await characterUrl(enName);
  if (!url) return [];
  const html = await fetchHtml(url);
  if (!html) return [];
  const $ = cheerio.load(html);
  const h2 = $("h2").filter((_, el) => /team comps?/i.test(txt($, el))).first();
  if (!h2.length) return [];

  const teams = [];
  let n = h2.next();
  let heading = "";
  for (let i = 0; i < 80 && n.length && !n.is("h2"); i++) {
    if (n.is("h3, h4")) heading = txt($, n);
    else {
      const table = n.is("table") ? n : n.find("table").first();
      if (table.length) teams.push(...fromTable($, table, archetype(heading)));
    }
    n = n.next();
  }
  return teams;
}

// Parcourt un conteneur en suivant les titres pour nommer chaque archétype.
function teamsUnder($, root) {
  const teams = [];
  let heading = "";
  $(root).find("h2, h3, h4, table").each((_, el) => {
    if (el.tagName === "table") teams.push(...fromTable($, $(el), archetype(heading)));
    else heading = txt($, el);
  });
  return teams;
}

// « Furina Freeze Teams » → « Furina Freeze ». Les noms des membres seront
// retirés à l'agrégation, où l'on sait qui compose l'équipe.
function archetype(heading) {
  return String(heading ?? "")
    .replace(/\bbest\b|\bteams?\b|\bcomps?\b|\bparty\b|\bsetup\b|\bfor\b|\bin\b/gi, " ")
    .replace(/[- :  : ]/g, " ").replace(/\s+/g, " ").trim();
}

// Une table d'équipes → [{ archetype, slots: [{ name, role }] }].
function fromTable($, table, arch) {
  const rows = $(table).find("tr");
  const head = $(rows[0]).find("th,td").map((_, c) => txt($, c)).get();
  if (head.length < 3 || head.length > 4) return [];
  if (!head.every((h) => ROLE_RE.test(h))) return [];

  const teams = [];
  rows.slice(1).each((_, tr) => {
    const cells = $(tr).find("th,td");
    if (cells.length !== head.length) return;
    const slots = cells.map((i, cell) => {
      const link = $(cell).find("a").first();
      const name = txt($, link.length ? link : cell);
      return name ? { name, role: head[i] } : null;
    }).get().filter(Boolean);
    if (slots.length === head.length) teams.push({ archetype: arch, slots });
  });
  return teams;
}
