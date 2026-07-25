//! Codes promotionnels : agrégation communautaire + échange officiel.
//!
//! Aucune API officielle ne liste les codes : on interroge deux agrégateurs
//! communautaires et on fusionne ([`aggregate`]). L'échange, lui, passe par
//! l'endpoint officiel `webExchangeCdkey` ([`redeem`]), qui exige les cookies
//! de session du site HoYoverse.

mod aggregate;
mod redeem;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub use aggregate::fetch_codes;
pub use redeem::{redeem, redeem_cookie, RedeemOutcome};

/// Un code tel que publié par les agrégateurs.
#[derive(Serialize, Deserialize, Clone)]
pub struct CodeInfo {
    pub code: String,
    pub rewards: String,
    pub source: String,
}

/// Les codes sont alphanumériques et insensibles à la casse.
pub fn normalize(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase()
}

/// Client HTTP nu, partagé par l'agrégation et l'échange.
pub(crate) fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder().build().map_err(Error::from)
}
