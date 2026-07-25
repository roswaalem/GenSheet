// Parser KQM (keqingmains.com quick guides). Pages à slug :
// /q/<slug>-quickguide/. Structure : sections h1 "Weapons" / "Artifacts"
// (tables, 1re cellule = nom), rôle dans "Playstyles", stats dans la table
// "Artifact Stats" + une ligne "Stat Priority". Pas de liens vers les objets,
// donc on lit la 1re cellule des tables et on valide via genshin-db.

import * as cheerio from "cheerio";
import { fetchHtml } from "../http.mjs";
import { matchWeapon, matchArtifact } from "../normalize.mjs";

const BASE = "https://keqingmains.com/q/";
const ALIAS = { tartaglia: "childe", "raiden shogun": "raiden", "hu tao": "hu-tao" };

function slugs(enName) {
  const base = (s) => s.toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const out = [base(enName)];
  const alias = ALIAS[enName.toLowerCase()];
  if (alias) out.unshift(base(alias));
  const words = enName.split(/\s+/);
  if (words.length > 1) out.push(base(words[words.length - 1])); // nom court (Ayaka)
  return [...new Set(out)];
}

export async function fetchKqm(enName) {
  let $ = null;
  for (const s of slugs(enName)) {
    const html = await fetchHtml(`${BASE}${s}-quickguide/`);
    if (html) { $ = cheerio.load(html); break; }
  }
  if (!$) return null;

  // Certaines fiches préfixent par la rareté ("5★ …") et listent "A / B / C".
  const clean = (t) => t.replace(/^\s*\d+\s*★\s*/, "").replace(/^\d\s*pc\s*/i, "").replace(/\([^)]*\)/g, "").replace(/[’]/g, "'").trim();
  const cells = (label, tags) => tableFirstCells($, sectionTable($, label, tags)).flatMap((t) => clean(t).split(/\s*\/\s*/)).map((s) => s.trim()).filter(Boolean);

  const weapons = cells(/^Weapons$/i, "h1").filter((t) => matchWeapon(t));
  const artifacts = cells(/^Artifact Sets$/i, "h1, h2").filter((t) => matchArtifact(t));

  if (!weapons.length && !artifacts.length) return null;

  const role = firstText($, $("h2").filter((_, el) => /^Playstyles$/i.test($(el).text().trim())).first(), "h4") || "DPS";
  const stats = statsTable($, sectionTable($, /^Artifact Stats$/i, "h1, h2"));

  return [{
    role,
    weapons,
    artifacts,
    mainStats: stats,
    subStats: statPriority($),
  }];
}

// Première table sous la section, en s'arrêtant au prochain titre de rang ≤
// (la table peut être imbriquée sous une h2 de la section, ex. "Weapons").
function sectionTable($, reLabel, headings) {
  const h = $(headings).filter((_, el) => reLabel.test($(el).text().replace(/\s+/g, " ").trim())).first();
  if (!h.length) return null;
  const stop = h.prop("tagName").toLowerCase() === "h1" ? "h1" : "h1, h2";
  let n = h.next();
  for (let i = 0; i < 20 && n.length && !n.is(stop); i++) {
    if (n.is("table")) return n;
    const inner = n.find("table").first();
    if (inner.length) return inner;
    n = n.next();
  }
  return null;
}

const tableFirstCells = ($, table) => table
  ? $(table).find("tr").map((_, tr) => $(tr).find("th,td").first().text().replace(/\s+/g, " ").trim()).get().filter(Boolean)
  : [];

// Premier <h4> (ou balise) sous un titre de section.
function firstText($, h, tag) {
  if (!h.length) return "";
  let n = h.next();
  for (let i = 0; i < 12 && n.length && !n.is("h2"); i++) {
    if (n.is(tag)) return n.text().replace(/\s+/g, " ").trim();
    const inner = n.find(tag).first();
    if (inner.length) return inner.text().replace(/\s+/g, " ").trim();
    n = n.next();
  }
  return "";
}

// Table "Artifact Stats" : en-têtes Sands/Goblet/Circlet + ligne de valeurs.
function statsTable($, table) {
  const empty = { sands: [], goblet: [], circlet: [] };
  if (!table) return empty;
  const rows = $(table).find("tr");
  if (rows.length < 2) return empty;
  const head = $(rows[0]).find("th,td").map((_, c) => $(c).text().toLowerCase().trim()).get();
  const vals = $(rows[1]).find("th,td").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
  const opts = (v) => (v || "").split(/\s+or\s+|>|=|,/i).map((s) => s.trim()).filter(Boolean);
  const out = { ...empty };
  head.forEach((h, i) => {
    if (/sands/.test(h)) out.sands = opts(vals[i]);
    else if (/goblet/.test(h)) out.goblet = opts(vals[i]);
    else if (/circlet/.test(h)) out.circlet = opts(vals[i]);
  });
  return out;
}

// "Stat Priority: ER > CRIT DMG = CRIT Rate > HP%".
function statPriority($) {
  let line = "";
  $("p, li, td").each((_, el) => {
    if (line) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (/^Stat Priority\s*:/i.test(t)) line = t;
  });
  const m = line.match(/Stat Priority\s*:\s*(.+?)(?=[.]|$)/i);
  if (!m) return [];
  return m[1].split(/>|=|,/).map((s) => s.replace(/\([^)]*\)/g, "").trim()).filter((s) => s && s.length < 26);
}
