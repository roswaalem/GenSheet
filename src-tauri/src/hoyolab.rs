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

/// Même en-têtes que `get`, mais en POST : c'est ce qu'exigent les endpoints
/// `character/list` et `character/detail`.
async fn post<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    url: &str,
    session: &Session,
    body: &serde_json::Value,
) -> Result<T> {
    let resp: ApiResponse<T> = http
        .post(url)
        .header("ds", dynamic_secret())
        .header("x-rpc-app_version", APP_VERSION)
        .header("x-rpc-client_type", CLIENT_TYPE)
        .header("x-rpc-language", LANG)
        .header("x-rpc-lang", LANG)
        .header("cookie", &session.cookie)
        .json(body)
        .send()
        .await?
        .json()
        .await?;

    if resp.retcode != 0 {
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

// --- Détail des personnages ------------------------------------------------

/// Statistiques numérotées par l'API. Table dérivée des valeurs observées sur
/// un personnage réel (Taux CRIT à 5 %, Recharge à 100 %, DGT physiques…)
/// plutôt que devinée. Les valeurs arrivent déjà formatées par HoYoLAB, donc
/// un type non répertorié reste affichable, seul son libellé manque.
fn property_label(id: i64) -> String {
    match id {
        1 | 2 => "PV",
        3 => "PV %",
        4 | 5 => "ATQ",
        6 => "ATQ %",
        7 | 8 => "DÉF",
        9 => "DÉF %",
        20 => "Taux CRIT",
        22 => "DGT CRIT",
        23 => "Recharge d'énergie",
        26 => "Bonus de soins",
        28 => "Maîtrise élémentaire",
        30 => "Bonus de DGT physiques",
        40 => "Bonus de DGT Pyro",
        41 => "Bonus de DGT Électro",
        42 => "Bonus de DGT Hydro",
        43 => "Bonus de DGT Dendro",
        44 => "Bonus de DGT Anémo",
        45 => "Bonus de DGT Géo",
        46 => "Bonus de DGT Cryo",
        2000 => "PV max",
        2001 => "ATQ",
        2002 => "DÉF",
        other => return format!("Statistique {other}"),
    }
    .to_string()
}

#[derive(Deserialize)]
struct CharacterList {
    #[serde(default)]
    list: Vec<Character>,
}

/// Un personnage possédé, tel que listé par `character/list`.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Character {
    #[serde(default)] pub id: i64,
    #[serde(default)] pub name: String,
    #[serde(default)] pub icon: String,
    #[serde(default)] pub element: String,
    #[serde(default)] pub level: i64,
    #[serde(default)] pub rarity: i64,
    #[serde(default)] pub actived_constellation_num: i64,
}

#[derive(Deserialize)]
struct DetailList {
    #[serde(default)]
    list: Vec<RawDetail>,
}

#[derive(Deserialize)]
struct RawDetail {
    #[serde(default)] base: Character,
    #[serde(default)] weapon: RawWeapon,
    #[serde(default)] relics: Vec<RawRelic>,
    #[serde(default)] recommend_relic_property: Option<RawRecommend>,
}

#[derive(Deserialize, Default)]
struct RawWeapon {
    #[serde(default)] name: String,
    #[serde(default)] level: i64,
    #[serde(default)] affix_level: i64,
}

#[derive(Deserialize)]
struct RawRelic {
    #[serde(default)] pos: i64,
    #[serde(default)] pos_name: String,
    #[serde(default)] name: String,
    #[serde(default)] rarity: i64,
    #[serde(default)] level: i64,
    #[serde(default)] set: RawSet,
    #[serde(default)] main_property: RawProp,
    #[serde(default)] sub_property_list: Vec<RawProp>,
}

#[derive(Deserialize, Default)]
struct RawSet {
    #[serde(default)] name: String,
}

#[derive(Deserialize, Default, Clone)]
struct RawProp {
    #[serde(default)] property_type: i64,
    #[serde(default)] value: String,
    /// Nombre de rolls obtenus sur cette statistique, donné par l'API.
    #[serde(default)] times: i64,
}

#[derive(Deserialize)]
struct RawRecommend {
    #[serde(default)] recommend_properties: Option<RecommendProps>,
}

#[derive(Deserialize, Default, Clone)]
struct RecommendProps {
    #[serde(default)] sand_main_property_list: Vec<i64>,
    #[serde(default)] goblet_main_property_list: Vec<i64>,
    #[serde(default)] circlet_main_property_list: Vec<i64>,
    #[serde(default)] sub_property_list: Vec<i64>,
}

#[derive(Serialize)]
pub struct Stat {
    pub label: String,
    pub value: String,
    pub times: i64,
    /// Vrai quand HoYoLAB recommande cette statistique pour ce personnage.
    pub wanted: bool,
}

#[derive(Serialize)]
pub struct Relic {
    pub slot: String,
    pub set: String,
    pub name: String,
    pub rarity: i64,
    pub level: i64,
    pub main: Stat,
    /// `None` sur la fleur et la plume, dont la statistique principale est
    /// imposée : il n'y a rien à y juger.
    pub main_ok: Option<bool>,
    pub subs: Vec<Stat>,
}

#[derive(Serialize)]
pub struct CharacterBuild {
    pub character: Character,
    pub weapon: String,
    pub weapon_level: i64,
    pub weapon_refinement: i64,
    pub relics: Vec<Relic>,
    pub crit_value: f64,
    /// Statistiques principales conseillées par HoYoLAB, déjà traduites.
    pub advice: Vec<String>,
}

/// Tous les personnages du compte, artéfacts non compris.
pub async fn fetch_characters(session: &Session, account: &Account) -> Result<Vec<Character>> {
    let http = client()?;
    let body = serde_json::json!({ "role_id": account.uid, "server": account.region });
    let list: CharacterList = post(&http, &format!("{RECORD_BASE}/character/list"), session, &body).await?;
    Ok(list.list)
}

/// Le détail d'un personnage : arme, artéfacts et recommandations HoYoLAB.
pub async fn fetch_character_build(
    session: &Session,
    account: &Account,
    character_id: i64,
) -> Result<CharacterBuild> {
    let http = client()?;
    let body = serde_json::json!({
        "role_id": account.uid,
        "server": account.region,
        "character_ids": [character_id],
    });
    let detail: DetailList =
        post(&http, &format!("{RECORD_BASE}/character/detail"), session, &body).await?;

    let raw = detail
        .list
        .into_iter()
        .next()
        .ok_or_else(|| Error::Msg("Personnage introuvable sur ce compte.".into()))?;

    let rec = raw
        .recommend_relic_property
        .and_then(|r| r.recommend_properties)
        .unwrap_or_default();

    let relics: Vec<Relic> = raw
        .relics
        .iter()
        .map(|r| build_relic(r, &rec))
        .collect();

    let crit_value = raw
        .relics
        .iter()
        .flat_map(|r| r.sub_property_list.iter())
        .map(|p| match p.property_type {
            20 => percent(&p.value) * 2.0,
            22 => percent(&p.value),
            _ => 0.0,
        })
        .sum();

    let advice = [
        ("Sablier", &rec.sand_main_property_list),
        ("Coupe", &rec.goblet_main_property_list),
        ("Couronne", &rec.circlet_main_property_list),
        ("Sous-stats", &rec.sub_property_list),
    ]
    .iter()
    .filter(|(_, ids)| !ids.is_empty())
    .map(|(slot, ids)| {
        let names: Vec<String> = ids.iter().map(|id| property_label(*id)).collect();
        format!("{slot} : {}", names.join(", "))
    })
    .collect();

    Ok(CharacterBuild {
        character: raw.base,
        weapon: raw.weapon.name,
        weapon_level: raw.weapon.level,
        weapon_refinement: raw.weapon.affix_level,
        relics,
        crit_value,
        advice,
    })
}

fn build_relic(r: &RawRelic, rec: &RecommendProps) -> Relic {
    // pos 1 et 2 : fleur et plume, statistique principale imposée.
    let expected = match r.pos {
        3 => Some(&rec.sand_main_property_list),
        4 => Some(&rec.goblet_main_property_list),
        5 => Some(&rec.circlet_main_property_list),
        _ => None,
    };
    let main_ok = expected
        .filter(|ids| !ids.is_empty())
        .map(|ids| ids.contains(&r.main_property.property_type));

    let stat = |p: &RawProp, wanted: bool| Stat {
        label: property_label(p.property_type),
        value: p.value.clone(),
        times: p.times,
        wanted,
    };

    Relic {
        slot: r.pos_name.clone(),
        set: r.set.name.clone(),
        name: r.name.clone(),
        rarity: r.rarity,
        level: r.level,
        main: stat(&r.main_property, main_ok.unwrap_or(true)),
        main_ok,
        subs: r
            .sub_property_list
            .iter()
            .map(|p| stat(p, rec.sub_property_list.contains(&p.property_type)))
            .collect(),
    }
}

/// Les valeurs arrivent formatées (« 11.9% », « 61 ») : on n'en extrait un
/// nombre que pour la valeur critique.
fn percent(value: &str) -> f64 {
    value.trim_end_matches('%').parse().unwrap_or(0.0)
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
