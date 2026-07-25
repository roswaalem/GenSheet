// Traduction FR des libellés de stats/talents scrapés, par remplacement de
// tokens : composés ("CRIT Rate / DMG"), opérateurs et notes passent ; un
// terme inconnu reste tel quel.

const ELEM = {
  Anemo: "Anémo", Cryo: "Cryo", Dendro: "Dendro", Electro: "Électro",
  Geo: "Géo", Hydro: "Hydro", Pyro: "Pyro", Physical: "physiques",
};

export function frStat(s) {
  let x = String(s || "").replace(/\s+/g, " ").trim();
  if (!x) return x;
  // "Hydro DMG Bonus" / "Pyro DMG" → "Bonus DGT Hydro" (réordonné).
  x = x.replace(/\b(Anemo|Cryo|Dendro|Electro|Geo|Hydro|Pyro|Physical)\s+DMG(\s+Bonus)?\b/gi,
    (_, e, b) => (b ? "Bonus DGT " : "DGT ") + ELEM[cap(e)]);
  const map = [
    [/Elemental Mastery/gi, "Maîtrise élém."],
    [/Energy Recharge/gi, "Recharge d'énergie"],
    [/\bER%/g, "Recharge d'énergie"], [/\bER\b/g, "Recharge d'énergie"],
    [/Healing Bonus/gi, "Bonus de soins"],
    [/CRIT Rate/gi, "Taux Crit"],
    [/CRIT DMG/gi, "DGT Crit"],
    [/\bCRIT\b/gi, "Crit"],
    [/Normal Attack/gi, "Attaque normale"],
    [/Flat ATK/gi, "ATQ fixe"], [/Flat HP/gi, "PV fixes"], [/Flat DEF/gi, "DÉF fixe"],
    [/\bBurst\b/gi, "Déchaînement"], [/\bSkill\b/gi, "Compétence"],
    [/\bATK\b/gi, "ATQ"], [/\bHP\b/gi, "PV"], [/\bDEF\b/gi, "DÉF"],
    [/\bEM\b/g, "Maîtrise élém."],
    [/\bDMG\b/gi, "DGT"], [/Damage/gi, "DGT"],
  ];
  for (const [re, fr] of map) x = x.replace(re, fr);
  return x;
}

const cap = (w) => w[0].toUpperCase() + w.slice(1).toLowerCase();
