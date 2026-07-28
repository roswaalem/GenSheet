//! Carte interactive : proxy de l'API carte publique de HoYoLAB (fond en tuiles,
//! arbre de catégories, marqueurs). Publique et sans authentification, comme
//! Ambr : on passe par le backend car le webview bloquerait le cross-origin.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const BASE: &str = "https://sg-public-api.hoyolab.com/common/map_user/ys_obc/v1/map";

#[derive(Deserialize)]
struct ApiResp<T> {
    retcode: i64,
    message: String,
    data: Option<T>,
}

async fn get<T: serde::de::DeserializeOwned>(url: &str) -> Result<T> {
    let resp: ApiResp<T> = reqwest::Client::new()
        .get(url)
        .header("x-rpc-app_version", "1.0")
        .header("x-rpc-client_type", "4")
        .send()
        .await?
        .json()
        .await?;
    if resp.retcode != 0 {
        return Err(Error::Msg(format!(
            "Carte HoYoLAB ({}): {}",
            resp.retcode, resp.message
        )));
    }
    resp.data.ok_or_else(|| Error::Msg("Réponse carte vide.".into()))
}

fn map_url(path: &str, map_id: i64) -> String {
    format!("{BASE}/{path}?map_id={map_id}&app_sn=ys_obc&lang=fr-fr")
}

// --- Liste des cartes (Teyvat + sous-mondes) -------------------------------

/// Une carte sélectionnable (Teyvat, Enkanomiya, Gouffre souterrain…).
#[derive(Serialize, Deserialize, Clone)]
pub struct MapEntry {
    pub id: i64,
    pub name: String,
}

#[derive(Deserialize)]
struct ListResp {
    all_map_list: Vec<ListEntry>,
}
#[derive(Deserialize)]
struct ListEntry {
    id: i64,
    #[serde(default)]
    depth: Option<i64>,
}

pub async fn fetch_map_list() -> Result<Vec<MapEntry>> {
    let resp: ListResp = get(&format!("{BASE}/list?app_sn=ys_obc&lang=fr-fr")).await?;
    // depth 2 = vraies cartes (depth 1 = regroupements). Le nom localisé vient
    // de l'info de chaque carte.
    let mut out = Vec::new();
    for e in resp.all_map_list.into_iter().filter(|e| e.depth == Some(2)) {
        if let Ok(info_name) = get::<InfoResp>(&map_url("info", e.id)).await.map(|r| r.info.name) {
            if !info_name.trim().is_empty() {
                out.push(MapEntry { id: e.id, name: info_name });
            }
        }
    }
    Ok(out)
}

// --- Fond (tuiles) ---------------------------------------------------------

/// Fond « v2 » : pyramide de tuiles (le champ `detail` historique est figé en
/// 2024). Les URLs de tuiles se construisent côté front à partir de
/// `map_version` : `.../map_manage/map/{map_id}/{map_version}/{x}_{y}_N{k}.webp`
/// (k = niveau de zoom, N0 = natif). `origin` place la coordonnée jeu (0,0).
#[derive(Serialize, Deserialize, Clone)]
pub struct MapInfo {
    pub map_version: String,
    pub origin: [f64; 2],
    pub total_size: [i64; 2],
    pub min_zoom: i64,
    pub max_zoom: i64,
}

#[derive(Deserialize)]
struct InfoResp {
    info: InfoRaw,
}
#[derive(Deserialize)]
struct InfoRaw {
    #[serde(default)]
    name: String,
    detail_v2: DetailV2,
}
#[derive(Deserialize)]
struct DetailV2 {
    map_version: String,
    origin: [f64; 2],
    total_size: [i64; 2],
    min_zoom: i64,
    max_zoom: i64,
}

pub async fn fetch_info(map_id: i64) -> Result<MapInfo> {
    let raw: InfoResp = get(&map_url("info", map_id)).await?;
    let d = raw.info.detail_v2;
    Ok(MapInfo {
        map_version: d.map_version,
        origin: d.origin,
        total_size: d.total_size,
        min_zoom: d.min_zoom,
        max_zoom: d.max_zoom,
    })
}

// --- Catégories ------------------------------------------------------------

/// Nœud de l'arbre de filtres (groupe → catégories). Les champs superflus de
/// l'API sont ignorés.
#[derive(Serialize, Deserialize, Clone)]
pub struct Label {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub children: Vec<Label>,
}

#[derive(Deserialize)]
struct TreeResp {
    tree: Vec<Label>,
}

pub async fn fetch_labels(map_id: i64) -> Result<Vec<Label>> {
    let resp: TreeResp = get(&map_url("label/tree", map_id)).await?;
    Ok(resp.tree)
}

// --- Marqueurs -------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct Point {
    pub id: i64,
    pub label_id: i64,
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize)]
struct PointListResp {
    point_list: Vec<PointRaw>,
}
#[derive(Deserialize)]
struct PointRaw {
    id: i64,
    label_id: i64,
    x_pos: f64,
    y_pos: f64,
}

pub async fn fetch_points(map_id: i64) -> Result<Vec<Point>> {
    let resp: PointListResp = get(&map_url("point/list", map_id)).await?;
    Ok(resp
        .point_list
        .into_iter()
        .map(|p| Point {
            id: p.id,
            label_id: p.label_id,
            x: p.x_pos,
            y: p.y_pos,
        })
        .collect())
}
