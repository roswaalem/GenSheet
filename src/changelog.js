// Notes de version affichées dans la pop-up « Quoi de neuf » au premier
// lancement après une mise à jour.
//
// À CHAQUE release : ajoute une entrée EN TÊTE de la liste, avec `version` égale
// à celle de package.json. C'est le seul endroit à toucher pour les notes.
// La plus récente est en premier.

export const CHANGELOG = [
  {
    version: "0.1.5",
    changes: [
      "Armes : nouvelle page. Catalogue filtrable par type et par rareté, fiche détaillée avec le passif à chaque raffinement, provenance de l'arme, et personnages qui en tirent le meilleur parti avec un rang par association.",
      "Fiches personnages : les armes recommandées ouvrent maintenant leur fiche. Les artéfacts équipés ont été redessinés et affichent leur image.",
      "Personnages : le Voyageur apparaît par élément, avec un bouton pour regrouper ses variantes sous une seule carte.",
      "Tableau de bord : onglet « Toutes » regroupant les bannières, tirages restants avant le 5★ garanti et avant celui en vedette, barre de progression du pity, et explications au survol de chaque statistique.",
      "Équipes : deux équipes par ligne, et les personnages y sont cliquables.",
      "Corrections : icônes d'armes et d'artéfacts manquantes, onglet « Tous les personnages » qui restait vide, élément du Voyageur incorrect, infobulles coupées près du bord, informations de soin et de bouclier plus fiables.",
    ],
  },
  {
    version: "0.1.4",
    changes: [
      "Carte interactive : Ajout de barre de recherche et animations. Agrandissement des points d'intérêts sur la carte, et détails affichés au survol.",
    ],
  },
  {
    version: "0.1.3",
    changes: [
      "Carte interactive : Teyvat et sous-mondes (Enkanomiya, Mines du Gouffre…), plein écran, filtres de catégories mémorisés, suivi des points récupérés + import/export.",
      "Fiches personnages : rôles clarifiés (Main DPS / Sub-DPS / Support).",
      "Pop-up « Quoi de neuf » après chaque mise à jour.",
    ],
  },
  {
    version: "0.1.2",
    changes: [
      "Fiches personnages : builds recommandés multi-rôles (armes, artéfacts, statistiques) agrégés depuis plusieurs guides.",
      "Matériaux d'ascension : choix de la plage de niveaux à afficher.",
      "Corrections et améliorations diverses.",
    ],
  },
];
