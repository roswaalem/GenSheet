//! Profil d'un compte : compteurs (coffres, hauts faits, abysse…), personnages
//! en résumé et progression d'exploration.

use serde::{Deserialize, Serialize};

use super::http::{self, Session};
use super::{Account, RECORD_BASE};
use crate::error::{Error, Result};

const CARD_URL: &str = "https://bbs-api-os.hoyolab.com/game_record/card/wapi/getGameRecordCard";
// game_id 2 == Genshin Impact dans la liste des cartes HoYoLAB.
const GENSHIN_GAME_ID: i64 = 2;

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

/// Trouve le compte Genshin lié à la session.
pub async fn find_account(session: &Session) -> Result<Account> {
    let http = http::client()?;
    let url = format!("{CARD_URL}?uid={}", session.ltuid);
    let cards: CardList = http::get(&http, &url, session).await?;
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
        .ok_or_else(|| {
            Error::Msg(
                "Aucun compte Genshin sur ce profil HoYoLAB : vérifie que l'affichage public du profil est activé.".into(),
            )
        })
}

#[derive(Deserialize)]
struct IndexData {
    stats: Stats,
    #[serde(default)]
    avatars: Vec<Avatar>,
    #[serde(default)]
    world_explorations: Vec<Exploration>,
}

/// Compteurs de profil. `#[serde(default)]` partout : HoYoverse ajoute et
/// retire des champs entre versions, un champ manquant ne doit pas faire
/// échouer toute la synchro.
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

/// Tout ce que le tableau de bord affiche pour un profil HoYoLAB.
#[derive(Serialize, Clone)]
pub struct Profile {
    pub account: Account,
    pub stats: Stats,
    pub avatars: Vec<Avatar>,
    pub explorations: Vec<Exploration>,
}

/// Compteurs, personnages et exploration pour un compte donné.
pub async fn fetch_profile(session: &Session, account: &Account) -> Result<Profile> {
    let http = http::client()?;
    let url = format!(
        "{RECORD_BASE}/index?server={}&role_id={}",
        account.region, account.uid
    );
    let data: IndexData = http::get(&http, &url, session).await?;
    Ok(Profile {
        account: account.clone(),
        stats: data.stats,
        avatars: data.avatars,
        explorations: data.world_explorations,
    })
}
