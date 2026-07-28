// Roster de référence pour les scrapers : id de jeu, noms EN/FR, élément.
// Les sites abrègent les noms ("Ayaka" pour Kamisato Ayaka, "Raiden" pour
// Raiden Shogun) : `resolve()` ramène un texte libre vers un id de personnage,
// ou null si le texte ne désigne personne (slot « Flex », « Healer »…).
// Appeler `loadRoster()` une fois avant d'utiliser `resolve()`.

const AMBR = (lang) => `https://gi.yatta.moe/api/v2/${lang}/avatar`;
const ASSETS = "https://gi.yatta.moe/assets/UI";

const ELEMENTS = {
  Wind: "anemo", Ice: "cryo", Grass: "dendro", Electric: "electro",
  Rock: "geo", Water: "hydro", Fire: "pyro",
};

// Noms qu'aucune règle de découpage ne rattacherait au bon personnage.
const ALIAS = { childe: "tartaglia", scaramouche: "wanderer", kunikuzushi: "wanderer" };

// Le Voyageur existe en six éléments sous deux ids (garçon/fille) : on garde un
// id composite par élément, et l'app retrouve l'icône via la partie numérique.
const TRAVELER_ID = "10000005";

export const norm = (s) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

let chars = null;   // Map id → { id, en, fr, element, rarity, icon }
let index = null;   // { full: Map nom → id, words: Map mot → id }

/** Charge le roster depuis Ambr et prépare l'index de résolution. */
export async function loadRoster() {
  if (chars) return chars;
  const [en, fr] = await Promise.all([
    fetch(AMBR("en")).then((r) => r.json()),
    fetch(AMBR("fr")).then((r) => r.json()),
  ]);
  const frNames = Object.fromEntries(
    Object.entries(fr.data.items).map(([k, v]) => [k, v.name])
  );

  chars = new Map();
  for (const [key, v] of Object.entries(en.data.items)) {
    const element = ELEMENTS[v.element] ?? "autre";
    const traveler = v.name === "Traveler";
    if (traveler && !key.startsWith(TRAVELER_ID)) continue;
    const id = traveler ? `${TRAVELER_ID}-${element}` : key.split("-")[0];
    if (chars.has(id)) continue;
    chars.set(id, {
      id,
      en: traveler ? `${cap(element)} Traveler` : v.name,
      fr: traveler ? `Voyageur ${cap(element)}` : frNames[key] ?? v.name,
      element,
      rarity: v.rank,
      icon: `${ASSETS}/${v.icon}.png`,
    });
  }
  buildIndex();
  return chars;
}

export const rosterChars = () => chars;

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// --- Résolution des noms ----------------------------------------------------

function buildIndex() {
  const full = new Map();
  const words = new Map();
  const ambiguous = new Set();

  for (const c of chars.values()) {
    if (c.id.startsWith(TRAVELER_ID)) continue; // traité par `resolve`
    for (const name of [c.en, c.fr]) {
      full.set(norm(name), c.id);
      for (const w of String(name).split(/\s+/)) {
        const k = norm(w);
        if (k.length < 3) continue;
        if (words.has(k) && words.get(k) !== c.id) ambiguous.add(k);
        else words.set(k, c.id);
      }
    }
  }
  for (const k of ambiguous) words.delete(k);
  index = { full, words };
}

const ELEMENT_WORDS = /\b(anemo|cryo|dendro|electro|geo|hydro|pyro)\b/i;

/** Texte libre → id de personnage, ou null. */
export function resolve(text) {
  const raw = String(text ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!raw || !index) return null;

  if (/\b(traveler|mc|voyageur)\b/i.test(raw)) {
    const m = raw.match(ELEMENT_WORDS);
    return m && chars.has(`${TRAVELER_ID}-${m[1].toLowerCase()}`) ? `${TRAVELER_ID}-${m[1].toLowerCase()}` : null;
  }

  const key = norm(raw);
  if (index.full.has(key)) return index.full.get(key);
  if (ALIAS[key] && index.full.has(ALIAS[key])) return index.full.get(ALIAS[key]);

  // Nom partiel : on tente chaque mot, le plus discriminant d'abord.
  const parts = raw.split(/\s+/).map(norm).filter((w) => w.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const w of parts) if (index.words.has(w)) return index.words.get(w);
  return null;
}
