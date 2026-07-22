//! Codes promotionnels : agrégation communautaire + échange officiel.
//!
//! Aucune API officielle ne liste les codes : on interroge deux agrégateurs
//! communautaires et on fusionne. L'échange, lui, passe par l'endpoint officiel
//! `webExchangeCdkey`, qui exige les cookies de session du site HoYoverse.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::time::sleep;

use crate::error::{Error, Result};
use crate::hoyolab::Account;

const SERIA_URL: &str = "https://hoyo-codes.seria.moe/codes?game=genshin";
const ENNEAD_URL: &str = "https://api.ennead.cc/mihoyo/genshin/codes";

const REDEEM_URL: &str = "https://sg-hk4e-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey";
const GAME_BIZ: &str = "hk4e_global";
const REFERER: &str = "https://genshin.hoyoverse.com/";

/// L'API d'échange limite le débit : un code toutes les 5 s au minimum.
const REDEEM_DELAY: Duration = Duration::from_secs(5);

/// Date du dernier échange, pour espacer les appels même si l'interface
/// enchaîne les demandes.
static LAST_REDEEM: Mutex<Option<Instant>> = Mutex::new(None);

/// Un code tel que publié par les agrégateurs.
#[derive(Serialize, Deserialize, Clone)]
pub struct CodeInfo {
    pub code: String,
    pub rewards: String,
    pub source: String,
}

/// Résultat d'un échange. Les retcodes de l'API sont des états normaux
/// (déjà utilisé, expiré…), pas des erreurs : seul un problème réseau l'est.
#[derive(Serialize, Clone)]
pub struct RedeemOutcome {
    pub status: &'static str,
    pub message: String,
}

fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder().build().map_err(Error::from)
}

// --- Agrégation ------------------------------------------------------------

#[derive(Deserialize)]
struct SeriaList {
    codes: Vec<SeriaCode>,
}

// Champs en `Option` : les agrégateurs renvoient parfois `null` plutôt que
// d'omettre la clé, ce qu'un `#[serde(default)]` seul ne rattrape pas.
#[derive(Deserialize)]
struct SeriaCode {
    code: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    rewards: Option<String>,
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

/// Interroge les deux sources et fusionne : elles n'ont jamais tout à fait le
/// même délai de mise à jour, l'union est plus complète que l'une ou l'autre.
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

/// Les codes sont alphanumériques et insensibles à la casse.
pub fn normalize(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase()
}

// --- Échange ---------------------------------------------------------------

/// Construit l'en-tête `cookie` de l'échange. Ce ne sont pas les mêmes cookies
/// que le game record : `webExchangeCdkey` veut ceux du compte HoYoverse.
pub fn redeem_cookie(jar: &HashMap<String, String>) -> Result<String> {
    let get = |name: &str| jar.get(name).filter(|v| !v.is_empty()).cloned();

    let token = get("cookie_token_v2").ok_or_else(|| {
        Error::Msg("Cookies d'échange absents : passer par « Autoriser l'échange ».".into())
    })?;
    let account = get("account_id_v2")
        .or_else(|| get("account_mid_v2"))
        .ok_or_else(|| Error::Msg("Cookie account_id_v2 absent : refaire l'autorisation.".into()))?;

    let mut cookie = format!("cookie_token_v2={token}; account_id_v2={account}");
    if let Some(mid) = get("account_mid_v2") {
        cookie.push_str(&format!("; account_mid_v2={mid}"));
    }
    Ok(cookie)
}

#[derive(Deserialize)]
struct RedeemResponse {
    retcode: i64,
    #[serde(default)]
    message: String,
}

/// Échange un code. Attend si besoin pour respecter le délai de l'API.
pub async fn redeem(cookie: &str, account: &Account, code: &str) -> Result<RedeemOutcome> {
    let code = normalize(code);
    if code.is_empty() {
        return Ok(RedeemOutcome {
            status: "invalid",
            message: "Code vide.".into(),
        });
    }
    throttle().await;

    let url = format!(
        "{REDEEM_URL}?uid={}&region={}&lang=fr&cdkey={}&game_biz={GAME_BIZ}&sLangKey=fr-fr",
        account.uid, account.region, code
    );
    let resp: RedeemResponse = client()?
        .get(&url)
        .header("cookie", cookie)
        .header("referer", REFERER)
        .send()
        .await?
        .json()
        .await?;

    Ok(interpret(resp.retcode, resp.message))
}

/// Traduit les retcodes connus de `webExchangeCdkey`.
fn interpret(retcode: i64, message: String) -> RedeemOutcome {
    let (status, text): (&'static str, String) = match retcode {
        0 => ("redeemed", "Échangé — récompenses envoyées par courrier.".into()),
        -2017 | -2018 => ("used", "Code déjà utilisé.".into()),
        -2001 => ("expired", "Code expiré.".into()),
        // L'API ne distingue pas « code inexistant » de « code pas prévu pour
        // ce serveur » : les deux tombent ici.
        -2003 | -2004 => (
            "invalid",
            "Refusé : code inexistant, ou pas valable sur ce serveur.".into(),
        ),
        -2016 => (
            "cooldown",
            "Trop d'échanges d'affilée : nouvelle tentative possible dans une minute.".into(),
        ),
        -1071 => (
            "auth",
            "Session d'échange expirée : relancer « Autoriser l'échange ».".into(),
        ),
        -1073 => (
            "auth",
            "Ce compte n'a pas de personnage : vérifier l'UID lié à HoYoLAB.".into(),
        ),
        // Reste : message renvoyé tel quel, il est déjà localisé par l'API et
        // vaut mieux qu'une traduction devinée de notre côté.
        _ => ("error", format!("({retcode}) {message}")),
    };
    RedeemOutcome {
        status,
        message: text,
    }
}

async fn throttle() {
    let wait = {
        let mut last = LAST_REDEEM.lock().unwrap();
        let now = Instant::now();
        let next = last.map(|t| t + REDEEM_DELAY).unwrap_or(now);
        let wait = next.saturating_duration_since(now);
        // On réserve le créneau tout de suite : deux appels concurrents
        // s'espacent au lieu de partir ensemble.
        *last = Some(now + wait);
        wait
    };
    if !wait.is_zero() {
        sleep(wait).await;
    }
}
