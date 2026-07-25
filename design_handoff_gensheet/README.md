# Handoff : GenSheet — Wiki Genshin Impact (application desktop)

## Overview
GenSheet est un wiki/companion **desktop** ultra-complet pour Genshin Impact, développé en **Rust**. L'objectif : rendre consultable toute l'information du jeu (personnages, armes, artéfacts, bestiaire, tier lists, équipes, succès, exploration, carte, codes, calendrier) autour d'un thème « espace / nébuleuse ». L'application doit être dynamique, optimisée, très soignée, et laisser respirer le viewport (densité équilibrée, pas d'étouffement).

Ce document décrit une refonte complète du layout et du thème : un shell immersif (nébuleuse rouge/rose sur espace profond), une navigation latérale organisée, et l'ensemble des pages.

## À propos des fichiers de design
Les fichiers de ce bundle (`GenSheet.dc.html` + `support.js`) sont des **références de design créées en HTML** — un prototype interactif qui montre l'apparence et le comportement voulus. **Ce n'est pas du code de production à copier tel quel.**

La tâche : **recréer ces écrans dans l'environnement réel de l'application Rust**, avec ses patterns établis :
- Si l'UI est un **webview** (Tauri, Wry, Tauri + framework front comme Svelte/React/Vue/Leptos/Dioxus) : réimplémenter en composants dans ce framework, en réutilisant sa structure de styles.
- Si l'UI est **native immédiate** (egui/iced) : traduire la mise en page, les couleurs et la typographie dans les primitives du framework (le rendu exact des dégradés/flous peut être approximé).
- Si aucun front n'est encore choisi : **Tauri + un framework web** est le chemin le plus fidèle à ces maquettes (HTML/CSS y sont directement transposables). Les valeurs ci-dessous sont alors quasi copiables.

> Le HTML de référence est écrit dans un format interne (`.dc.html`, balises `<x-dc>`, holes `{{ }}`, logique dans une classe `Component`). Ne pas transposer ce format : il sert uniquement à **prévisualiser**. Ouvre `GenSheet.dc.html` dans un navigateur (le `support.js` fourni le fait tourner) pour voir le rendu ; la **spec ci-dessous est la source de vérité**.

## Fidélité
**Hi-fi.** Couleurs, typographie, espacements, rayons et interactions sont définitifs. Reproduire au pixel près en réutilisant les composants/design-system de la cible.

---

## Design tokens

### Typographie
- **Display / titres / chiffres / labels** : `Space Grotesk` (400, 500, 600, 700).
- **Corps / UI** : `Manrope` (400, 500, 600, 700, 800).
- Google Fonts : `https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap`
- Tailles repères : H1 page 30px/700 Space Grotesk ; H1 fiche perso 42px/700 ; eyebrow 11px/600 Space Grotesk, letter-spacing .16em, uppercase ; corps 12.5–14px Manrope ; monospace (chemins, labels art) `ui-monospace, monospace`.

### Couleurs — fond & surfaces
- Fond de base (couche 0, `position:absolute; inset:0`) : `radial-gradient(140% 120% at 50% -12%, #18101d 0%, #0d0913 44%, #070510 100%)`
- **Nébuleuse** (couche 1, opacité = `nebula/100`, `filter: blur(4px)`) :
  `radial-gradient(58% 54% at 74% 22%, rgba(224,90,114,.34), transparent 58%), radial-gradient(44% 40% at 80% 20%, rgba(240,120,150,.22), transparent 60%), radial-gradient(42% 52% at 18% 84%, rgba(150,120,220,.20), transparent 62%), radial-gradient(9% 11% at 76% 24%, rgba(255,236,231,.55), transparent 70%)`
- **Champ d'étoiles** (couche 2, `opacity:.6`, animation `gsTwinkle 7s ease-in-out infinite` sur l'opacité entre .42 et .7) : plusieurs `radial-gradient(1px 1px at …, rgba(255,255,255,.4–.7), transparent)` en `background-repeat:repeat; background-size:330px 330px`.
- **Vignette** (couche 3) : `radial-gradient(120% 92% at 50% 42%, transparent 54%, rgba(4,2,8,.74) 100%)`
- Body de secours : `#07060d`.
- **Panneau / carte** : fond `linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02))`, bordure `1px solid rgba(255,255,255,.08)`, `backdrop-filter: blur(6px)`, rayon 16–18px, padding 18–22px.
- **Sidebar** : `linear-gradient(180deg, rgba(17,11,23,.82), rgba(10,7,16,.9))`, `backdrop-filter: blur(16px)`, `border-right:1px solid rgba(255,255,255,.07)`, largeur **256px**.

### Couleurs — accent (thème, paramétrable)
- Accent par défaut : **`#e05a72`** (rose nébuleuse). Alternatives proposées : `#d65b9a` (magenta), `#bb8fe4` (périwinkle), `#eeb64f` (or).
- Dérivés utilisés partout : `acSoft = rgba(accent, .16)`, `acLine = rgba(accent, .5)`, `acGlow = rgba(accent, .34)`.
- Usages accent : état actif de nav, boutons primaires (`linear-gradient(90deg, accent, acLine)`), eyebrows de section, liens, barres de progression, lueurs, pastilles « fait ».

### Couleurs — éléments Genshin
| Élément | Hex |
|---|---|
| Anémo | `#6fc9b3` |
| Cryo | `#7fd3e8` |
| Dendro | `#a9c94f` |
| Electro | `#bb8fe4` |
| Géo | `#eeb64f` |
| Hydro | `#4fb6f2` |
| Pyro | `#f07a54` |

### Couleurs — rareté
- 5★ : `#f0c25a` (or) · 4★ : `#c79be8` (violet) · 3★ : `#7fb2e8` (bleu).
- Puce de rareté = pilule pleine (fond = couleur rareté, texte `#120a0e`).

### Texte
- Primaire : `#f4eef2` / `#f6f1f9` / `#ece7ef`.
- Secondaire : `rgba(236,231,239,.5–.6)`.
- Tertiaire / labels : `rgba(236,231,239,.4)`.
- Liens : `#f0808f` (hover `#ff9aa6`). Sélection : `rgba(224,90,114,.35)`.

### Rayons, chips, divers
- Cartes 16–18px · chips/pilules 20px · boutons 10–11px · tuiles/icônes 9–14px.
- Chip (filtre) : `padding:7px 13px; border-radius:20px`. État inactif : fond `rgba(255,255,255,.04)`, bordure `rgba(255,255,255,.09)`, texte `#c8c0d0`. État actif : fond `rgba(couleur,.22)`, bordure `rgba(couleur,.6)`, texte `#fff`.
- Scrollbars fines (10px) à pouce `rgba(224,90,114,.26)`.
- Animation d'entrée de page : `gsUp` (fade + translateY(12px)→0, .4s ease).
- Transitions hover : 0.15–0.18s.

### Densité (paramétrable : Aéré / Équilibré / Compact)
Affecte : largeur mini des cartes de la grille perso, gap, padding du conteneur.
- Aéré : cardMin 184px, gap 22px, padding conteneur `40px 48px 90px`.
- **Équilibré (défaut)** : cardMin 158px, gap 18px, padding `34px 42px 90px`.
- Compact : cardMin 132px, gap 13px, padding `28px 32px 80px`.
- Conteneur principal : `max-width:1240px; margin:0 auto`.

### Placeholders d'images (les illustrations seront fournies plus tard)
Aucune illustration n'est dessinée : chaque emplacement image est un **placeholder rayé teinté par l'élément**, avec un label monospace décrivant le contenu attendu.
- Portrait : `radial-gradient(120% 85% at 50% 0%, rgba(elem,.3), transparent 62%), repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 9px, rgba(255,255,255,0) 9px 18px), linear-gradient(180deg,#15111d,#0c0913)`.
- Tuile générique : `repeating-linear-gradient(135deg, rgba(couleur,a) 0 9px, rgba(couleur,a*0.35) 9px 18px), linear-gradient(180deg,#15111d,#0d0a14)` (a≈.12–.16).
- Labels : `splash · <Nom>`, `splash art · <Nom>`, etc.

---

## Layout global (shell)
Flex horizontal plein écran (`height:100vh; overflow:hidden`), au-dessus des 4 couches de fond.

### Sidebar (gauche, 256px, colonne)
1. **Marque** : carré 40px (dégradé accent, glow) avec glyphe `✦` couleur accent + « GenSheet » (Space Grotesk 20/700) + sous-titre « WIKI DE TEYVAT » (10px, uppercase, .16em, opacité .38).
2. **Nav scrollable**, groupée en sections (titre de section : 10px Space Grotesk, .18em, uppercase, opacité .32) :
   - **Vue d'ensemble** : Tableau de bord, Calendrier, Codes
   - **Base de données** : Personnages, Armes, Artéfacts, Bestiaire
   - **Méta & guides** : Tier lists, Équipes
   - **Progression** : Exploration, Succès
   - **Outils** : Carte interactive
   - Item de nav : `padding:9px 12px 9px 15px; border-radius:11px`, glyphe losange 6px (rotate 45°) + label 13.5px Manrope. Actif : fond `linear-gradient(90deg, acSoft, rgba(accent,.03))`, texte blanc, **barre d'accent 3px** à gauche (glow), losange coloré en accent. Hover : fond `rgba(255,255,255,.05)`, texte blanc.
3. **Pied de sidebar** (bordure haute) :
   - **Feuille de route** : bouton à bordure **tiretée** accent + badge « design » (méta : liste ce qu'il reste à concevoir).
   - « Données & CGUs » et « Réglages, GitHub… » (liens discrets).

### Zone principale (droite)
`flex:1; overflow-y:auto`. Conteneur centré `max-width:1240px`. Chaque page commence par un **en-tête** : eyebrow (nom de section, couleur accent) + H1.

Le **panneau de droite** (calendrier/anniversaires) vu sur les sketches d'origine **n'apparaît sur aucune page** (décision produit) — son contenu vit dans la page Calendrier.

---

## Écrans / Vues

> Un seul écran est visible à la fois, piloté par l'état `tab` (+ `selected` pour la fiche perso). Réutiliser la structure « en-tête + cartes en panneaux vitrés ».

### 1. Personnages (grille) — écran d'accueil de la base
- **En-tête** : eyebrow « Base de données » + H1 « Personnages ».
- **Barre d'outils** (flex, wrap) : segmented control **Mes personnages / Tous les personnages** (pilule active = dégradé accent) · champ de recherche (grow) · puces rareté **5★ / 4★** (toggle) · bouton d'aide `?` rond.
- Panneau d'aide dépliable (toggle `?`).
- **Filtres** : rangée de puces **éléments** (pastille colorée + label : Anémo, Cryo, Dendro, Electro, Géo, Hydro, Pyro) ; rangée de puces **armes** (Épée à une main, Épée à deux mains, Arme d'hast, Arc, Catalyseur).
- Ligne de compte : « N personnage(s) affiché(s) sur T » (ou « possédé(s) » en mode Mes personnages).
- **Grille** : `grid auto-fill minmax(cardMin,1fr)`, gap selon densité.
- **Carte perso** (cliquable → fiche) : fond teinté élément (`linear-gradient(180deg, rgba(elem,.20), rgba(11,9,17,.74))`), bordure `rgba(elem,.3)` (`.5` si possédé), rayon 16px. Portrait placeholder (aspect 1/1.16) + **pastille élément** (disque coloré, glow) en haut-gauche + **puce rareté** en haut-droite + label art en bas. Plaque nom (fond `rgba(elem,.14)`) : nom (Space Grotesk 14/600) + sous-ligne (`Nv. X · C0 · Élément` si possédé, sinon `rareté · type d'arme`). Hover : `translateY(-4px)` + ombre `0 16px 40px acGlow`.

### 2. Fiche personnage (clic sur une carte)
- Bouton retour « ← Personnages ».
- **Hero** (grille `300px 1fr`, panneau, lueur rareté en radial) :
  - Portrait vertical (aspect 3/4) teinté élément, glow rareté, pastille élément, label « splash art · Nom ».
  - Colonne infos : rangée puces (rareté / élément avec pastille / type d'arme) ; **Nom** (42px/700) ; titre/épithète (italique, muté) ; **grille de faits** (Élément, Arme, Rareté, Région, Anniversaire, Constellation, Doubleur FR, Doubleur JP — champ inconnu = « À compléter »).
- Bandeau « ◆ Aperçu de mise en page — données illustratives à compléter » (gold).
- **Sections** (panneaux) :
  1. **Stats ciblées** — 3 tuiles Sablier / Coupe / Diadème (valeur en couleur élément) + sous-stats prioritaires (libellé + barre de poids `linear-gradient(90deg, accent, elem)`).
  2. **Sets d'artéfacts** — liste (tuile placeholder + nom + effet).
  3. **Ranking / Tier** (pleine largeur) — échelle **S A B C D F** (cellule active = dégradé accent, glow, marqueur « ★ ici ») + légende + 3 lignes de rôle (Rôle principal / En soutien / Spiral Abyss) avec pastille de tier colorée (S rose, A or, B teal, C bleu).
  4. **Builds possibles** (pleine largeur) — onglets de build (Build principal / Alternatif / Soutien) + détail : armes recommandées (nom + badge 5★/4★), set, stats principales, priorité talents.
  5. **Talents** — 3 lignes (Attaque normale / Compétence / Déchaînement) badge + priorité.
  6. **Constellations** — C1→C6 (C1/C2/C6 « clés », cerclées accent).
  7. **Meilleures équipes** (pleine largeur) — 2 équipes, chacune = libellé + tag + 4 pastilles membres (disque teinté élément + nom).
  8. **Ascension & matériaux** — grille de tuiles placeholder (boss, spécialité locale, mobs, livres de talent, gemme, mora) avec quantité.

### 3. Tableau de bord
- Bandeau **Jeu détecté** (chemin monospace) + bouton primaire **Synchroniser les vœux**.
- Bandeau **Connecté : <pseudo> — UID <uid> (RA n)** + bouton **Rafraîchir le profil**.
- Grille de **cartes de stats** (Jours d'activité, Hauts faits, Abysse, Coffres ouverts, Oculus collectés, Points de tp/domaines) — grand chiffre (Space Grotesk 26) + fine barre d'accent en haut.
- Grille **stats de vœux** (Vœux au total, Primo-gemmes dépensées, 5★, 4★, Pity) — chiffre en couleur accent.
- **Historique des tirages** : tableau (grille 4 colonnes : Nom / Type / Rareté / Date). Noms de personnages en violet, armes en clair ; rareté colorée.

### 4. Calendrier
- **Grille hebdomadaire** 7 colonnes (Lun→Dim, date en gros) ; le **jour courant** est surligné (fond `acSoft`, bordure `acLine`). Chaque cellule contient des puces d'événement colorées par type : bannière (rose), reset (bleu), anniversaire (or), événement (vert).
- Dessous, 3 colonnes : **Farm du jour** (livres de talent par jours) · **Anniversaires** (pastille perso + nom + date) · **Événements** (libellé + échéance en accent).

### 5. Codes
- Bandeau : « N codes connus, 0 à essayer. » + bouton **Actualiser la liste** + champ « Saisir un code à la main » + bouton **Échanger ce code**.
- Tableau (grille 3 colonnes : Code / Récompenses / Mon état). Code en **monospace couleur accent** + source/date ; récompenses ; **`<select>` d'état** (À essayer / Déjà utilisé / Échangé / Invalide) + note dérivée de l'état.

### 6. Armes
- Recherche + puces rareté (5★/4★/3★) + puces type d'arme. Compteur.
- Grille de cartes : icône placeholder teintée rareté (puce rareté en coin), nom, type, `ATQ <base>` + stat secondaire.

### 7. Artéfacts
- Grille de **cartes de set** (`minmax(340px,1fr)`) : pastille élément + nom, rangée de **5 tuiles placeholder** (pièces), effet **2 PIÈCES**, effet **4 PIÈCES**, ligne domaine.

### 8. Tier lists
- Onglets de filtre par élément (Tous + 7 éléments).
- Lignes de tier **S / A / B / C** : cellule-label 70px (grande lettre colorée : S rose, A or, B teal, C bleu) + zone de pastilles perso (disque teinté élément + nom).

### 9. Équipes
- Grille de **cartes d'équipe** : nom + tag de réaction (accent) + 4 pastilles membres + description/rotation.

### 10. Bestiaire
- Grille de cartes : placeholder (aspect 16/10), nom, **puce catégorie** (Boss de monde rose, Boss hebdomadaire or, Élite teal, Monstre commun gris) + région, puces de butins.

### 11. Succès
- Bandeau résumé : total obtenus / total + note. Grille de **cartes catégorie** (nom + % accent + barre + fait/total). Panneau « Sélection » : liste (pastille faite/à faire + nom/desc + « ◆ N » primos or).

### 12. Exploration
- Cartes région empilées : nom + oculus (obtenus/total, type) + coffres + grand **% accent** + barre `linear-gradient(90deg, accent, #8a7fd6)`.

### 13. Carte interactive
- Grille `264px 1fr`. Panneau gauche : onglets **région** (Mondstadt, Liyue, Inazuma, Sumeru, Fontaine, Natlan) + liste de **filtres** (pastille colorée + libellé + compteur : Points de téléportation, Statues des Sept, Coffres, Oculus, Ressources, Marchands). Zone droite : grande zone carte placeholder (rayures + halo) affichant « Carte de Teyvat — <région> » + contrôles de zoom `+ / −` en bas-droite.

### 14. Données & CGUs
- Grille de cartes sources (Profil HoYoLAB, Enka.Network, Project Amber, Base communautaire) + encart mentions légales (outil non officiel).

### 15. Réglages
- Grille 2 colonnes de groupes : **Général** (Langue, Dossier du jeu), **Compte** (UID, Se déconnecter), **Apparence** (renvoi au panneau de thème), **Données** (Synchronisation auto = toggle, Effacer le cache). Bandeau bas : version + lien Dépôt GitHub.

### 16. Feuille de route (méta — outil de design)
- Écran spécial (bouton tireté dans le pied de sidebar) qui **liste ce qu'il reste à concevoir**, groupé : Fait / À concevoir – prioritaire / À concevoir – ensuite / Transverse. Chaque item : pastille de statut (Fait accent, En cours or, À faire gris) + libellé + note + statut. C'est un aide-mémoire pour l'équipe design, pas une vraie page produit — à retirer de la version finale.

---

## Interactions & comportement
- **Navigation** : clic sur un item de nav → change `tab` et remet `selected=null`. Un seul écran visible.
- **Personnages** : segmented Mes/Tous ; recherche (contient, insensible à la casse) ; puces élément/arme/rareté en **multi-toggle** cumulatif ; clic sur une carte → ouvre la fiche ; bouton retour → grille.
- **Fiche** : onglets de build changent le détail affiché.
- **Tier lists** : onglet élément filtre les pastilles.
- **Codes** : `<select>` par ligne met à jour l'état (et la note) ; l'état est mémorisé par code.
- **Carte** : onglets région changent le libellé de la zone.
- Tous les boutons/cartes ont des états **hover** (léger éclaircissement / translation / glow accent) et **focus** sur les champs (bordure accent).
- Animation d'entrée `gsUp` à chaque changement d'écran ; scintillement lent du champ d'étoiles.
- Responsive : grilles en `auto-fill minmax(...)` ; barres d'outils en `flex-wrap`. Cible = fenêtre desktop (pas de layout mobile requis).

## Gestion d'état
État de l'app (adapter au store de la cible) :
- `tab` : onglet courant (`personnages` par défaut ; `roadmap`, `dashboard`, `calendrier`, `codes`, `armes`, `artefacts`, `tierlists`, `equipes`, `bestiaire`, `succes`, `exploration`, `carte`, `donnees`, `reglages`).
- `selected` : nom du perso ouvert (null = grille). `buildIdx` : onglet de build de la fiche.
- `scope` : `mine` | `all`. `els`, `wps`, `rars` : filtres actifs (listes). `q` : recherche perso.
- `armType`, `armRar`, `armQ` : filtres/recherche armes. `tierEl` : élément filtré des tier lists. `mapRegion` : région de la carte.
- `codeStates` : map { code → état }. `help` : panneau d'aide perso.
- **Données** à alimenter depuis le backend Rust : profil/compte, personnages possédés (niveau/constellation), historique de vœux, stats de compte, progression d'exploration, succès, codes, calendrier/bannières. Dans le prototype ce sont des **données illustratives** ; brancher les vraies sources (HoYoLAB/Enka/Amber ou base locale).

## Assets
- **Aucune illustration réelle** : tous les portraits/icônes/tuiles sont des placeholders rayés teintés par l'élément (recette dans Design tokens). Le propriétaire fournira les images (splash art perso, icônes armes/artéfacts, monstres, carte). Prévoir des emplacements image aux mêmes ratios (cartes perso 1/1.16, hero 3/4, armes 1/1, bestiaire 16/10, pièces d'artéfacts 1/1).
- Glyphes texte utilisés : `✦` (marque/vide), `◆` (primos/note), `★` (marqueur de tier), `+ / −` (zoom). Pas d'emoji.
- Polices : Google Fonts (Space Grotesk + Manrope).

## Fichiers
- `GenSheet.dc.html` — prototype de référence (tous les écrans). Ouvrir dans un navigateur (avec `support.js`) pour explorer.
- `support.js` — runtime qui permet d'ouvrir le prototype ; **non pertinent** pour l'implémentation cible.
- `README.md` — ce document (source de vérité).
