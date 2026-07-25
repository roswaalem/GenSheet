//! Stockage local SQLite : vœux, réglages et codes.
//!
//! Une seule connexion protégée par un `Mutex`. Le schéma et les migrations
//! vivent ici ; chaque domaine (vœux, réglages, codes) ajoute ses méthodes à
//! `Db` dans son propre fichier.

mod codes;
mod settings;
mod wishes;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::error::Result;

pub use codes::{CodeRow, SyncCount};
pub use wishes::{BannerStats, DashboardStats, WishPage};

pub struct Db(Mutex<Connection>);

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
}
