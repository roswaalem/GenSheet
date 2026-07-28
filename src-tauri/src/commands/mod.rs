//! Couche Tauri : chaque fonction `#[tauri::command]` est un pont mince entre
//! l'interface et un module métier, regroupées ici par domaine.
//!
//! Ce fichier ne porte que ce qui est partagé entre plusieurs domaines : les
//! clés de stockage de la session, la gestion des fenêtres webview de connexion
//! et le chargement des données de session persistées.

mod catalog;
mod codes;
mod farm;
mod hoyolab;
mod map;
mod updates;
mod weapons;
mod wishes;

use std::collections::HashMap;

use serde::de::DeserializeOwned;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::db::Db;
use crate::error::{Error, Result};

pub use catalog::*;
pub use codes::*;
pub use farm::*;
pub use hoyolab::*;
pub use map::*;
pub use updates::*;
pub use weapons::*;
pub use wishes::*;

// Clés sous lesquelles la session HoYoLAB est stockée en base.
pub(crate) const SESSION_KEY: &str = "hoyolab_session";
pub(crate) const ACCOUNT_KEY: &str = "hoyolab_account";
const COOKIES_KEY: &str = "hoyolab_cookies";

/// Les seuls cookies conservés du bocal webview : ceux du game record et ceux
/// de l'échange de codes. Tout le reste est ignoré.
const KEPT_COOKIES: [&str; 6] = [
    "ltuid_v2",
    "ltmid_v2",
    "ltoken_v2",
    "cookie_token_v2",
    "account_id_v2",
    "account_mid_v2",
];

/// Ouvre une page officielle dans sa propre fenêtre webview, ou renavigue la
/// fenêtre existante (l'URL peut avoir changé, ex. code prérempli).
pub(crate) fn open_login_window(app: &AppHandle, label: &str, url: &str, title: &str) -> Result<()> {
    let parsed: Url = url
        .parse()
        .map_err(|_| Error::Msg("URL de login invalide.".into()))?;
    if let Some(existing) = app.get_webview_window(label) {
        existing.navigate(parsed)?;
        existing.set_focus().ok();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(1000.0, 760.0)
        .build()?;
    Ok(())
}

/// Lit le bocal de cookies d'une fenêtre de login et le fusionne au bocal
/// stocké. Fusion et non remplacement : les cookies du game record et ceux de
/// l'échange viennent de deux pages différentes.
///
/// Doit rester `async` : sous Windows, lire les cookies depuis une commande
/// synchrone bloque la webview.
pub(crate) async fn capture_jar(
    app: &AppHandle,
    label: &str,
    db: &Db,
) -> Result<HashMap<String, String>> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| Error::Msg("Fenêtre de connexion fermée : connexion à relancer.".into()))?;

    let mut jar = stored_jar(db)?;
    for cookie in window.cookies()? {
        if KEPT_COOKIES.contains(&cookie.name()) && !cookie.value().is_empty() {
            jar.insert(cookie.name().to_string(), cookie.value().to_string());
        }
    }
    db.set_setting(COOKIES_KEY, &serde_json::to_string(&jar)?)?;
    Ok(jar)
}

pub(crate) fn stored_jar(db: &Db) -> Result<HashMap<String, String>> {
    match db.get_setting(COOKIES_KEY)? {
        Some(raw) => Ok(serde_json::from_str(&raw)?),
        None => Ok(HashMap::new()),
    }
}

/// Retire le cookie d'échange du bocal. Il expire indépendamment (et bien plus
/// vite) que la session HoYoLAB : sans ça, l'app le croit encore valide et
/// masque « Autoriser l'échange », laissant l'utilisateur bloqué.
pub(crate) fn clear_redeem_cookie(db: &Db) -> Result<()> {
    let mut jar = stored_jar(db)?;
    if jar.remove("cookie_token_v2").is_some() {
        db.set_setting(COOKIES_KEY, &serde_json::to_string(&jar)?)?;
    }
    Ok(())
}

/// Désérialise une valeur stockée en JSON, avec un message clair si la clé
/// manque.
pub(crate) fn load_setting<T: DeserializeOwned>(db: &Db, key: &str, missing: &str) -> Result<T> {
    let raw = db.get_setting(key)?.ok_or_else(|| Error::Msg(missing.into()))?;
    Ok(serde_json::from_str(&raw)?)
}

pub(crate) fn load_session(db: &Db) -> Result<crate::hoyolab::Session> {
    load_setting(db, SESSION_KEY, "Pas de session HoYoLAB : connexion requise.")
}

pub(crate) fn load_account(db: &Db) -> Result<crate::hoyolab::Account> {
    load_setting(db, ACCOUNT_KEY, "Pas de compte HoYoLAB enregistré.")
}

/// Session et compte, exigés par tous les appels au game record.
pub(crate) fn load_context(db: &Db) -> Result<(crate::hoyolab::Session, crate::hoyolab::Account)> {
    Ok((load_session(db)?, load_account(db)?))
}
