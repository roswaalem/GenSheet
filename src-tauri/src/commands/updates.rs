//! Commandes de mise à jour : contrôle silencieux au démarrage, installation
//! sur action explicite.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::error::{Error, Result};

#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    version: String,
    notes: Option<String>,
}

/// Cherche une mise à jour. Renvoie `None` (jamais une erreur) quand le
/// contrôle échoue : hors ligne ou endpoint injoignable, l'app doit démarrer
/// sans rien reprocher à l'utilisateur. La raison part sur la sortie d'erreur.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>> {
    // En développement, la version compilée est celle du dépôt : la comparer à
    // la dernière version publiée n'annonce qu'une mise à jour fantôme.
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("updater indisponible : {e}");
            return Ok(None);
        }
    };
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            current: update.current_version.clone(),
            version: update.version.clone(),
            notes: update.body.clone(),
        })),
        Ok(None) => Ok(None),
        Err(e) => {
            eprintln!("contrôle de mise à jour échoué : {e}");
            Ok(None)
        }
    }
}

/// Télécharge, installe puis relance. Ici les erreurs remontent : c'est une
/// action explicite de l'utilisateur, un échec silencieux serait pire.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<()> {
    if cfg!(debug_assertions) {
        return Err(Error::Msg("Mise à jour désactivée en développement.".into()));
    }
    let update = app
        .updater()?
        .check()
        .await?
        .ok_or_else(|| Error::Msg("Plus aucune mise à jour à installer.".into()))?;

    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
}
