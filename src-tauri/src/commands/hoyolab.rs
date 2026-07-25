//! Commandes HoYoLAB : connexion, profil et personnages.
//!
//! On ne demande jamais le mot de passe HoYoverse : l'utilisateur se connecte
//! sur la page officielle dans une webview, et on lit les cookies de session.

use tauri::{AppHandle, Manager, State};

use super::{
    capture_jar, load_account, load_context, load_session, open_login_window, ACCOUNT_KEY,
    SESSION_KEY,
};
use crate::db::Db;
use crate::error::Result;
use crate::hoyolab;

const LOGIN_LABEL: &str = "hoyolab-login";
const LOGIN_URL: &str = "https://www.hoyolab.com/home";

#[tauri::command]
pub async fn hoyolab_open_login(app: AppHandle) -> Result<()> {
    open_login_window(&app, LOGIN_LABEL, LOGIN_URL, "Connexion HoYoLAB")
}

#[tauri::command]
pub async fn hoyolab_capture(app: AppHandle, db: State<'_, Db>) -> Result<hoyolab::Account> {
    let jar = capture_jar(&app, LOGIN_LABEL, db.inner()).await?;
    let session = hoyolab::Session::from_jar(&jar)?;
    let account = hoyolab::find_account(&session).await?;

    db.set_setting(SESSION_KEY, &serde_json::to_string(&session)?)?;
    db.set_setting(ACCOUNT_KEY, &serde_json::to_string(&account)?)?;

    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        window.close().ok();
    }
    Ok(account)
}

#[tauri::command]
pub fn hoyolab_account(db: State<'_, Db>) -> Result<Option<hoyolab::Account>> {
    match db.get_setting(ACCOUNT_KEY)? {
        Some(raw) => Ok(Some(serde_json::from_str(&raw)?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn hoyolab_profile(db: State<'_, Db>) -> Result<hoyolab::Profile> {
    let session = load_session(db.inner())?;
    let account = load_account(db.inner())?;
    hoyolab::fetch_profile(&session, &account).await
}

#[tauri::command]
pub async fn hoyolab_characters(db: State<'_, Db>) -> Result<Vec<hoyolab::Character>> {
    let (session, account) = load_context(db.inner())?;
    hoyolab::fetch_characters(&session, &account).await
}

#[tauri::command]
pub async fn hoyolab_character_build(
    db: State<'_, Db>,
    character_id: i64,
) -> Result<hoyolab::CharacterBuild> {
    let (session, account) = load_context(db.inner())?;
    hoyolab::fetch_character_build(&session, &account, character_id).await
}
