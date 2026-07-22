use std::path::Path;
use std::sync::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
use crate::codes::CodeInfo;
use crate::error::Result;
use crate::gacha::WishItem;

pub struct Db(Mutex<Connection>);

#[derive(Serialize, Default)]
pub struct SyncCount {
    pub added: u64,
    pub removed: u64,
}

/// Un code tel que stocké. La liste ne contient que des codes vivants (plus
/// ceux saisis à la main) ; `status` est notre suivi personnel et n'est jamais
/// écrasé par une actualisation.
#[derive(Serialize)]
pub struct CodeRow {
    pub code: String,
    pub rewards: String,
    pub source: String,
    pub status: String,
    pub message: String,
    pub first_seen: String,
    pub availability: String,
    pub last_seen: Option<String>,
}

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

impl Db {
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let conn = Connection::open(dir.join("gensheet.db"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS wishes (
                id         TEXT PRIMARY KEY,
                uid        TEXT NOT NULL,
                gacha_type TEXT NOT NULL,
                time       TEXT NOT NULL,
                name       TEXT NOT NULL,
                item_type  TEXT NOT NULL,
                rank_type  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_wishes_uid_type ON wishes(uid, gacha_type, id);

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS codes (
                code         TEXT PRIMARY KEY,
                rewards      TEXT NOT NULL DEFAULT '',
                source       TEXT NOT NULL DEFAULT '',
                first_seen   TEXT NOT NULL,
                status       TEXT NOT NULL DEFAULT 'new',
                message      TEXT NOT NULL DEFAULT '',
                tried_at     TEXT,
                availability TEXT NOT NULL DEFAULT 'unknown',
                last_seen    TEXT
            );",
        )?;

        // Migration : la table `codes` a existé sans le suivi de disponibilité.
        for (column, ddl) in [
            ("availability", "ALTER TABLE codes ADD COLUMN availability TEXT NOT NULL DEFAULT 'unknown'"),
            ("last_seen", "ALTER TABLE codes ADD COLUMN last_seen TEXT"),
        ] {
            let present: i64 = conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('codes') WHERE name = ?1",
                params![column],
                |r| r.get(0),
            )?;
            if present == 0 {
                conn.execute(ddl, [])?;
            }
        }
        Ok(Self(Mutex::new(conn)))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

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

    /// Ajoute un code saisi à la main. Marqué `manual` : il n'appartient à
    /// aucune source, donc aucune purge ne doit l'emporter.
    pub fn add_code(&self, code: &str) -> Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO codes (code, source, first_seen, availability)
             VALUES (?1, 'manuel', datetime('now','localtime'), 'manual')",
            params![code],
        )?;
        Ok(())
    }

    /// Aligne la liste sur ce que publient les sources, sans jamais écraser
    /// l'état local d'un code qui survit.
    ///
    /// `complete` dit si les deux sources ont répondu. Un code absent n'est
    /// supprimé que dans ce cas : sinon l'absence peut n'être qu'une panne de
    /// source, et supprimer ferait réapparaître le code en « jamais essayé »
    /// au prochain passage — donc réessayer un code déjà pris.
    pub fn sync_codes(
        &self,
        active: &[CodeInfo],
        inactive: &[String],
        complete: bool,
    ) -> Result<SyncCount> {
        let mut conn = self.0.lock().unwrap();
        let tx = conn.transaction()?;
        let mut count = SyncCount::default();
        {
            let mut insert = tx.prepare(
                "INSERT OR IGNORE INTO codes (code, rewards, source, first_seen)
                 VALUES (?1, ?2, ?3, datetime('now','localtime'))",
            )?;
            // Les récompenses se précisent parfois après la publication du code.
            let mut refresh = tx.prepare(
                "UPDATE codes
                 SET availability = 'active',
                     last_seen    = datetime('now','localtime'),
                     source       = ?3,
                     rewards      = CASE WHEN ?2 <> '' THEN ?2 ELSE rewards END
                 WHERE code = ?1 AND availability <> 'manual'",
            )?;
            for c in active {
                count.added += insert.execute(params![c.code, c.rewards, c.source])? as u64;
                refresh.execute(params![c.code, c.rewards, c.source])?;
            }

            // Une source qui déclare un code périmé est une affirmation, pas
            // une absence : on la suit même si l'autre source est muette.
            let mut drop_dead =
                tx.prepare("DELETE FROM codes WHERE code = ?1 AND availability <> 'manual'")?;
            for code in inactive {
                count.removed += drop_dead.execute(params![code])? as u64;
            }

            // Une liste active vide serait plus probablement une panne qu'une
            // absence réelle de codes : on ne purge pas sur cette base.
            if complete && !active.is_empty() {
                let holes = (1..=active.len())
                    .map(|i| format!("?{i}"))
                    .collect::<Vec<_>>()
                    .join(",");
                count.removed += tx.execute(
                    &format!(
                        "DELETE FROM codes
                         WHERE availability <> 'manual' AND code NOT IN ({holes})"
                    ),
                    rusqlite::params_from_iter(active.iter().map(|c| &c.code)),
                )? as u64;
            }
        }
        tx.commit()?;
        Ok(count)
    }

    /// Codes à essayer d'abord, puis les échecs réessayables, puis le reste.
    pub fn list_codes(&self) -> Result<Vec<CodeRow>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT code, rewards, source, status, message, first_seen, availability, last_seen
             FROM codes
             ORDER BY CASE
                        WHEN status = 'new' AND availability = 'active' THEN 0
                        WHEN status = 'new'                             THEN 1
                        WHEN status IN ('cooldown','auth','error')      THEN 2
                        ELSE 3
                      END,
                      last_seen DESC, first_seen DESC, code",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(CodeRow {
                    code: row.get(0)?,
                    rewards: row.get(1)?,
                    source: row.get(2)?,
                    status: row.get(3)?,
                    message: row.get(4)?,
                    first_seen: row.get(5)?,
                    availability: row.get(6)?,
                    last_seen: row.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn set_code_status(&self, code: &str, status: &str, message: &str) -> Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE codes SET status = ?2, message = ?3, tried_at = datetime('now','localtime')
             WHERE code = ?1",
            params![code, status, message],
        )?;
        Ok(())
    }

    // Wish ids are fixed-width numeric strings, so lexical DESC == chronological DESC.
    pub fn wish_history(&self, page: u64, per_page: u64, rank: Option<String>) -> Result<WishPage> {
        let conn = self.0.lock().unwrap();
        let offset = page.saturating_sub(1) * per_page;
        let (total, items) = match rank {
            Some(r) => {
                let total: u64 = conn.query_row(
                    "SELECT COUNT(*) FROM wishes WHERE rank_type = ?1",
                    params![r],
                    |row| row.get(0),
                )?;
                let mut stmt = conn.prepare(
                    "SELECT id, uid, gacha_type, time, name, item_type, rank_type
                     FROM wishes WHERE rank_type = ?1 ORDER BY id DESC LIMIT ?2 OFFSET ?3",
                )?;
                let items = stmt
                    .query_map(params![r, per_page, offset], row_to_wish)?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                (total, items)
            }
            None => {
                let total: u64 =
                    conn.query_row("SELECT COUNT(*) FROM wishes", [], |row| row.get(0))?;
                let mut stmt = conn.prepare(
                    "SELECT id, uid, gacha_type, time, name, item_type, rank_type
                     FROM wishes ORDER BY id DESC LIMIT ?1 OFFSET ?2",
                )?;
                let items = stmt
                    .query_map(params![per_page, offset], row_to_wish)?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                (total, items)
            }
        };
        Ok(WishPage { total, items })
    }

    pub fn stats(&self) -> Result<DashboardStats> {
        let conn = self.0.lock().unwrap();
        let total: u64 = conn.query_row("SELECT COUNT(*) FROM wishes", [], |r| r.get(0))?;
        let five: u64 = conn.query_row(
            "SELECT COUNT(*) FROM wishes WHERE rank_type = '5'", [], |r| r.get(0))?;
        let four: u64 = conn.query_row(
            "SELECT COUNT(*) FROM wishes WHERE rank_type = '4'", [], |r| r.get(0))?;
        // Banners 301 and 400 share the same pity counter.
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