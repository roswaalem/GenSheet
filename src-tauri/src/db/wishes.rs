//! Table des vœux : insertion, historique paginé, statistiques globales et
//! analyse par bannière (pity, moyennes, chance façon paimon.moe).

use rusqlite::params;
use serde::Serialize;

use super::Db;
use crate::error::Result;
use crate::gacha::WishItem;

/// Bannières analysées : clé, libellé, et moyenne communautaire de référence
/// pour un 5★ (utilisée pour l'indice de chance). Le regroupement des types
/// (301 + 400 partagent le pity) vit dans `banner_filter`.
const BANNERS: [(&str, &str, f64); 5] = [
    ("301", "Personnage", 62.5),
    ("302", "Arme", 62.5),
    ("500", "Chronique", 62.5),
    ("200", "Permanent", 62.5),
    ("100", "Débutant", 62.5),
];

#[derive(Serialize)]
pub struct WishPage {
    pub total: u64,
    pub items: Vec<WishItem>,
}

#[derive(Serialize)]
pub struct DashboardStats {
    pub total_wishes: u64,
    pub five_stars: u64,
    pub four_stars: u64,
    pub primogems_spent: u64,
    pub pity_character: u64,
}

/// Un 5★ obtenu, avec le nombre de tirages qu'il a coûté (son pity).
#[derive(Serialize)]
pub struct FiveStar {
    pub name: String,
    pub pity: u64,
    pub time: String,
}

/// Statistiques d'une bannière : compte, pity courant, moyenne et chance.
#[derive(Serialize)]
pub struct BannerStats {
    pub banner: String,
    pub label: String,
    pub total: u64,
    pub five_stars: u64,
    pub four_stars: u64,
    /// Tirages depuis le dernier 5★ (pity en cours).
    pub pity: u64,
    /// Pity moyen d'un 5★ sur cette bannière (`None` si aucun 5★).
    pub avg_five_pity: Option<f64>,
    /// Moyenne de référence à laquelle se comparer.
    pub reference_pity: f64,
    /// `avg - reference` : négatif = chanceux, positif = malchanceux.
    pub luck_delta: Option<f64>,
    pub five_history: Vec<FiveStar>,
    pub primogems: u64,
}

impl Db {
    pub fn insert_wishes(&self, items: &[WishItem]) -> Result<u64> {
        let mut conn = self.0.lock().unwrap();
        let tx = conn.transaction()?;
        let mut inserted = 0u64;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO wishes (id, uid, gacha_type, time, name, item_type, rank_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for w in items {
                inserted += stmt.execute(params![
                    w.id, w.uid, w.gacha_type, w.time, w.name, w.item_type, w.rank_type
                ])? as u64;
            }
        }
        tx.commit()?;
        Ok(inserted)
    }

    /// Historique paginé, éventuellement restreint à une bannière.
    ///
    /// Les ids de vœux sont des chaînes numériques de largeur fixe : l'ordre
    /// lexical décroissant est donc l'ordre chronologique décroissant.
    pub fn wish_history(&self, page: u64, per_page: u64, banner: Option<String>) -> Result<WishPage> {
        let conn = self.0.lock().unwrap();
        let offset = page.saturating_sub(1) * per_page;
        let filter = banner_filter(banner.as_deref());

        let total: u64 =
            conn.query_row(&format!("SELECT COUNT(*) FROM wishes {filter}"), [], |r| r.get(0))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT id, uid, gacha_type, time, name, item_type, rank_type
             FROM wishes {filter} ORDER BY id DESC LIMIT ?1 OFFSET ?2",
        ))?;
        let items = stmt
            .query_map(params![per_page, offset], row_to_wish)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(WishPage { total, items })
    }

    pub fn stats(&self) -> Result<DashboardStats> {
        let conn = self.0.lock().unwrap();
        let total: u64 = conn.query_row("SELECT COUNT(*) FROM wishes", [], |r| r.get(0))?;
        let five: u64 = conn.query_row(
            "SELECT COUNT(*) FROM wishes WHERE rank_type = '5'", [], |r| r.get(0))?;
        let four: u64 = conn.query_row(
            "SELECT COUNT(*) FROM wishes WHERE rank_type = '4'", [], |r| r.get(0))?;
        // Les bannières 301 et 400 partagent le même compteur de pity.
        let pity: u64 = conn.query_row(
            "SELECT COUNT(*) FROM wishes WHERE gacha_type IN ('301','400')
             AND id > COALESCE(
                (SELECT MAX(id) FROM wishes
                 WHERE gacha_type IN ('301','400') AND rank_type = '5'), '0')",
            [],
            |r| r.get(0),
        )?;
        Ok(DashboardStats {
            total_wishes: total,
            five_stars: five,
            four_stars: four,
            primogems_spent: total * 160,
            pity_character: pity,
        })
    }

    /// Analyse chaque bannière : compte, pity courant, moyenne et chance.
    pub fn wish_analysis(&self) -> Result<Vec<BannerStats>> {
        let conn = self.0.lock().unwrap();
        let mut out = Vec::new();

        for (key, label, reference) in BANNERS {
            let filter = banner_filter(Some(key));
            let mut stmt = conn.prepare(&format!(
                "SELECT rank_type, name, time FROM wishes {filter} ORDER BY id ASC",
            ))?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })?;

            // On parcourt du plus ancien au plus récent en comptant les tirages
            // écoulés : à chaque 5★, cet écart est son pity, puis on repart à 0.
            let mut total = 0u64;
            let mut four = 0u64;
            let mut since = 0u64;
            let mut history = Vec::new();
            for row in rows {
                let (rank, name, time) = row?;
                total += 1;
                since += 1;
                match rank.as_str() {
                    "5" => {
                        history.push(FiveStar { name, pity: since, time });
                        since = 0;
                    }
                    "4" => four += 1,
                    _ => {}
                }
            }

            let five = history.len() as u64;
            let avg = (five > 0)
                .then(|| history.iter().map(|f| f.pity).sum::<u64>() as f64 / five as f64);

            out.push(BannerStats {
                banner: key.to_string(),
                label: label.to_string(),
                total,
                five_stars: five,
                four_stars: four,
                pity: since,
                avg_five_pity: avg,
                reference_pity: reference,
                luck_delta: avg.map(|a| a - reference),
                five_history: history,
                primogems: total * 160,
            });
        }
        Ok(out)
    }
}

/// Clause `WHERE` restreignant à une bannière. Les valeurs sont une liste
/// blanche codée en dur (aucune entrée utilisateur), donc sûres à injecter.
fn banner_filter(banner: Option<&str>) -> String {
    let types: &[&str] = match banner {
        Some("301") => &["301", "400"],
        Some("302") => &["302"],
        Some("200") => &["200"],
        Some("100") => &["100"],
        Some("500") => &["500"],
        _ => return String::new(),
    };
    let list = types.iter().map(|t| format!("'{t}'")).collect::<Vec<_>>().join(",");
    format!("WHERE gacha_type IN ({list})")
}

fn row_to_wish(row: &rusqlite::Row) -> rusqlite::Result<WishItem> {
    Ok(WishItem {
        id: row.get(0)?,
        uid: row.get(1)?,
        gacha_type: row.get(2)?,
        time: row.get(3)?,
        name: row.get(4)?,
        item_type: row.get(5)?,
        rank_type: row.get(6)?,
    })
}
