// Provenance des armes, lue sur game8 puis reformulée en catégories.
//
// Rien du texte source n'est conservé : la page sert seulement à décider de
// quelle catégorie relève l'arme (bannière, fabrication, boutique…). L'index
// nom → URL vient des trois listes par rareté, qui portent déjà les liens.

import * as cheerio from "cheerio";
import { fetchHtml } from "../http.mjs";
import { classify } from "../obtain-rules.mjs";

const HOST = "https://game8.co";
const LISTS = [
  "https://game8.co/games/Genshin-Impact/archives/304647", // 5★
  "https://game8.co/games/Genshin-Impact/archives/304730", // 4★
  "https://game8.co/games/Genshin-Impact/archives/304748", // 3★
];

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const reEsc = (s) => String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const txt = ($, el) => $(el).text().replace(/\s+/g, " ").trim();

let indexCache = null;

/** Index nom anglais normalisé → URL de la page game8 de l'arme. */
async function index() {
  if (indexCache) return indexCache;
  indexCache = {};
  for (const url of LISTS) {
    const html = await fetchHtml(url);
    if (!html) continue;
    const $ = cheerio.load(html);
    $("table tr").each((_, tr) => {
      const a = $(tr).find('a[href*="/Genshin-Impact/archives/"]').first();
      const name = txt($, a);
      const href = a.attr("href");
      if (!name || !href) return;
      const key = norm(name);
      if (key && !indexCache[key]) indexCache[key] = href.startsWith("http") ? href : HOST + href;
    });
  }
  return indexCache;
}

/**
 * Catégories de provenance d'une arme, vide si la page est introuvable ou
 * qu'aucune règle ne s'applique.
 */
export async function fetchWeaponObtain(enName) {
  const url = (await index())[norm(enName)];
  if (!url) return [];
  const html = await fetchHtml(url);
  if (!html) return [];
  const $ = cheerio.load(html);

  // On privilégie le titre nommant l'arme : la page porte aussi des « How to
  // Get » annexes (billets, matériaux) et un sommaire qui les répète tous.
  const generic = /how to (?:get|obtain)/i;
  const wanted = new RegExp(`how to (?:get|obtain).{0,20}${reEsc(enName)}`, "i");
  // La page est déjà celle de l'arme : à défaut d'un titre la nommant (game8
  // varie les formulations), la première section « How to Get » est la sienne.
  const titles = $("h2,h3").toArray();
  const exact = titles.filter((el) => wanted.test(txt($, el)));
  const chosen = exact.length ? exact : titles.filter((el) => generic.test(txt($, el))).slice(0, 1);

  let text = "";
  chosen.forEach((el) => {
    // game8 répond dans les sous-titres de la section (« Wish on the Weapon
    // Banner… », « Get from a Chest… »). Une arme peut en avoir plusieurs : on
    // les prend tous, la priorité des règles tranchant ensuite. Les paragraphes
    // digressent et brouillent la classification, ils ne servent que de repli.
    let fallback = "";
    let node = $(el).next();
    while (node.length && node[0].name !== "h2") {
      const value = txt($, node);
      if (value && node[0].name === "h3") text += " " + value;
      else if (value && !fallback && node[0].name === "p") fallback = value;
      node = node.next();
    }
    if (!text.trim()) text = fallback;
  });
  if (!text.trim()) return [];

  const label = classify(text);
  return label ? [label] : [];
}
