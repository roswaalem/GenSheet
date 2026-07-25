//! Table clé/valeur : réglages et données mises en cache (session, compte,
//! cookies, données de farm).

use rusqlite::params;

use super::Db;
use crate::error::Result;

impl Db {
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

    /// Toutes les paires (clé, valeur) dont la clé commence par `prefix`.
    pub fn settings_by_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM settings WHERE key LIKE ?1")?;
        let rows = stmt.query_map(params![format!("{prefix}%")], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
}
