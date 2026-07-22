//! Planning de farm : quels donjons ouverts aujourd'hui concernent quels
//! personnages du compte.
//!
//! Tout est déduit des données statiques d'Ambr — aucune recommandation
//! écrite à la main. La jointure se fait sur l'ID de personnage, identique
//! chez Ambr et chez HoYoLAB, donc sans correspondance de noms à deviner.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

// Ambr a quitté api.ambr.top, qui ne résout plus.
const AMBR_BASE: &str = "https://gi.yatta.moe/api/v2/fr";

/// Les données ne bougent qu'à la sortie d'un personnage : une semaine de
/// cache suffit largement.
const CACHE_MAX_AGE: u64 = 7 * 24 * 3600;

pub const DAYS: [&str; 7] = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

// --- Réponses Ambr ---------------------------------------------------------

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Domain {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub reward: Vec<i64>,
    #[serde(default)]
    pub city: i64,
}

#[derive(Deserialize)]
struct UpgradeData {
    avatar: HashMap<String, UpgradeEntry>,
}

#[derive(Deserialize)]
struct UpgradeEntry {
    #[serde(default)]
    items: HashMap<String, i64>,
}

#[derive(Deserialize)]
struct MaterialData {
    items: HashMap<String, MaterialInfo>,
}

#[derive(Deserialize)]
struct MaterialInfo {
    #[serde(default)]
    name: String,
    #[serde(default)]
    r#type: String,
}

// --- Données réduites, mises en cache --------------------------------------

/// Ce qu'on garde des 235 Ko d'Ambr : uniquement ce qui sert à la jointure.
#[derive(Serialize, Deserialize)]
pub struct FarmData {
    pub fetched_at: u64,
    pub days: HashMap<String, Vec<Domain>>,
    /// Matériaux qui tombent en donjon, id -> nom.
    pub materials: HashMap<i64, String>,
    /// Personnage -> matériaux de donjon dont il a besoin.
    pub avatars: HashMap<i64, Vec<i64>>,
}

impl FarmData {
    pub fn is_stale(&self, now: u64) -> bool {
        now.saturating_sub(self.fetched_at) > CACHE_MAX_AGE
    }

    /// Vrai si un personnage du compte est inconnu : signe d'une sortie
    /// récente, donc d'un cache à rafraîchir avant l'heure.
    pub fn misses_any(&self, avatar_ids: &[i64]) -> bool {
        avatar_ids.iter().any(|id| !self.avatars.contains_key(id))
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

async fn get<T: serde::de::DeserializeOwned>(http: &reqwest::Client, path: &str) -> Result<T> {
    let url = format!("{AMBR_BASE}/{path}");
    let envelope: Envelope<T> = http.get(&url).send().await?.json().await?;
    Ok(envelope.data)
}

/// Télécharge les trois jeux de données et n'en garde que le nécessaire.
pub async fn fetch() -> Result<FarmData> {
    let http = reqwest::Client::builder().build()?;

    let daily: HashMap<String, HashMap<String, Domain>> = get(&http, "dailyDungeon").await?;
    let upgrade: UpgradeData = get(&http, "upgrade").await?;
    let materials: MaterialData = get(&http, "material").await?;

    let days: HashMap<String, Vec<Domain>> = daily
        .into_iter()
        .map(|(day, domains)| (day, domains.into_values().collect()))
        .collect();

    // Seuls les matériaux effectivement distribués en donjon nous intéressent :
    // ça écarte la mora et les autres récompenses génériques.
    let in_domains: HashSet<i64> = days
        .values()
        .flat_map(|domains| domains.iter().flat_map(|d| d.reward.iter().copied()))
        .collect();

    let materials: HashMap<i64, String> = materials
        .items
        .into_iter()
        .filter_map(|(id, info)| {
            let id: i64 = id.parse().ok()?;
            // Les types génériques (mora, EXP) n'ont rien à faire dans un plan.
            let farmable = info.r#type == "characterTalentMaterial"
                || info.r#type == "weaponAscensionMaterial";
            (in_domains.contains(&id) && farmable).then(|| (id, info.name))
        })
        .collect();

    let avatars: HashMap<i64, Vec<i64>> = upgrade
        .avatar
        .into_iter()
        .filter_map(|(id, entry)| {
            let id: i64 = id.parse().ok()?;
            let needed: Vec<i64> = entry
                .items
                .keys()
                .filter_map(|m| m.parse::<i64>().ok())
                .filter(|m| materials.contains_key(m))
                .collect();
            (!needed.is_empty()).then(|| (id, needed))
        })
        .collect();

    if days.is_empty() || avatars.is_empty() {
        return Err(Error::Msg(
            "Données de farm vides : l'API Ambr a probablement changé de format.".into(),
        ));
    }

    Ok(FarmData {
        fetched_at: now_secs(),
        days,
        materials,
        avatars,
    })
}

// --- Plan ------------------------------------------------------------------

#[derive(Serialize)]
pub struct DomainPlan {
    pub name: String,
    pub materials: Vec<String>,
    /// Personnages du compte concernés ; le front y recolle ses propres
    /// noms et portraits, déjà localisés par HoYoLAB.
    pub character_ids: Vec<i64>,
}

#[derive(Serialize)]
pub struct FarmPlan {
    pub day: String,
    pub domains: Vec<DomainPlan>,
    /// Personnages du compte absents des données Ambr, signalés plutôt
    /// qu'ignorés en silence.
    pub unknown_ids: Vec<i64>,
}

/// Croise les donjons du jour avec les personnages possédés.
pub fn plan(data: &FarmData, day: &str, avatar_ids: &[i64]) -> FarmPlan {
    let unknown_ids = avatar_ids
        .iter()
        .copied()
        .filter(|id| !data.avatars.contains_key(id))
        .collect();

    let mut domains: Vec<DomainPlan> = data
        .days
        .get(day)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|domain| {
            let rewards: HashSet<i64> = domain.reward.iter().copied().collect();

            let character_ids: Vec<i64> = avatar_ids
                .iter()
                .copied()
                .filter(|id| {
                    data.avatars
                        .get(id)
                        .is_some_and(|needed| needed.iter().any(|m| rewards.contains(m)))
                })
                .collect();

            // Un donjon sans personnage concerné n'a rien à faire dans un plan :
            // c'est typiquement un donjon d'armes, que Gensheet ne peut pas
            // encore rattacher faute de connaître l'inventaire d'armes.
            if character_ids.is_empty() {
                return None;
            }

            let mut materials: Vec<String> = rewards
                .iter()
                .filter_map(|id| data.materials.get(id).cloned())
                .collect();
            materials.sort();
            materials.dedup();

            Some(DomainPlan {
                name: domain.name.clone(),
                materials,
                character_ids,
            })
        })
        .collect();

    domains.sort_by(|a, b| b.character_ids.len().cmp(&a.character_ids.len()));

    FarmPlan {
        day: day.to_string(),
        domains,
        unknown_ids,
    }
}
