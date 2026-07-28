//! Commandes du catalogue des armes, avec cache local : même logique que le
//! catalogue des personnages : on ne retélécharge que si le cache a vieilli.

use tauri::State;

use crate::db::Db;
use crate::error::Result;
use crate::farm::now_secs;
use crate::weapons::{self, CatalogWeapon, WeaponCatalog};

/// Clé versionnée : le cache vit une semaine et se relit sans erreur tant que
/// la structure ne change pas. Changer de suffixe est le seul moyen de forcer
/// sa reconstruction quand c'est le *contenu* qui évolue (ici, l'exclusion des
/// armes 1★ et 2★).
const CATALOG_KEY: &str = "weapon_catalog_v2";

async fn cached(db: &Db, force: bool) -> Result<WeaponCatalog> {
    if !force {
        if let Some(raw) = db.get_setting(CATALOG_KEY)? {
            if let Ok(cat) = serde_json::from_str::<WeaponCatalog>(&raw) {
                if !cat.is_stale(now_secs()) {
                    return Ok(cat);
                }
            }
        }
    }
    let fresh = weapons::fetch().await?;
    db.set_setting(CATALOG_KEY, &serde_json::to_string(&fresh)?)?;
    Ok(fresh)
}

#[tauri::command]
pub async fn weapon_catalog(db: State<'_, Db>, refresh: Option<bool>) -> Result<Vec<CatalogWeapon>> {
    Ok(cached(db.inner(), refresh.unwrap_or(false)).await?.weapons)
}

#[tauri::command]
pub async fn weapon_detail(id: i64) -> Result<weapons::WeaponDetail> {
    weapons::fetch_detail(id).await
}
