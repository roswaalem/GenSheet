//! Commande du catalogue des personnages (Ambr), avec cache local : même
//! logique que le farm : on ne retélécharge que si le cache a vieilli.

use tauri::State;

use crate::catalog::{self, Catalog, CatalogCharacter};
use crate::db::Db;
use crate::error::Result;
use crate::farm::now_secs;

const CATALOG_KEY: &str = "character_catalog";

async fn cached(db: &Db, force: bool) -> Result<Catalog> {
    if !force {
        if let Some(raw) = db.get_setting(CATALOG_KEY)? {
            if let Ok(cat) = serde_json::from_str::<Catalog>(&raw) {
                if !cat.is_stale(now_secs()) {
                    return Ok(cat);
                }
            }
        }
    }
    let fresh = catalog::fetch().await?;
    db.set_setting(CATALOG_KEY, &serde_json::to_string(&fresh)?)?;
    Ok(fresh)
}

#[tauri::command]
pub async fn character_catalog(
    db: State<'_, Db>,
    refresh: Option<bool>,
) -> Result<Vec<CatalogCharacter>> {
    Ok(cached(db.inner(), refresh.unwrap_or(false)).await?.characters)
}

#[tauri::command]
pub async fn character_detail(key: String) -> Result<catalog::CharacterDetail> {
    catalog::fetch_detail(&key).await
}
