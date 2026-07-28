//! Catalogue des armes depuis Ambr : liste filtrable et fiche détaillée.
//!
//! Même approche que le catalogue des personnages, cache local et données
//! réduites à ce que l'interface affiche. Les armes de rang 1 et 2 n'ont ni
//! passif ni statistique secondaire : les deux champs restent vides.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::catalog::{clean, null_to_default, weapon_of, AMBR_BASE, ASSET_BASE};
use crate::error::{Error, Result};
use crate::farm::now_secs;

/// Le catalogue ne bouge qu'à la sortie d'une arme : une semaine suffit.
const CACHE_MAX_AGE: u64 = 7 * 24 * 3600;

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}

#[derive(Deserialize)]
struct WeaponList {
    items: HashMap<String, WeaponEntry>,
}

#[derive(Deserialize)]
struct WeaponEntry {
    #[serde(default)] id: i64,
    #[serde(default)] rank: i64,
    #[serde(default)] r#type: String,
    #[serde(default)] name: String,
    #[serde(default, rename = "specialProp")] special_prop: String,
    #[serde(default)] icon: String,
}

/// Une arme du catalogue, réduite à ce que la grille affiche.
#[derive(Serialize, Deserialize, Clone)]
pub struct CatalogWeapon {
    pub id: i64,
    pub name: String,
    pub rarity: i64,
    /// Clé de type (sword, claymore…) pour les filtres.
    pub kind: String,
    pub kind_label: String,
    /// Statistique secondaire, traduite. Vide sur les armes qui n'en ont pas.
    pub sub_stat: String,
    pub icon: String,
}

#[derive(Serialize, Deserialize)]
pub struct WeaponCatalog {
    pub fetched_at: u64,
    pub weapons: Vec<CatalogWeapon>,
}

impl WeaponCatalog {
    pub fn is_stale(&self, now: u64) -> bool {
        now.saturating_sub(self.fetched_at) > CACHE_MAX_AGE
    }
}

pub async fn fetch() -> Result<WeaponCatalog> {
    let http = reqwest::Client::builder().build()?;
    let url = format!("{AMBR_BASE}/weapon");
    let env: Envelope<WeaponList> = http.get(&url).send().await?.json().await?;

    // Les armes 1★ et 2★ ne sont ni améliorables ni jamais recommandées : hors
    // catalogue, comme les personnages de rang inférieur à 4.
    let mut weapons: Vec<CatalogWeapon> = env
        .data
        .items
        .into_values()
        .filter(|e| e.rank >= 3)
        .map(to_weapon)
        .collect();
    if weapons.is_empty() {
        return Err(Error::Msg(
            "Catalogue d'armes vide : l'API Ambr a probablement changé de format.".into(),
        ));
    }

    weapons.sort_by(|a, b| b.rarity.cmp(&a.rarity).then_with(|| a.name.cmp(&b.name)));
    Ok(WeaponCatalog { fetched_at: now_secs(), weapons })
}

fn to_weapon(e: WeaponEntry) -> CatalogWeapon {
    let (kind, kind_label) = weapon_of(&e.r#type);
    CatalogWeapon {
        id: e.id,
        name: e.name,
        rarity: e.rank,
        kind,
        kind_label,
        sub_stat: stat_label(&e.special_prop).to_string(),
        icon: format!("{ASSET_BASE}/{}.png", e.icon),
    }
}

/// Code interne du jeu → libellé français, aligné sur ceux des builds.
fn stat_label(code: &str) -> &'static str {
    match code {
        "FIGHT_PROP_ATTACK_PERCENT" => "ATQ%",
        "FIGHT_PROP_DEFENSE_PERCENT" => "DÉF%",
        "FIGHT_PROP_HP_PERCENT" => "PV%",
        "FIGHT_PROP_ELEMENT_MASTERY" => "Maîtrise élém.",
        "FIGHT_PROP_CHARGE_EFFICIENCY" => "Recharge d'énergie",
        "FIGHT_PROP_CRITICAL" => "Taux Crit",
        "FIGHT_PROP_CRITICAL_HURT" => "DGT Crit",
        "FIGHT_PROP_PHYSICAL_ADD_HURT" => "DGT physiques",
        "FIGHT_PROP_HEAL_ADD" => "Bonus de soins",
        "FIGHT_PROP_ELEMENT_ADD_HURT" => "DGT élémentaires",
        _ => "",
    }
}

// --- Fiche d'une arme -------------------------------------------------------

/// Fiche complète : statistiques de départ et passif à chaque raffinement.
#[derive(Serialize)]
pub struct WeaponDetail {
    pub id: i64,
    pub name: String,
    pub rarity: i64,
    pub kind_label: String,
    pub icon: String,
    pub description: String,
    /// ATQ de base au niveau 1.
    pub base_atk: f64,
    /// Statistique secondaire et sa valeur de départ, vides si l'arme n'en a pas.
    pub sub_stat: String,
    pub sub_value: String,
    /// Nom du passif, vide sur les armes de rang 1 et 2.
    pub affix_name: String,
    /// Texte du passif du raffinement 1 au raffinement 5.
    pub refinements: Vec<String>,
}

#[derive(Deserialize)]
struct DetailRaw {
    #[serde(default)] id: i64,
    #[serde(default)] rank: i64,
    #[serde(default)] r#type: String,
    #[serde(default)] name: String,
    #[serde(default)] description: String,
    #[serde(default)] icon: String,
    #[serde(default, deserialize_with = "null_to_default")] affix: HashMap<String, AffixRaw>,
    #[serde(default, deserialize_with = "null_to_default")] upgrade: UpgradeRaw,
}

#[derive(Deserialize)]
struct AffixRaw {
    #[serde(default)] name: String,
    #[serde(default, deserialize_with = "null_to_default")] upgrade: HashMap<String, String>,
}

#[derive(Deserialize, Default)]
struct UpgradeRaw {
    #[serde(default, deserialize_with = "null_to_default")] prop: Vec<PropRaw>,
}

#[derive(Deserialize)]
struct PropRaw {
    #[serde(default, rename = "propType")] prop_type: Option<String>,
    #[serde(default, rename = "initValue")] init_value: f64,
}

pub async fn fetch_detail(id: i64) -> Result<WeaponDetail> {
    let http = reqwest::Client::builder().build()?;
    let url = format!("{AMBR_BASE}/weapon/{id}");
    let env: Envelope<DetailRaw> = http.get(&url).send().await?.json().await?;
    let d = env.data;

    let prop_of = |name: &str| {
        d.upgrade
            .prop
            .iter()
            .find(|p| p.prop_type.as_deref() == Some(name))
            .map(|p| p.init_value)
    };
    let base_atk = prop_of("FIGHT_PROP_BASE_ATTACK").unwrap_or(0.0);

    // La statistique secondaire est la seule autre entrée, quand elle existe.
    let sub = d
        .upgrade
        .prop
        .iter()
        .find(|p| p.prop_type.as_deref() != Some("FIGHT_PROP_BASE_ATTACK"));
    let (sub_stat, sub_value) = match sub {
        Some(p) => {
            let code = p.prop_type.as_deref().unwrap_or("");
            (stat_label(code).to_string(), format_stat(code, p.init_value))
        }
        None => (String::new(), String::new()),
    };

    // Le passif est indexé par un identifiant unique ; ses paliers vont de 0 à 4.
    let affix = d.affix.into_values().next();
    let (affix_name, refinements) = match affix {
        Some(a) => {
            let mut steps: Vec<(i64, String)> = a
                .upgrade
                .into_iter()
                .filter_map(|(k, v)| Some((k.parse().ok()?, clean_text(&v))))
                .collect();
            steps.sort_by_key(|(rank, _)| *rank);
            (a.name, steps.into_iter().map(|(_, text)| text).collect())
        }
        None => (String::new(), Vec::new()),
    };

    Ok(WeaponDetail {
        id: d.id,
        rarity: d.rank,
        name: d.name,
        kind_label: d.r#type,
        icon: format!("{ASSET_BASE}/{}.png", d.icon),
        description: clean_text(&d.description),
        base_atk,
        sub_stat,
        sub_value,
        affix_name,
        refinements,
    })
}

/// Les pourcentages arrivent en fraction (0.096), les valeurs plates en clair.
fn format_stat(code: &str, value: f64) -> String {
    match code {
        "FIGHT_PROP_ELEMENT_MASTERY" => format!("{value:.0}"),
        _ => format!("{:.1} %", value * 100.0),
    }
}

/// Retire les balises de couleur, les marqueurs de mise en forme et les
/// espaces insécables notés en toutes lettres par le jeu.
fn clean_text(text: &str) -> String {
    clean(text)
        .replace("{NON_BREAK_SPACE}", " ")
        .replace("{LAYOUT_MOBILE#}", "")
        .replace("\\n", "\n")
        .trim_start_matches('#')
        .trim()
        .to_string()
}
