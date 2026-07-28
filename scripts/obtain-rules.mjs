// Classification de la provenance d'une arme, partagée par les sources.
//
// Chaque source formule à sa façon (« Wish on the Weapon Banner » d'un côté,
// « Weapon Event Wishes » de l'autre) : la table ci-dessous ramène les deux au
// même vocabulaire, celui affiché dans l'app. Aucun texte d'origine n'est
// conservé : seule la catégorie l'est.

// Du plus précis au plus général : la première règle qui correspond gagne.
// L'ordre compte : « Purchase the Gnostic Hymn » relève du passe de combat et
// non de la boutique, et l'échange de poissons n'est pas un achat ordinaire.
const RULES = [
  [/gnostic hymn|battle ?pass/i, "Passe de combat"],
  [/craft|forg|blacksmith|billet/i, "Fabrication"],
  [/fish/i, "Pêche"],
  [/reputation/i, "Réputation"],
  // Les bannières passent avant « event » : le wiki écrit « Weapon Event
  // Wishes », qui relève de la bannière d'arme et non d'un événement.
  [/epitome invocation|weapon (event )?(banner|wish)/i, "Bannière d'arme"],
  // « Pull on Any Wish Banner » : l'arme est dans le lot permanent.
  [/any (active |wish )?banner|standard.{0,20}(wish|banner)|wanderlust/i, "Bannière permanente"],
  [/character (event )?(banner|wish)/i, "Bannière de personnage"],
  [/event/i, "Événement"],
  [/starglitter|stardust|paimon's bargains|souvenir|shop|purchase|buy/i, "Boutique"],
  [/quest|archon|story/i, "Quête"],
  [/chest|treasure|exploration|puzzle/i, "Coffre"],
  [/adventure rank|reward|mail|free/i, "Récompense"],
];

/** Catégorie déduite d'un texte, ou `null` si aucune règle ne s'applique. */
export function classify(text) {
  const hit = RULES.find(([re]) => re.test(String(text ?? "")));
  return hit ? hit[1] : null;
}
