use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration};
use crate::db::Db;
use crate::error::{Error, Result};

// The host has moved over the years; try known bases in order.
const API_BASES: [&str; 3] = [
    "https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog",
    "https://hk4e-api-os.hoyoverse.com/gacha_info/api/getGachaLog",
    "https://hk4e-api-os.hoyoverse.com/event/gacha_info/api/getGachaLog",
];

// Banner 400 (2nd character banner) is returned inside gacha_type=301 queries.
const BANNERS: [&str; 5] = ["100", "200", "301", "302", "500"];

#[derive(Deserialize)]
struct ApiResponse {
    retcode: i64,
    message: String,
    data: Option<PageData>,
}

#[derive(Deserialize)]
struct PageData {
    list: Vec<WishItem>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WishItem {
    pub id: String,
    pub uid: String,
    pub gacha_type: String,
    pub time: String,
    pub name: String,
    pub item_type: String,
    pub rank_type: String,
}

#[derive(Serialize, Default)]
pub struct SyncReport {
    pub new_items: u64,
    pub uid: Option<String>,
}

pub struct AuthParams(HashMap<String, String>);

impl AuthParams {
    // Keep raw (already percent-encoded) values: re-encoding the authkey breaks it.
    pub fn from_wish_url(url: &str) -> Result<Self> {
        let query = url
            .split('?')
            .nth(1)
            .ok_or_else(|| Error::Msg("URL de vœux sans paramètres.".into()))?;
        let query = query.split('#').next().unwrap_or(query);
        let mut map = HashMap::new();
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                map.insert(k.to_string(), v.to_string());
            }
        }
        if !map.contains_key("authkey") {
            return Err(Error::Msg("authkey absente de l'URL (probablement expirée).".into()));
        }
        Ok(Self(map))
    }

    fn forward(&self, key: &str) -> Option<(String, String)> {
        self.0.get(key).map(|v| (key.to_string(), v.clone()))
    }
}

pub async fn sync_all(db: &Db, wish_url: &str) -> Result<SyncReport> {
    let auth = AuthParams::from_wish_url(wish_url)?;
    let http = reqwest::Client::builder().build()?;
    let base = pick_working_base(&http, &auth).await?;

    let mut report = SyncReport::default();
    for banner in BANNERS {
        let mut end_id = String::from("0");
        let mut page = 1u32;
        loop {
            let items = fetch_page(&http, base, &auth, banner, page, &end_id).await?;
            if items.is_empty() {
                break;
            }
            end_id = items.last().unwrap().id.clone();
            page += 1;

            let inserted = db.insert_wishes(&items)?;
            report.new_items += inserted;
            if report.uid.is_none() {
                report.uid = items.first().map(|i| i.uid.clone());
            }
            // Incremental sync: a fully-known page means we reached old history.
            if inserted == 0 {
                break;
            }
            sleep(Duration::from_millis(600)).await; // stay polite with the API
        }
        sleep(Duration::from_millis(600)).await;
    }
    Ok(report)
}

async fn pick_working_base(http: &reqwest::Client, auth: &AuthParams) -> Result<&'static str> {
    for base in API_BASES {
        if fetch_page(http, base, auth, "301", 1, "0").await.is_ok() {
            return Ok(base);
        }
    }
    Err(Error::Msg(
        "Aucun endpoint de vœux ne répond (authkey expirée ? rouvre l'historique en jeu).".into(),
    ))
}

async fn fetch_page(
    http: &reqwest::Client,
    base: &str,
    auth: &AuthParams,
    gacha_type: &str,
    page: u32,
    end_id: &str,
) -> Result<Vec<WishItem>> {
    let mut query: Vec<(String, String)> = Vec::new();
    for key in ["authkey_ver", "sign_type", "auth_appid", "game_biz", "lang", "region", "authkey"] {
        if let Some(kv) = auth.forward(key) {
            query.push(kv);
        }
    }
    query.push(("gacha_type".into(), gacha_type.into()));
    query.push(("page".into(), page.to_string()));
    query.push(("size".into(), "20".into()));
    query.push(("end_id".into(), end_id.into()));

    let qs: String = query
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let url = format!("{base}?{qs}");

    let resp: ApiResponse = http.get(&url).send().await?.json().await?;
    if resp.retcode != 0 {
        return Err(Error::Msg(format!("API vœux ({}): {}", resp.retcode, resp.message)));
    }
    Ok(resp.data.map(|d| d.list).unwrap_or_default())
}