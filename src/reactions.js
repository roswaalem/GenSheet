// Réactions élémentaires, résonances et archétypes d'équipe.
//
// Seule source de vérité sur le sujet : le générateur de données (scripts/)
// l'importe pour nommer les équipes scrapées, et le composeur pour noter les
// équipes qu'il invente. Les poids traduisent l'intérêt d'une réaction dans une
// composition, pas les multiplicateurs du jeu.

export const ELEMENT_LABEL = {
  anemo: "Anémo", cryo: "Cryo", dendro: "Dendro", electro: "Électro",
  geo: "Géo", hydro: "Hydro", pyro: "Pyro",
};

// Réactions à deux éléments.
const PAIRS = [
  [["pyro", "hydro"], "vaporisation", 10],
  [["pyro", "cryo"], "fonte", 9],
  [["electro", "dendro"], "aggravation", 9],
  [["hydro", "cryo"], "gel", 8],
  [["hydro", "dendro"], "floraison", 7],
  [["electro", "hydro"], "electro-affecte", 6],
  [["electro", "pyro"], "surcharge", 5],
  [["pyro", "dendro"], "combustion", 4],
];

// Réactions à trois éléments : elles priment sur les paires qu'elles contiennent.
const TRIPLES = [
  [["dendro", "hydro", "electro"], "hyperfloraison", 12],
  [["dendro", "hydro", "pyro"], "eclosion", 10],
];

export const ARCHETYPE_LABEL = {
  vaporisation: "Vaporisation",
  fonte: "Fonte",
  gel: "Gel",
  aggravation: "Aggravation",
  floraison: "Floraison",
  "floraison-lunaire": "Floraison lunaire",
  hyperfloraison: "Hyperfloraison",
  eclosion: "Éclosion",
  "electro-affecte": "Électro-affecté",
  surcharge: "Surcharge",
  combustion: "Combustion",
  cristallisation: "Cristallisation",
  diffusion: "Diffusion",
  "mono-element": "Mono-élément",
  physique: "Physique",
  plongeon: "Plongeon",
  hypercarry: "Hypercarry",
  polyvalente: "Polyvalente",
};

export const RESONANCE = {
  pyro: "+25 % ATQ",
  cryo: "+15 % Taux Crit sur cibles gelées",
  hydro: "+25 % PV max, soins renforcés",
  dendro: "+50 maîtrise élémentaire, plus sur réaction",
  electro: "Particules et recharge d'énergie",
  geo: "Bouclier, DGT et réduction de RÉS",
  anemo: "Endurance, vitesse et temps de recharge",
};

/** Réactions accessibles à une équipe, de la plus intéressante à la moins. */
export function teamReactions(elements) {
  const set = new Set(elements);
  const out = [];
  for (const [needed, key, weight] of TRIPLES) {
    if (needed.every((e) => set.has(e))) out.push({ key, weight, elements: needed });
  }
  const covered = new Set(out.flatMap((r) => r.elements));
  for (const [[a, b], key, weight] of PAIRS) {
    if (!set.has(a) || !set.has(b)) continue;
    // Une paire déjà consommée par une réaction à trois éléments compte moins.
    const partial = covered.has(a) && covered.has(b);
    out.push({ key, weight: partial ? Math.round(weight / 2) : weight, elements: [a, b] });
  }
  return out.sort((x, y) => y.weight - x.weight);
}

/** Archétype d'une équipe, du point de vue de l'élément de son porteur. */
export function teamArchetype(elements, mainElement) {
  const reactions = teamReactions(elements);
  const own = reactions.find((r) => r.elements.includes(mainElement));
  if (own) return own.key;

  // Le porteur ne déclenche aucune réaction : son propre élément qualifie mieux
  // l'équipe que ce que ses soutiens entretiennent entre eux.
  if (mainElement === "geo") return "cristallisation";
  if (mainElement === "anemo") return "diffusion";
  if (reactions.length) return reactions[0].key;

  const counts = {};
  for (const e of elements) counts[e] = (counts[e] ?? 0) + 1;
  if (Object.values(counts).some((n) => n >= 3)) return "mono-element";
  return "polyvalente";
}

/** Éléments présents au moins deux fois : résonance active. */
export function resonances(elements) {
  const counts = {};
  for (const e of elements) counts[e] = (counts[e] ?? 0) + 1;
  return Object.keys(counts)
    .filter((e) => counts[e] >= 2 && RESONANCE[e])
    .map((e) => ({ element: e, label: ELEMENT_LABEL[e], effect: RESONANCE[e] }));
}
