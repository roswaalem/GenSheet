// Provenance des armes d'après le wiki Fandom.
//
// Source factuelle et structurée : l'infobox porte un champ « obtain » explicite
// (« Weapon Event Wishes », « Forging », « Chest »…), là où un guide se contente
// d'une phrase rédigée. Elle sert de source principale, game8 de complément.

import { fetchHtml } from "../http.mjs";
import { classify } from "../obtain-rules.mjs";

const API = "https://genshin-impact.fandom.com/api.php";

/** Catégorie de provenance d'une arme, ou `[]` si le wiki ne la donne pas. */
export async function fetchWeaponObtain(enName) {
  const url =
    `${API}?action=parse&page=${encodeURIComponent(enName)}` +
    "&prop=wikitext&format=json&redirects=1";
  const raw = await fetchHtml(url);
  if (!raw) return [];

  let wikitext = "";
  try {
    wikitext = JSON.parse(raw)?.parse?.wikitext?.["*"] ?? "";
  } catch {
    return [];
  }

  // « |obtain = Weapon Event Wishes », une ligne de l'infobox.
  const field = wikitext.match(/\|\s*obtain\s*=\s*([^\n|]+)/i);
  if (!field) return [];

  const label = classify(field[1]);
  return label ? [label] : [];
}
