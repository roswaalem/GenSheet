//! Commandes de la carte interactive : proxy caché de l'API HoYoLAB (comme le
//! catalogue) + suivi local des points récupérés.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use crate::error::{Error, Result};
use crate::farm::now_secs;
use crate::map::{self, Label, MapEntry, MapInfo, Point};

/// Le fond et les marqueurs bougent rarement ; deux semaines suffisent.
const TTL: u64 = 14 * 24 * 3600;

#[derive(Serialize, Deserialize)]
struct Cached<T> {
    at: u64,
    data: T,
}

async fn cached<T, Fut>(db: &Db, key: &str, fetch: Fut) -> Result<T>
where
    T: Clone + Serialize + serde::de::DeserializeOwned,
    Fut: std::future::Future<Output = Result<T>>,
{
    if let Some(raw) = db.get_setting(key)? {
        if let Ok(c) = serde_json::from_str::<Cached<T>>(&raw) {
            if now_secs().saturating_sub(c.at) < TTL {
                return Ok(c.data);
            }
        }
    }
    let data = fetch.await?;
    let wrapped = Cached { at: now_secs(), data: data.clone() };
    db.set_setting(key, &serde_json::to_string(&wrapped)?)?;
    Ok(data)
}

#[tauri::command]
pub async fn map_list(db: State<'_, Db>) -> Result<Vec<MapEntry>> {
    cached(db.inner(), "map_list", map::fetch_map_list()).await
}

#[tauri::command]
pub async fn map_info(db: State<'_, Db>, map_id: i64) -> Result<MapInfo> {
    cached(db.inner(), &format!("map_info_{map_id}"), map::fetch_info(map_id)).await
}

#[tauri::command]
pub async fn map_labels(db: State<'_, Db>, map_id: i64) -> Result<Vec<Label>> {
    cached(db.inner(), &format!("map_labels_{map_id}"), map::fetch_labels(map_id)).await
}

/// Cache mémoire des points par carte : le jeu complet (~83k) n'est parsé qu'une
/// fois par session au lieu de re-lire le gros JSON du cache DB à chaque coche.
fn points_cache() -> &'static Mutex<std::collections::HashMap<i64, Vec<Point>>> {
    static CACHE: OnceLock<Mutex<std::collections::HashMap<i64, Vec<Point>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

/// Renvoie uniquement les points des catégories demandées (le jeu complet fait
/// des dizaines de milliers de points ; on filtre côté backend).
#[tauri::command]
pub async fn map_points(db: State<'_, Db>, map_id: i64, label_ids: Vec<i64>) -> Result<Vec<Point>> {
    if !points_cache().lock().unwrap().contains_key(&map_id) {
        let all = cached(db.inner(), &format!("map_points_{map_id}"), map::fetch_points(map_id)).await?;
        points_cache().lock().unwrap().insert(map_id, all);
    }
    let wanted: HashSet<i64> = label_ids.into_iter().collect();
    let cache = points_cache().lock().unwrap();
    let all = cache.get(&map_id).expect("inséré juste au-dessus");
    Ok(all.iter().filter(|p| wanted.contains(&p.label_id)).cloned().collect())
}

// --- Suivi de complétion (local) -------------------------------------------

fn collected_key(map_id: i64) -> String {
    format!("map_collected_{map_id}")
}

#[tauri::command]
pub fn map_collected(db: State<'_, Db>, map_id: i64) -> Result<Vec<i64>> {
    match db.get_setting(&collected_key(map_id))? {
        Some(raw) => Ok(serde_json::from_str(&raw)?),
        None => Ok(Vec::new()),
    }
}

/// Exporte toute la progression (tous les mondes) : `{ "<map_id>": [ids] }`.
#[tauri::command]
pub fn map_export(db: State<'_, Db>) -> Result<String> {
    let mut out = serde_json::Map::new();
    for (key, value) in db.settings_by_prefix("map_collected_")? {
        let id = key.trim_start_matches("map_collected_");
        let ids: Vec<i64> = serde_json::from_str(&value).unwrap_or_default();
        out.insert(id.to_string(), serde_json::json!(ids));
    }
    Ok(serde_json::to_string(&out)?)
}

/// Importe une progression exportée en la **fusionnant** avec l'existante.
#[tauri::command]
pub fn map_import(db: State<'_, Db>, data: String) -> Result<()> {
    let parsed: std::collections::HashMap<String, Vec<i64>> =
        serde_json::from_str(&data).map_err(|_| Error::Msg("Fichier de progression invalide.".into()))?;
    for (id, ids) in parsed {
        if id.parse::<i64>().is_err() {
            continue; // ignore les clés non numériques
        }
        let key = collected_key(id.parse().unwrap());
        let mut set: std::collections::BTreeSet<i64> = match db.get_setting(&key)? {
            Some(raw) => serde_json::from_str(&raw).unwrap_or_default(),
            None => Default::default(),
        };
        set.extend(ids);
        let merged: Vec<i64> = set.into_iter().collect();
        db.set_setting(&key, &serde_json::to_string(&merged)?)?;
    }
    Ok(())
}

#[tauri::command]
pub fn map_toggle_point(db: State<'_, Db>, map_id: i64, point_id: i64, done: bool) -> Result<()> {
    let key = collected_key(map_id);
    let mut ids: Vec<i64> = match db.get_setting(&key)? {
        Some(raw) => serde_json::from_str(&raw)?,
        None => Vec::new(),
    };
    if done {
        if !ids.contains(&point_id) {
            ids.push(point_id);
        }
    } else {
        ids.retain(|&x| x != point_id);
    }
    db.set_setting(&key, &serde_json::to_string(&ids)?)?;
    Ok(())
}
