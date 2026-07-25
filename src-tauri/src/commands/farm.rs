//! Commande du planning de farm, avec cache local des données Ambr.

use tauri::State;

use crate::db::Db;
use crate::error::{Error, Result};
use crate::farm;

const FARM_KEY: &str = "farm_data";

/// Renvoie les données Ambr, en les retéléchargeant si le cache a vieilli ou
/// s'il ignore un personnage du compte (cas d'une sortie récente).
async fn farm_data(db: &Db, avatar_ids: &[i64], force: bool) -> Result<farm::FarmData> {
    let cached: Option<farm::FarmData> = match db.get_setting(FARM_KEY)? {
        Some(raw) => serde_json::from_str(&raw).ok(),
        None => None,
    };

    if !force {
        if let Some(data) = cached {
            if !data.is_stale(farm::now_secs()) && !data.misses_any(avatar_ids) {
                return Ok(data);
            }
        }
    }

    let fresh = farm::fetch().await?;
    db.set_setting(FARM_KEY, &serde_json::to_string(&fresh)?)?;
    Ok(fresh)
}

#[tauri::command]
pub async fn farm_plan(
    db: State<'_, Db>,
    day: String,
    avatar_ids: Vec<i64>,
    refresh: Option<bool>,
) -> Result<farm::FarmPlan> {
    if !farm::DAYS.contains(&day.as_str()) {
        return Err(Error::Msg(format!("Jour inconnu : {day}.")));
    }
    let data = farm_data(db.inner(), &avatar_ids, refresh.unwrap_or(false)).await?;
    Ok(farm::plan(&data, &day, &avatar_ids))
}
