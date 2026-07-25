//! Table des codes : ajout manuel, synchronisation avec les sources et suivi
//! personnel de l'état de chaque code.

use rusqlite::params;
use serde::Serialize;

use super::Db;
use crate::codes::CodeInfo;
use crate::error::Result;

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

impl Db {
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
}
