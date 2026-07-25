//! Plomberie HTTP de l'API HoYoLAB : client, en-tête de sécurité « DS »,
//! session, et envoi signé des requêtes GET/POST.

use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const DS_SALT: &str = "6s25p5ox5y14umn1p61aqyyvbvvl3lrt";
const APP_VERSION: &str = "1.5.0";
const CLIENT_TYPE: &str = "5";
const LANG: &str = "fr-fr";

/// En-tête `ds` : md5 d'un timestamp salé + nonce (schéma v1, overseas).
fn dynamic_secret() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut rng = rand::thread_rng();
    let r: String = (0..6)
        .map(|_| {
            // Uniquement des lettres ASCII, comme l'implémentation de référence.
            let c = rng.gen_range(0..52u8);
            (if c < 26 { b'a' + c } else { b'A' + c - 26 }) as char
        })
        .collect();
    let digest = md5::compute(format!("salt={DS_SALT}&t={t}&r={r}"));
    format!("{t},{r},{digest:x}")
}

/// Cookies de session capturés depuis la webview de connexion officielle.
#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub cookie: String,
    pub ltuid: String,
}

impl Session {
    /// Construit une session depuis le bocal de cookies de la webview. Seules
    /// les deux valeurs utiles à l'API game record sont conservées.
    pub fn from_jar(jar: &std::collections::HashMap<String, String>) -> Result<Self> {
        let find = |name: &str| jar.get(name).filter(|v| !v.is_empty()).cloned();
        let ltuid = find("ltuid_v2")
            .or_else(|| find("ltmid_v2"))
            .ok_or_else(|| Error::Msg("Cookie ltuid_v2 absent : connexion non terminée.".into()))?;
        let ltoken = find("ltoken_v2")
            .ok_or_else(|| Error::Msg("Cookie ltoken_v2 absent : connexion non terminée.".into()))?;
        Ok(Self {
            cookie: format!("ltuid_v2={ltuid}; ltoken_v2={ltoken}"),
            ltuid,
        })
    }
}

/// Enveloppe commune à toutes les réponses de l'API.
#[derive(Deserialize)]
struct ApiResponse<T> {
    retcode: i64,
    message: String,
    data: Option<T>,
}

/// Client HTTP nu : l'authentification se fait par en-têtes à chaque appel.
pub(crate) fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder().build().map_err(Error::from)
}

/// GET signé.
pub(crate) async fn get<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    url: &str,
    session: &Session,
) -> Result<T> {
    send(http.get(url), session).await
}

/// POST signé avec corps JSON — exigé par `character/list` et `character/detail`.
pub(crate) async fn post<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    url: &str,
    session: &Session,
    body: &serde_json::Value,
) -> Result<T> {
    send(http.post(url).json(body), session).await
}

/// Ajoute les en-têtes signés, envoie et déballe la réponse. GET et POST ne
/// diffèrent que par le verbe et le corps ; tout le reste est ici.
async fn send<T: serde::de::DeserializeOwned>(
    request: reqwest::RequestBuilder,
    session: &Session,
) -> Result<T> {
    let resp: ApiResponse<T> = request
        .header("ds", dynamic_secret())
        .header("x-rpc-app_version", APP_VERSION)
        .header("x-rpc-client_type", CLIENT_TYPE)
        .header("x-rpc-language", LANG)
        .header("x-rpc-lang", LANG)
        .header("cookie", &session.cookie)
        .send()
        .await?
        .json()
        .await?;

    if resp.retcode != 0 {
        // 10001 / -100 : les cookies ont expiré, c'est le cas courant.
        let hint = if resp.retcode == 10001 || resp.retcode == -100 {
            " — reconnecte-toi à HoYoLAB."
        } else {
            ""
        };
        return Err(Error::Msg(format!(
            "HoYoLAB ({}): {}{hint}",
            resp.retcode, resp.message
        )));
    }
    resp.data
        .ok_or_else(|| Error::Msg("Réponse HoYoLAB vide.".into()))
}
