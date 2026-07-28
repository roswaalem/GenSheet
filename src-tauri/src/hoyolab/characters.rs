//! Détail d'un personnage : arme, artéfacts et statistiques conseillées par
//! HoYoLAB, plus le calcul de la valeur critique.

use serde::{Deserialize, Serialize};

use super::http::{self, Session};
use super::{Account, RECORD_BASE};
use crate::error::{Error, Result};

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

/// Une statistique d'artéfact (principale ou secondaire), déjà formatée.
#[derive(Serialize)]
pub struct Stat {
    pub label: String,
    pub value: String,
    pub times: i64,
    /// Vrai quand HoYoLAB recommande cette statistique pour ce personnage.
    pub wanted: bool,
}

/// Un artéfact équipé, avec le verdict sur sa statistique principale.
#[derive(Serialize)]
pub struct Relic {
    pub slot: String,
    pub set: String,
    pub name: String,
    pub icon: String,
    pub rarity: i64,
    pub level: i64,
    pub main: Stat,
    /// `None` sur la fleur et la plume, dont la statistique principale est
    /// imposée : il n'y a rien à y juger.
    pub main_ok: Option<bool>,
    pub subs: Vec<Stat>,
}

/// Le build complet renvoyé à l'interface.
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
    let http = http::client()?;
    let body = serde_json::json!({ "role_id": account.uid, "server": account.region });
    let list: CharacterList =
        http::post(&http, &format!("{RECORD_BASE}/character/list"), session, &body).await?;
    Ok(list.list)
}

/// Le détail d'un personnage : arme, artéfacts et recommandations HoYoLAB.
pub async fn fetch_character_build(
    session: &Session,
    account: &Account,
    character_id: i64,
) -> Result<CharacterBuild> {
    let http = http::client()?;
    let body = serde_json::json!({
        "role_id": account.uid,
        "server": account.region,
        "character_ids": [character_id],
    });
    let detail: DetailList =
        http::post(&http, &format!("{RECORD_BASE}/character/detail"), session, &body).await?;

    let raw = detail
        .list
        .into_iter()
        .next()
        .ok_or_else(|| Error::Msg("Personnage introuvable sur ce compte.".into()))?;

    let rec = raw
        .recommend_relic_property
        .and_then(|r| r.recommend_properties)
        .unwrap_or_default();

    let relics: Vec<Relic> = raw.relics.iter().map(|r| build_relic(r, &rec)).collect();

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
        icon: r.icon.clone(),
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

/// Statistiques numérotées par l'API. Table dérivée des valeurs observées sur
/// un personnage réel (Taux CRIT à 5 %, Recharge à 100 %, DGT physiques…)
/// plutôt que devinée. Les valeurs arrivent déjà formatées par HoYoLAB : un
/// type non répertorié reste affichable, seul son libellé manque.
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

// --- Réponses brutes de l'API ----------------------------------------------

#[derive(Deserialize)]
struct CharacterList {
    #[serde(default)]
    list: Vec<Character>,
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
    #[serde(default)] icon: String,
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
