//! Agrégation des codes actifs et périmés depuis deux sources communautaires.
//!
//! Elles n'ont jamais tout à fait le même délai de mise à jour : l'union est
//! plus complète que l'une ou l'autre.

use serde::Deserialize;

use super::{client, normalize, CodeInfo};
use crate::error::{Error, Result};

const SERIA_URL: &str = "https://hoyo-codes.seria.moe/codes?game=genshin";
const ENNEAD_URL: &str = "https://api.ennead.cc/mihoyo/genshin/codes";

/// Ce que publient les sources. Aucune ne donne de date d'expiration ni de
/// restriction de région : la seule information de fraîcheur disponible est
/// l'appartenance à la liste active ou à la liste des codes périmés.
#[derive(Default)]
pub struct CodeFeed {
    pub active: Vec<CodeInfo>,
    pub inactive: Vec<String>,
    /// Vrai seulement si les deux sources ont répondu. Une absence n'est une
    /// preuve de péremption que dans ce cas : sinon c'est peut-être juste la
    /// source qui manquait à l'appel.
    pub complete: bool,
}

/// Interroge les deux sources et fusionne.
pub async fn fetch_codes() -> Result<CodeFeed> {
    let http = client()?;
    let mut feed = CodeFeed::default();
    let mut failures: Vec<String> = Vec::new();
    let mut answers = 0;

    match from_seria(&http).await {
        Ok(f) => {
            answers += 1;
            feed.active.extend(f.active);
            feed.inactive.extend(f.inactive);
        }
        Err(e) => failures.push(format!("seria.moe: {e}")),
    }
    match from_ennead(&http).await {
        Ok(f) => {
            answers += 1;
            feed.active.extend(f.active);
            feed.inactive.extend(f.inactive);
        }
        Err(e) => failures.push(format!("ennead.cc: {e}")),
    }
    feed.complete = answers == 2;

    if answers == 0 {
        return Err(Error::Msg(format!(
            "Aucune source de codes n'a répondu ({}).",
            failures.join(" / ")
        )));
    }

    let mut seen = std::collections::HashSet::new();
    feed.active.retain(|c| !c.code.is_empty() && seen.insert(c.code.clone()));
    // Un code actif chez une source prime sur « périmé » chez l'autre.
    feed.inactive.retain(|c| !c.is_empty() && !seen.contains(c));
    feed.inactive.sort();
    feed.inactive.dedup();
    Ok(feed)
}

// Champs en `Option` : les agrégateurs renvoient parfois `null` plutôt que
// d'omettre la clé, ce qu'un `#[serde(default)]` seul ne rattrape pas.

#[derive(Deserialize)]
struct SeriaList {
    codes: Vec<SeriaCode>,
}

#[derive(Deserialize)]
struct SeriaCode {
    code: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    rewards: Option<String>,
}

async fn from_seria(http: &reqwest::Client) -> Result<CodeFeed> {
    let list: SeriaList = http.get(SERIA_URL).send().await?.json().await?;
    let mut feed = CodeFeed::default();
    for c in list.codes {
        let code = normalize(&c.code);
        if c.status.as_deref().unwrap_or("OK").eq_ignore_ascii_case("OK") {
            feed.active.push(CodeInfo {
                code,
                // Format source : "Primogem*60;Mora*10000".
                rewards: c
                    .rewards
                    .unwrap_or_default()
                    .split(';')
                    .filter(|r| !r.is_empty())
                    .map(|r| r.replacen('*', " ×", 1))
                    .collect::<Vec<_>>()
                    .join(", "),
                source: "seria.moe".into(),
            });
        } else {
            feed.inactive.push(code);
        }
    }
    Ok(feed)
}

#[derive(Deserialize)]
struct EnneadList {
    #[serde(default)]
    active: Vec<EnneadCode>,
    #[serde(default)]
    inactive: Vec<EnneadCode>,
}

#[derive(Deserialize)]
struct EnneadCode {
    code: String,
    #[serde(default)]
    rewards: Option<Vec<String>>,
}

async fn from_ennead(http: &reqwest::Client) -> Result<CodeFeed> {
    let list: EnneadList = http.get(ENNEAD_URL).send().await?.json().await?;
    Ok(CodeFeed {
        active: list
            .active
            .into_iter()
            .map(|c| CodeInfo {
                code: normalize(&c.code),
                rewards: c.rewards.unwrap_or_default().join(", "),
                source: "ennead.cc".into(),
            })
            .collect(),
        inactive: list
            .inactive
            .into_iter()
            .map(|c| normalize(&c.code))
            .collect(),
        ..CodeFeed::default()
    })
}
