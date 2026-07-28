//! Commandes des codes promo : agrégation, affichage, échange (en un clic ou
//! via la page officielle) et suivi manuel de l'état de chaque code.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::{capture_jar, load_setting, open_login_window, stored_jar, ACCOUNT_KEY};
use crate::codes;
use crate::db::{self, Db};
use crate::error::{Error, Result};

const GIFT_LABEL: &str = "hoyoverse-gift";
const GIFT_URL: &str = "https://genshin.hoyoverse.com/fr/gift";

/// États qu'on accepte de poser à la main : ceux qui décrivent un fait
/// (« je l'ai déjà pris »), pas un incident technique passager.
const MANUAL_STATUSES: [&str; 5] = ["new", "redeemed", "used", "expired", "invalid"];

#[derive(Serialize)]
pub struct CodesView {
    /// Vrai quand l'échange en un clic est possible (compte + cookies).
    ready: bool,
    /// L'UID vient de la connexion HoYoLAB : sans compte, pas d'échange.
    needs_account: bool,
    /// Les cookies d'échange ne sont pas ceux du game record.
    needs_authorization: bool,
    /// Bilan de la dernière actualisation, nul pour un simple affichage.
    sync: db::SyncCount,
    codes: Vec<db::CodeRow>,
}

fn codes_view(db: &Db, sync: db::SyncCount) -> Result<CodesView> {
    let needs_account = db.get_setting(ACCOUNT_KEY)?.is_none();
    let needs_authorization = codes::redeem_cookie(&stored_jar(db)?).is_err();
    Ok(CodesView {
        ready: !needs_account && !needs_authorization,
        needs_account,
        needs_authorization,
        sync,
        codes: db.list_codes()?,
    })
}

/// Ouvre la page d'échange officielle, éventuellement avec un code prérempli.
#[tauri::command]
pub async fn codes_open_gift(app: AppHandle, code: Option<String>) -> Result<()> {
    let url = match code.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => format!("{GIFT_URL}?code={c}"),
        None => GIFT_URL.to_string(),
    };
    open_login_window(&app, GIFT_LABEL, &url, "Échange de codes : HoYoverse")
}

/// Regarde si la connexion sur la page officielle a abouti.
///
/// Trois issues distinctes, pour que l'interface puisse attendre sans deviner :
/// `Err` = la fenêtre n'est plus là, `Ok(None)` = elle est ouverte mais la
/// connexion n'est pas finie, `Ok(Some)` = c'est bon, la fenêtre se referme.
#[tauri::command]
pub async fn codes_authorize(app: AppHandle, db: State<'_, Db>) -> Result<Option<CodesView>> {
    let jar = capture_jar(&app, GIFT_LABEL, db.inner()).await?;
    if codes::redeem_cookie(&jar).is_err() {
        return Ok(None);
    }
    if let Some(window) = app.get_webview_window(GIFT_LABEL) {
        window.close().ok();
    }
    codes_view(db.inner(), db::SyncCount::default()).map(Some)
}

#[tauri::command]
pub fn codes_list(db: State<'_, Db>) -> Result<CodesView> {
    codes_view(db.inner(), db::SyncCount::default())
}

#[tauri::command]
pub async fn codes_refresh(db: State<'_, Db>) -> Result<CodesView> {
    let feed = codes::fetch_codes().await?;
    let sync = db.sync_codes(&feed.active, &feed.inactive, feed.complete)?;
    codes_view(db.inner(), sync)
}

#[tauri::command]
pub fn codes_set_status(db: State<'_, Db>, code: String, status: String) -> Result<CodesView> {
    if !MANUAL_STATUSES.contains(&status.as_str()) {
        return Err(Error::Msg(format!("État inconnu : {status}.")));
    }
    let message = if status == "new" { "" } else { "Noté à la main." };
    db.set_code_status(&codes::normalize(&code), &status, message)?;
    codes_view(db.inner(), db::SyncCount::default())
}

#[tauri::command]
pub async fn codes_redeem(db: State<'_, Db>, code: String) -> Result<codes::RedeemOutcome> {
    let account: crate::hoyolab::Account = load_setting(
        db.inner(),
        ACCOUNT_KEY,
        "Connexion à HoYoLAB requise : l'UID en dépend.",
    )?;
    let cookie = codes::redeem_cookie(&stored_jar(db.inner())?)?;

    // Un code saisi à la main n'est pas encore en base : on l'y met pour que
    // son résultat soit mémorisé comme les autres.
    let code = codes::normalize(&code);
    if code.is_empty() {
        return Err(Error::Msg("Code vide.".into()));
    }
    db.add_code(&code)?;

    let outcome = codes::redeem(&cookie, &account, &code).await?;
    db.set_code_status(&code, outcome.status, &outcome.message)?;
    // Session d'échange périmée : on efface le cookie pour que l'UI repropose
    // « Autoriser l'échange » (sinon elle se croit prête et masque le bouton).
    if outcome.status == "auth" {
        super::clear_redeem_cookie(db.inner())?;
    }
    Ok(outcome)
}
