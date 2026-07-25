// Normalisation des noms scrapés (anglais, variables d'un site à l'autre) vers
// une forme canonique + nom français + rareté, via genshin-db. La clé stable
// (`id` genshin-db) sert à dédupliquer un même objet entre sources.

import genshindb from "genshin-db";

const FR = genshindb.Languages.French;
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

const unresolved = new Set();
export const unresolvedNames = () => [...unresolved];

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
  if (!w) { unresolved.add(`arme:${n}`); return { key: `?w:${n}`, name: n, rarity: 0, icon: "" }; }
  return { key: `w${w.id}`, name: w.name, rarity: w.rarity, icon: w.images?.mihoyo_icon || "" };
}

export function frArtifact(name) {
  const n = clean(name);
  const a = genshindb.artifacts(n, { resultLanguage: FR, matchAliases: true });
  if (!a) { unresolved.add(`set:${n}`); return { key: `?a:${n}`, name: n, rarity: 0, icon: "" }; }
  // La fleur représente le set (les icônes sont par pièce).
  return { key: `a${a.id}`, name: a.name, rarity: Math.max(...(a.rarityList || [0])), icon: a.images?.flower || "" };
}
