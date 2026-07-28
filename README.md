# Tauri + Vanilla

This template should help get you started developing with Tauri in vanilla HTML, CSS and Javascript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Données de build recommandées

Les builds recommandés multi-rôles (`src/data/builds.fr.json`) sont **agrégés une fois,
hors-ligne**, depuis des guides communautaires, l'application ne lit que le JSON local.

Regénérer (à la sortie d'un patch) :

```bash
npm run data            # tout le roster
npm run data Furina     # un/quelques persos (test)
```

Sources : [game8](https://game8.co/games/Genshin-Impact) et [KQM](https://keqingmains.com) (à venir : GameWith).
Noms traduits et normalisés via [genshin-db](https://github.com/theBowja/genshin-db).
Outil non officiel, non affilié à HoYoverse ni aux sources citées.
