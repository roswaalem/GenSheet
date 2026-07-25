// Notes de version affichées dans la pop-up « Quoi de neuf » au premier
// lancement après une mise à jour.
//
// À CHAQUE release : ajoute une entrée EN TÊTE de la liste, avec `version` égale
// à celle de package.json. C'est le seul endroit à toucher pour les notes.
// La plus récente est en premier.

export const CHANGELOG = [
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
