// Normalisation des noms scrapés (anglais, variables d'un site à l'autre) vers
// une forme canonique + nom français + rareté, via genshin-db. La clé stable
// (`id` genshin-db) sert à dédupliquer un même objet entre sources.

import genshindb from "genshin-db";

const FR = genshindb.Languages.French;
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

const unresolved = new Set();
export const unresolvedNames = () => [...unresolved];

// Les icônes viennent d'Ambr, comme les portraits de personnages : le CDN
// HoYoLAB renvoie 404 sur les sorties récentes, et genshin-db n'expose plus
// d'URL directe pour les nouveaux sets (seule la clé « filename_ » subsiste).
// Armes et reliques ne sont pas servies sous le même chemin.
const AMBR_UI = "https://gi.yatta.moe/assets/UI";
const weaponIcon = (file) => (file ? `${AMBR_UI}/${file}.png` : "");
const relicIcon = (file) => (file ? `${AMBR_UI}/reliquary/${file}.png` : "");

// La fleur représente le set, sauf pour les quatre sets « Prières » qui se
// réduisent à une couronne : d'où le repli sur la première pièce disponible.
const RELIC_PIECES = ["filename_flower", "filename_plume", "filename_sands", "filename_goblet", "filename_circlet"];
const relicFile = (images) => RELIC_PIECES.map((k) => images?.[k]).find(Boolean);

// Matchers stricts (renvoient la clé canonique ou null) : servent à classer un
// texte de lien en arme / set sans fabriquer de valeur de repli.
export function matchWeapon(name) {
  const w = genshindb.weapons(clean(name), { matchAliases: true });
  return w ? `w${w.id}` : null;
}
export function matchArtifact(name) {
  const a = genshindb.artifacts(clean(name), { matchAliases: true });
  return a ? `a${a.id}` : null;
}

export function frWeapon(name) {
  const n = clean(name);
  const w = genshindb.weapons(n, { resultLanguage: FR, matchAliases: true });
  if (!w) { unresolved.add(`arme:${n}`); return { key: `?w:${n}`, id: null, name: n, rarity: 0, icon: "" }; }
  // `id` est celui du jeu, partagé avec Ambr : il ouvre la fiche de l'arme.
  return { key: `w${w.id}`, id: w.id, name: w.name, rarity: w.rarity, icon: weaponIcon(w.images?.filename_icon) };
}

export function frArtifact(name) {
  const n = clean(name);
  const a = genshindb.artifacts(n, { resultLanguage: FR, matchAliases: true });
  if (!a) { unresolved.add(`set:${n}`); return { key: `?a:${n}`, id: null, name: n, rarity: 0, icon: "" }; }
  return {
    key: `a${a.id}`,
    id: a.id,
    name: a.name,
    rarity: Math.max(...(a.rarityList || [0])),
    icon: relicIcon(relicFile(a.images)),
  };
}
