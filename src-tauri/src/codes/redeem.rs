//! Échange d'un code via l'endpoint officiel `webExchangeCdkey`.
//!
//! Ce ne sont pas les cookies du game record : l'échange veut ceux du compte
//! HoYoverse. L'API limite le débit, d'où le délai imposé entre deux appels.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::time::sleep;

use super::{client, normalize};
use crate::error::{Error, Result};
use crate::hoyolab::Account;

const REDEEM_URL: &str = "https://sg-hk4e-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey";
const GAME_BIZ: &str = "hk4e_global";
const REFERER: &str = "https://genshin.hoyoverse.com/";

/// L'API d'échange limite le débit : un code toutes les 5 s au minimum.
const REDEEM_DELAY: Duration = Duration::from_secs(5);

/// Date du dernier échange, pour espacer les appels même si l'interface
/// enchaîne les demandes.
static LAST_REDEEM: Mutex<Option<Instant>> = Mutex::new(None);

/// Résultat d'un échange. Les retcodes de l'API sont des états normaux
/// (déjà utilisé, expiré…), pas des erreurs : seul un problème réseau l'est.
#[derive(Serialize, Clone)]
pub struct RedeemOutcome {
    pub status: &'static str,
    pub message: String,
}

/// Construit l'en-tête `cookie` de l'échange, à partir des cookies du compte
/// HoYoverse (et non ceux du game record).
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

#[derive(Deserialize)]
struct RedeemResponse {
    retcode: i64,
    #[serde(default)]
    message: String,
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
        // Reste : message renvoyé tel quel, déjà localisé par l'API et meilleur
        // qu'une traduction devinée de notre côté.
        _ => ("error", format!("({retcode}) {message}")),
    };
    RedeemOutcome { status, message: text }
}

/// Réserve le prochain créneau d'échange et attend jusqu'à lui. En réservant
/// tout de suite, deux appels concurrents s'espacent au lieu de partir ensemble.
async fn throttle() {
    let wait = {
        let mut last = LAST_REDEEM.lock().unwrap();
        let now = Instant::now();
        let next = last.map(|t| t + REDEEM_DELAY).unwrap_or(now);
        let wait = next.saturating_duration_since(now);
        *last = Some(now + wait);
        wait
    };
    if !wait.is_zero() {
        sleep(wait).await;
    }
}
