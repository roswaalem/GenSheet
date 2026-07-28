//! Page Feuille de route : aide-mémoire de conception (état des écrans).
//! Outil de suivi interne, à retirer de la version publiée.

// status : done | wip | todo
const GROUPS = [
  {
    title: "Fait",
    items: [
      ["Shell, thème & navigation", "done", "Fond nébuleuse, sidebar groupée, 16 écrans."],
      ["Tableau de bord", "done", "Compte, vœux, analyse par bannière et chance."],
      ["Codes", "done", "Agrégation, échange et suivi personnel."],
      ["Réglages : apparence", "done", "Accent et densité paramétrables."],
      ["Personnages", "done", "Grille filtrable, fiche, builds recommandés et équipes."],
      ["Carte interactive", "done", "Teyvat et sous-mondes, recherche, points récupérés."],
      ["Équipes", "done", "Tier list agrégée (game8 + KQM) et composeur selon le roster possédé."],
      ["Armes", "done", "Catalogue filtrable, fiche avec passif par raffinement ; armes recommandées cliquables."],
    ],
  },
  {
    title: "À concevoir : prioritaire",
    items: [
      ["Exploration", "todo", "Progression par région (données déjà là)."],
      ["Tier lists", "todo", "Rangs par rôle déjà dans le dataset des équipes, reste l'écran."],
    ],
  },
  {
    title: "À concevoir : ensuite",
    items: [
      ["Artéfacts", "todo", "Sets et effets. À l'ouverture : brancher data-artifact sur les sets recommandés des fiches personnage, dont l'id est déjà dans le jeu de données."],
      ["Calendrier", "todo", "Bannières, resets, anniversaires."],
      ["Bestiaire & Succès", "todo", "Sources à câbler."],
    ],
  },
  {
    title: "Transverse",
    items: [
      ["Multi-builds par personnage", "todo", "Onglets Principal / Alternatif / Soutien."],
      ["Illustrations", "todo", "Remplacer les placeholders par les vrais assets."],
      ["Données & CGUs", "todo", "Sources et mentions légales."],
    ],
  },
];

const LABELS = { done: "Fait", wip: "En cours", todo: "À faire" };

export const roadmap = {
  render() {
    return `
      <p class="muted roadmap-intro">
        Suivi de conception interne : ce qui est en place et ce qu'il reste à faire.
        Cet écran n'a pas vocation à rester dans la version publiée.
      </p>
      ${GROUPS.map((g) => `
        <div class="panel roadmap-group">
          <div class="block-title">${g.title}</div>
          <div class="roadmap-list">
            ${g.items.map(([label, status, note]) => `
              <div class="roadmap-item">
                <span class="rm-dot rm-${status}"></span>
                <div>
                  <div class="rm-label">${label}</div>
                  <div class="muted">${note}</div>
                </div>
                <span class="rm-status rm-${status}">${LABELS[status]}</span>
              </div>`).join("")}
          </div>
        </div>`).join("")}`;
  },

  // Page statique : rien à câbler.
  init() {},
};
