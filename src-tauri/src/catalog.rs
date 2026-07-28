//! Catalogue des personnages depuis Ambr : liste complète avec élément, arme et
//! rareté. Sert le mode « Tous les personnages » et les filtres de la page.
//!
//! Comme le farm, tout vient d'Ambr et se joint à HoYoLAB par l'ID de
//! personnage. On ne garde que le strict nécessaire à l'affichage.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::farm::now_secs;

pub(crate) const AMBR_BASE: &str = "https://gi.yatta.moe/api/v2/fr";
pub(crate) const ASSET_BASE: &str = "https://gi.yatta.moe/assets/UI";

/// Le roster ne bouge qu'à la sortie d'un personnage : une semaine suffit.
const CACHE_MAX_AGE: u64 = 7 * 24 * 3600;

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}

/// Ambr renvoie parfois `null` là où un objet est attendu, un protagoniste
/// sans constellations, par exemple. `#[serde(default)]` ne couvre que
/// l'absence du champ : sans cette conversion, un seul `null` fait échouer
/// toute la réponse (« error decoding response body »).
pub(crate) fn null_to_default<'de, D, T>(de: D) -> std::result::Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(de)?.unwrap_or_default())
}

#[derive(Deserialize)]
struct AvatarList {
    items: HashMap<String, AvatarEntry>,
}

#[derive(Deserialize)]
struct AvatarEntry {
    #[serde(default)] rank: i64,
    #[serde(default)] name: String,
    /// Les protagonistes n'ont pas d'élément fixe : Ambr renvoie `null`. Un
    /// `#[serde(default)]` ne suffit pas, il ne couvre qu'un champ absent, et
    /// un `null` sur un `String` fait échouer toute la réponse.
    #[serde(default)] element: Option<String>,
    #[serde(default, rename = "weaponType")] weapon_type: String,
    #[serde(default)] icon: String,
}

/// Un personnage du catalogue, réduit à ce que la grille affiche.
#[derive(Serialize, Deserialize, Clone)]
pub struct CatalogCharacter {
    /// Identité d'affichage, et clé attendue par Ambr : l'id numérique, ou
    /// « 10000005-geo » pour une variante du Voyageur.
    pub key: String,
    /// Id numérique du jeu, partagé par les variantes d'un même personnage :
    /// sert à l'appariement avec HoYoLAB et aux builds recommandés.
    pub id: i64,
    pub name: String,
    pub rarity: i64,
    /// Clé d'élément (anemo, cryo…) pour la couleur et les filtres.
    pub element: String,
    pub element_label: String,
    /// Clé d'arme (sword, claymore…) pour les filtres.
    pub weapon: String,
    pub weapon_label: String,
    pub icon: String,
}

#[derive(Serialize, Deserialize)]
pub struct Catalog {
    pub fetched_at: u64,
    pub characters: Vec<CatalogCharacter>,
}

impl Catalog {
    pub fn is_stale(&self, now: u64) -> bool {
        now.saturating_sub(self.fetched_at) > CACHE_MAX_AGE
    }
}

pub async fn fetch() -> Result<Catalog> {
    let http = reqwest::Client::builder().build()?;
    let url = format!("{AMBR_BASE}/avatar");
    let env: Envelope<AvatarList> = http.get(&url).send().await?.json().await?;

    // Le Voyageur apparaît une fois par élément (« 10000005-geo ») : chaque
    // variante reste une entrée à part entière, comme dans le jeu de données
    // des équipes, qui les distingue déjà.
    let mut characters: Vec<CatalogCharacter> = env
        .data
        .items
        .into_iter()
        .filter_map(|(key, entry)| to_character(&key, entry))
        .collect();

    if characters.is_empty() {
        return Err(Error::Msg(
            "Catalogue vide : l'API Ambr a probablement changé de format.".into(),
        ));
    }

    characters.sort_by(|a, b| b.rarity.cmp(&a.rarity).then_with(|| a.name.cmp(&b.name)));
    Ok(Catalog { fetched_at: now_secs(), characters })
}

fn to_character(key: &str, e: AvatarEntry) -> Option<CatalogCharacter> {
    // L'id numérique est le préfixe avant un éventuel suffixe (voyageur).
    let id: i64 = key.split('-').next()?.parse().ok()?;
    if e.rank < 4 {
        return None;
    }
    let (element, element_label) = element_of(e.element.as_deref().unwrap_or(""));
    let (weapon, weapon_label) = weapon_of(&e.weapon_type);
    // Les variantes du Voyageur partagent nom et id : leur élément les sépare.
    let name = match key.contains('-') {
        true => format!("{} {element_label}", e.name),
        false => e.name,
    };
    Some(CatalogCharacter {
        key: key.to_string(),
        id,
        name,
        rarity: e.rank,
        element,
        element_label,
        weapon,
        weapon_label,
        icon: format!("{ASSET_BASE}/{}.png", e.icon),
    })
}

/// Code interne Ambr → (clé Gensheet, libellé français).
fn element_of(code: &str) -> (String, String) {
    let (key, label) = match code {
        "Wind" => ("anemo", "Anémo"),
        "Ice" => ("cryo", "Cryo"),
        "Grass" => ("dendro", "Dendro"),
        "Electric" => ("electro", "Électro"),
        "Rock" => ("geo", "Géo"),
        "Water" => ("hydro", "Hydro"),
        "Fire" => ("pyro", "Pyro"),
        // Sans élément fixe (protagonistes).
        "" => ("autre", "-"),
        other => ("autre", other),
    };
    (key.to_string(), label.to_string())
}

pub(crate) fn weapon_of(code: &str) -> (String, String) {
    let (key, label) = match code {
        "WEAPON_SWORD_ONE_HAND" => ("sword", "Épée à une main"),
        "WEAPON_CLAYMORE" => ("claymore", "Épée à deux mains"),
        "WEAPON_POLE" => ("polearm", "Arme d'hast"),
        "WEAPON_BOW" => ("bow", "Arc"),
        "WEAPON_CATALYST" => ("catalyst", "Catalyseur"),
        other => ("autre", other),
    };
    (key.to_string(), label.to_string())
}

// --- Détail d'un personnage (talents, constellations, ascension) -----------

/// Un talent : nom + nature (combat, sprint alternatif, passif) + description.
#[derive(Serialize)]
pub struct Talent {
    pub name: String,
    pub kind: String,
    pub description: String,
    pub icon: String,
}

#[derive(Serialize)]
pub struct Constellation {
    pub name: String,
    pub description: String,
    pub icon: String,
}

/// Un matériau d'ascension et sa quantité sur un palier.
#[derive(Serialize)]
pub struct Material {
    pub name: String,
    pub rank: i64,
    pub icon: String,
    pub count: i64,
}

/// Un palier d'ascension (ex. 20 → 40) : mora et matériaux requis.
#[derive(Serialize)]
pub struct AscensionPhase {
    pub from_level: i64,
    pub max_level: i64,
    pub mora: i64,
    pub materials: Vec<Material>,
}

#[derive(Serialize)]
pub struct CharacterDetail {
    pub talents: Vec<Talent>,
    pub constellations: Vec<Constellation>,
    pub ascension: Vec<AscensionPhase>,
}

#[derive(Deserialize)]
struct DetailRaw {
    #[serde(default, deserialize_with = "null_to_default")] talent: HashMap<String, TalentRaw>,
    #[serde(default, deserialize_with = "null_to_default")] constellation: HashMap<String, ConstRaw>,
    #[serde(default, deserialize_with = "null_to_default")] upgrade: UpgradeRaw,
    #[serde(default, deserialize_with = "null_to_default")] items: HashMap<String, ItemRaw>,
}

#[derive(Deserialize)]
struct TalentRaw {
    #[serde(default)] name: String,
    #[serde(default)] r#type: i64,
    #[serde(default)] description: String,
    #[serde(default)] icon: String,
}

#[derive(Deserialize)]
struct ConstRaw {
    #[serde(default)] name: String,
    #[serde(default)] description: String,
    #[serde(default)] icon: String,
}

#[derive(Deserialize, Default)]
struct UpgradeRaw {
    #[serde(default, deserialize_with = "null_to_default")] promote: Vec<PromoteRaw>,
}

#[derive(Deserialize)]
struct PromoteRaw {
    #[serde(default, deserialize_with = "null_to_default", rename = "costItems")] cost_items: HashMap<String, i64>,
    #[serde(default, rename = "coinCost")] coin_cost: i64,
    #[serde(default, rename = "unlockMaxLevel")] unlock_max_level: i64,
}

#[derive(Deserialize)]
struct ItemRaw {
    #[serde(default)] name: String,
    #[serde(default)] rank: i64,
    #[serde(default)] icon: String,
}

/// `key` est celle du catalogue : Ambr sert aussi le détail d'une variante du
/// Voyageur, avec ses propres talents et constellations.
pub async fn fetch_detail(key: &str) -> Result<CharacterDetail> {
    let http = reqwest::Client::builder().build()?;
    let url = format!("{AMBR_BASE}/avatar/{key}");
    let env: Envelope<DetailRaw> = http.get(&url).send().await?.json().await?;
    let d = env.data;

    let talents = sorted_by_key(d.talent)
        .into_iter()
        .map(|t| Talent {
            name: t.name,
            kind: talent_kind(t.r#type),
            description: clean(&t.description),
            icon: asset(&t.icon),
        })
        .collect();

    let constellations = sorted_by_key(d.constellation)
        .into_iter()
        .map(|c| Constellation {
            name: c.name,
            description: clean(&c.description),
            icon: asset(&c.icon),
        })
        .collect();

    // Détaille chaque palier d'ascension (le premier, 1 → 20, est sans coût).
    let mut ascension = Vec::new();
    let mut from_level = 1;
    for p in &d.upgrade.promote {
        if p.cost_items.is_empty() && p.coin_cost == 0 {
            from_level = p.unlock_max_level;
            continue;
        }
        let mut materials: Vec<Material> = p
            .cost_items
            .iter()
            .filter_map(|(mat_id, &count)| {
                let info = d.items.get(mat_id)?;
                Some(Material {
                    name: info.name.clone(),
                    rank: info.rank,
                    icon: asset(&info.icon),
                    count,
                })
            })
            .collect();
        materials.sort_by(|a, b| b.rank.cmp(&a.rank).then_with(|| a.name.cmp(&b.name)));
        ascension.push(AscensionPhase {
            from_level,
            max_level: p.unlock_max_level,
            mora: p.coin_cost,
            materials,
        });
        from_level = p.unlock_max_level;
    }

    Ok(CharacterDetail { talents, constellations, ascension })
}

fn asset(icon: &str) -> String {
    format!("{ASSET_BASE}/{icon}.png")
}

/// Retire les balises de mise en forme du jeu (`<color=…>`, `<i>`…) en gardant
/// le texte et les retours à la ligne.
pub(crate) fn clean(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn talent_kind(kind: i64) -> String {
    match kind {
        0 => "Combat",
        1 => "Sprint alternatif",
        _ => "Passif",
    }
    .to_string()
}

/// Trie une map à clés numériques par ordre de clé et renvoie les valeurs.
fn sorted_by_key<T>(map: HashMap<String, T>) -> Vec<T> {
    let mut pairs: Vec<(i64, T)> = map
        .into_iter()
        .map(|(k, v)| (k.parse().unwrap_or(i64::MAX), v))
        .collect();
    pairs.sort_by_key(|(k, _)| *k);
    pairs.into_iter().map(|(_, v)| v).collect()
}
