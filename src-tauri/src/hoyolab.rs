//! HoYoLAB game-record API (overseas).
//!
//! No official API exists: endpoints, salts and header names come from the
//! community reference implementation (genshin.py) and may break on any patch.
//! Everything that is likely to rot is kept as a constant at the top.

use rand::Rng;
use serde::{Deserialize, Serialize};
use crate::error::{Error, Result};

const DS_SALT: &str = "6s25p5ox5y14umn1p61aqyyvbvvl3lrt";
const APP_VERSION: &str = "1.5.0";
const CLIENT_TYPE: &str = "5";
const LANG: &str = "fr-fr";

const RECORD_BASE: &str = "https://sg-public-api.hoyolab.com/event/game_record/genshin/api";
const CARD_URL: &str = "https://bbs-api-os.hoyolab.com/game_record/card/wapi/getGameRecordCard";

// game_id 2 == Genshin Impact in the HoYoLAB record card list.
const GENSHIN_GAME_ID: i64 = 2;

/// `ds` header: md5 over a salted timestamp + nonce (v1 scheme, overseas).
fn dynamic_secret() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut rng = rand::thread_rng();
    let r: String = (0..6)
        .map(|_| {
            // ASCII letters only, matching the reference implementation.
            let c = rng.gen_range(0..52u8);
            (if c < 26 { b'a' + c } else { b'A' + c - 26 }) as char
        })
        .collect();
    let digest = md5::compute(format!("salt={DS_SALT}&t={t}&r={r}"));
    format!("{t},{r},{digest:x}")
}

/// Session cookies captured from the official login webview.
#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub cookie: String,
    pub ltuid: String,
}

impl Session {
    /// Builds a session from the webview cookie jar. Only the two values the
    /// record API needs are kept — nothing else is stored.
    pub fn from_jar(jar: &std::collections::HashMap<String, String>) -> Result<Self> {
        let find = |name: &str| jar.get(name).filter(|v| !v.is_empty()).cloned();
        let ltuid = find("ltuid_v2")
            .or_else(|| find("ltmid_v2"))
            .ok_or_else(|| Error::Msg("Cookie ltuid_v2 absent : connexion non terminée.".into()))?;
        let ltoken = find("ltoken_v2")
            .ok_or_else(|| Error::Msg("Cookie ltoken_v2 absent : connexion non terminée.".into()))?;
        Ok(Self {
            cookie: format!("ltuid_v2={ltuid}; ltoken_v2={ltoken}"),
            ltuid,
        })
    }
}

#[derive(Deserialize)]
struct ApiResponse<T> {
    retcode: i64,
    message: String,
    data: Option<T>,
}

#[derive(Deserialize)]
struct CardList {
    list: Vec<RecordCard>,
}

#[derive(Deserialize)]
struct RecordCard {
    game_id: i64,
    game_role_id: String,
    region: String,
    nickname: String,
    level: i64,
}

/// The Genshin account (UID + server) attached to the logged-in HoYoLAB profile.
#[derive(Serialize, Deserialize, Clone)]
pub struct Account {
    pub uid: String,
    pub region: String,
    pub nickname: String,
    pub level: i64,
}

#[derive(Deserialize)]
struct IndexData {
    stats: Stats,
    #[serde(default)]
    avatars: Vec<Avatar>,
    #[serde(default)]
    world_explorations: Vec<Exploration>,
}

/// Profile counters. `#[serde(default)]` throughout: HoYoverse adds and removes
/// fields between versions and a missing one must not fail the whole sync.
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Stats {
    #[serde(default)] pub active_day_number: u32,
    #[serde(default)] pub achievement_number: u32,
    #[serde(default)] pub avatar_number: u32,
    #[serde(default)] pub spiral_abyss: String,
    #[serde(default)] pub anemoculus_number: u32,
    #[serde(default)] pub geoculus_number: u32,
    #[serde(default)] pub dendroculus_number: u32,
    #[serde(default)] pub electroculus_number: u32,
    #[serde(default)] pub hydroculus_number: u32,
    #[serde(default)] pub pyroculus_number: u32,
    #[serde(default)] pub common_chest_number: u32,
    #[serde(default)] pub exquisite_chest_number: u32,
    #[serde(default)] pub precious_chest_number: u32,
    #[serde(default)] pub luxurious_chest_number: u32,
    #[serde(default)] pub magic_chest_number: u32,
    #[serde(default)] pub way_point_number: u32,
    #[serde(default)] pub domain_number: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Avatar {
    #[serde(default)] pub id: i64,
    #[serde(default)] pub name: String,
    #[serde(default)] pub element: String,
    #[serde(default)] pub level: i64,
    #[serde(default)] pub rarity: i64,
    #[serde(default)] pub fetter: i64,
    #[serde(default)] pub actived_constellation_num: i64,
    #[serde(default)] pub image: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Exploration {
    #[serde(default)] pub name: String,
    #[serde(default)] pub exploration_percentage: i64,
    #[serde(default)] pub level: i64,
}

/// Everything the dashboard shows for a HoYoLAB profile.
#[derive(Serialize, Clone)]
pub struct Profile {
    pub account: Account,
    pub stats: Stats,
    pub avatars: Vec<Avatar>,
    pub explorations: Vec<Exploration>,
}

fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .build()
        .map_err(Error::from)
}

async fn get<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    url: &str,
    session: &Session,
) -> Result<T> {
    let resp: ApiResponse<T> = http
        .get(url)
        .header("ds", dynamic_secret())
        .header("x-rpc-app_version", APP_VERSION)
        .header("x-rpc-client_type", CLIENT_TYPE)
        .header("x-rpc-language", LANG)
        .header("x-rpc-lang", LANG)
        .header("cookie", &session.cookie)
        .send()
        .await?
        .json()
        .await?;

    if resp.retcode != 0 {
        // 10001 / -100 mean the cookies are stale, which is the common case.
        let hint = if resp.retcode == 10001 || resp.retcode == -100 {
            " — reconnecte-toi à HoYoLAB."
        } else {
            ""
        };
        return Err(Error::Msg(format!(
            "HoYoLAB ({}): {}{hint}",
            resp.retcode, resp.message
        )));
    }
    resp.data
        .ok_or_else(|| Error::Msg("Réponse HoYoLAB vide.".into()))
}

/// Finds the Genshin account linked to the session.
pub async fn find_account(session: &Session) -> Result<Account> {
    let http = client()?;
    let url = format!("{CARD_URL}?uid={}", session.ltuid);
    let cards: CardList = get(&http, &url, session).await?;
    cards
        .list
        .into_iter()
        .find(|c| c.game_id == GENSHIN_GAME_ID)
        .map(|c| Account {
            uid: c.game_role_id,
            region: c.region,
            nickname: c.nickname,
            level: c.level,
        })
        .ok_or_else(|| Error::Msg(
            "Aucun compte Genshin sur ce profil HoYoLAB : vérifie que l'affichage public du profil est activé.".into(),
        ))
}

/// Profile stats, characters and exploration for a given account.
pub async fn fetch_profile(session: &Session, account: &Account) -> Result<Profile> {
    let http = client()?;
    let url = format!(
        "{RECORD_BASE}/index?server={}&role_id={}",
        account.region, account.uid
    );
    let data: IndexData = get(&http, &url, session).await?;
    Ok(Profile {
        account: account.clone(),
        stats: data.stats,
        avatars: data.avatars,
        explorations: data.world_explorations,
    })
}
