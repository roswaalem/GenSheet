// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod authkey;
mod codes;
mod db;
mod error;
mod farm;
mod gacha;
mod game;
mod hoyolab;

use std::collections::HashMap;

use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};
use db::Db;
use error::{Error, Result};

const LOGIN_LABEL: &str = "hoyolab-login";
const LOGIN_URL: &str = "https://www.hoyolab.com/home";
const GIFT_LABEL: &str = "hoyoverse-gift";
const GIFT_URL: &str = "https://genshin.hoyoverse.com/fr/gift";
const SESSION_KEY: &str = "hoyolab_session";
const ACCOUNT_KEY: &str = "hoyolab_account";
const COOKIES_KEY: &str = "hoyolab_cookies";

/// Les seuls cookies conservés : ceux du game record et ceux de l'échange de
/// codes. Tout le reste du bocal du webview est ignoré.
const KEPT_COOKIES: [&str; 6] = [
    "ltuid_v2",
    "ltmid_v2",
    "ltoken_v2",
    "cookie_token_v2",
    "account_id_v2",
    "account_mid_v2",
];

#[tauri::command]
fn detect_game() -> Result<game::GameInstall> {
    game::locate()
}

#[tauri::command]
fn validate_game_dir(path: String) -> Result<game::GameInstall> {
    game::validate(&path)
}

#[tauri::command]
fn get_wish_url(data_dir: String) -> Result<String> {
    authkey::extract_wish_url(&data_dir)
}

#[tauri::command]
async fn sync_wishes(db: State<'_, Db>, wish_url: String) -> Result<gacha::SyncReport> {
    gacha::sync_all(db.inner(), &wish_url).await
}

#[tauri::command]
fn wish_history(
    db: State<'_, Db>,
    page: u64,
    per_page: u64,
    rank: Option<String>,
) -> Result<db::WishPage> {
    db.wish_history(page, per_page, rank)
}

#[tauri::command]
fn dashboard_stats(db: State<'_, Db>) -> Result<db::DashboardStats> {
    db.stats()
}

// --- HoYoLAB -------------------------------------------------------------
// We never ask for the HoYoverse password: the user logs in on the official
// page inside a webview and we read the resulting session cookies.

/// Ouvre une page officielle dans sa propre fenêtre webview.
fn open_login_window(app: &AppHandle, label: &str, url: &str, title: &str) -> Result<()> {
    let parsed: Url = url
        .parse()
        .map_err(|_| Error::Msg("URL de login invalide.".into()))?;
    if let Some(existing) = app.get_webview_window(label) {
        // Déjà ouverte : on la renavigue, l'URL peut avoir changé (code prérempli).
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

/// Reads the cookie jar of a login window and merges it into the stored one.
/// Must stay `async`: on Windows, reading cookies from a synchronous command
/// deadlocks the webview.
async fn capture_jar(app: &AppHandle, label: &str, db: &Db) -> Result<HashMap<String, String>> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| Error::Msg("Fenêtre de connexion fermée : relance la connexion.".into()))?;

    // Fusion et non remplacement : les cookies du game record et ceux de
    // l'échange viennent de deux pages différentes.
    let mut jar = stored_jar(db)?;
    for cookie in window.cookies()? {
        if KEPT_COOKIES.contains(&cookie.name()) && !cookie.value().is_empty() {
            jar.insert(cookie.name().to_string(), cookie.value().to_string());
        }
    }
    db.set_setting(COOKIES_KEY, &serde_json::to_string(&jar)?)?;
    Ok(jar)
}

fn stored_jar(db: &Db) -> Result<HashMap<String, String>> {
    match db.get_setting(COOKIES_KEY)? {
        Some(raw) => Ok(serde_json::from_str(&raw)?),
        None => Ok(HashMap::new()),
    }
}

#[tauri::command]
async fn hoyolab_open_login(app: AppHandle) -> Result<()> {
    open_login_window(&app, LOGIN_LABEL, LOGIN_URL, "Connexion HoYoLAB")
}

#[tauri::command]
async fn hoyolab_capture(app: AppHandle, db: State<'_, Db>) -> Result<hoyolab::Account> {
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
fn hoyolab_account(db: State<'_, Db>) -> Result<Option<hoyolab::Account>> {
    match db.get_setting(ACCOUNT_KEY)? {
        Some(raw) => Ok(Some(serde_json::from_str(&raw)?)),
        None => Ok(None),
    }
}

#[tauri::command]
async fn hoyolab_profile(db: State<'_, Db>) -> Result<hoyolab::Profile> {
    let session: hoyolab::Session = db
        .get_setting(SESSION_KEY)?
        .ok_or_else(|| Error::Msg("Pas de session HoYoLAB : connecte-toi d'abord.".into()))
        .and_then(|raw| serde_json::from_str(&raw).map_err(Error::from))?;
    let account: hoyolab::Account = db
        .get_setting(ACCOUNT_KEY)?
        .ok_or_else(|| Error::Msg("Pas de compte HoYoLAB enregistré.".into()))
        .and_then(|raw| serde_json::from_str(&raw).map_err(Error::from))?;

    hoyolab::fetch_profile(&session, &account).await
}

// --- Codes promo ---------------------------------------------------------

#[derive(serde::Serialize)]
struct CodesView {
    /// Vrai quand l'échange en un clic est possible (compte + cookies).
    ready: bool,
    /// L'UID vient de la phase 2 : sans compte HoYoLAB, pas d'échange.
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
async fn codes_open_gift(app: AppHandle, code: Option<String>) -> Result<()> {
    let url = match code.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => format!("{GIFT_URL}?code={c}"),
        None => GIFT_URL.to_string(),
    };
    open_login_window(&app, GIFT_LABEL, &url, "Échange de codes — HoYoverse")
}

/// Regarde si la connexion sur la page officielle a abouti.
///
/// Trois issues distinctes, pour que l'interface puisse attendre sans deviner :
/// `Err` = la fenêtre n'est plus là, `Ok(None)` = elle est ouverte mais la
/// connexion n'est pas finie, `Ok(Some)` = c'est bon, la fenêtre se referme.
#[tauri::command]
async fn codes_authorize(app: AppHandle, db: State<'_, Db>) -> Result<Option<CodesView>> {
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
fn codes_list(db: State<'_, Db>) -> Result<CodesView> {
    codes_view(db.inner(), db::SyncCount::default())
}

#[tauri::command]
async fn codes_refresh(db: State<'_, Db>) -> Result<CodesView> {
    let feed = codes::fetch_codes().await?;
    let sync = db.sync_codes(&feed.active, &feed.inactive, feed.complete)?;
    codes_view(db.inner(), sync)
}

/// États qu'on accepte de poser à la main : ceux qui décrivent un fait
/// (« je l'ai déjà pris »), pas un incident technique passager.
const MANUAL_STATUSES: [&str; 5] = ["new", "redeemed", "used", "expired", "invalid"];

#[tauri::command]
fn codes_set_status(db: State<'_, Db>, code: String, status: String) -> Result<CodesView> {
    if !MANUAL_STATUSES.contains(&status.as_str()) {
        return Err(Error::Msg(format!("État inconnu : {status}.")));
    }
    let message = if status == "new" { "" } else { "Noté à la main." };
    db.set_code_status(&codes::normalize(&code), &status, message)?;
    codes_view(db.inner(), db::SyncCount::default())
}

#[tauri::command]
async fn codes_redeem(db: State<'_, Db>, code: String) -> Result<codes::RedeemOutcome> {
    let account: hoyolab::Account = db
        .get_setting(ACCOUNT_KEY)?
        .ok_or_else(|| Error::Msg("Connexion à HoYoLAB requise : l'UID en dépend.".into()))
        .and_then(|raw| serde_json::from_str(&raw).map_err(Error::from))?;
    let cookie = codes::redeem_cookie(&stored_jar(db.inner())?)?;

    // Un code saisi à la main n'est pas encore dans la base : on l'y met pour
    // que son résultat soit mémorisé comme les autres.
    let code = codes::normalize(&code);
    if code.is_empty() {
        return Err(Error::Msg("Code vide.".into()));
    }
    db.add_code(&code)?;

    let outcome = codes::redeem(&cookie, &account, &code).await?;
    db.set_code_status(&code, outcome.status, &outcome.message)?;
    Ok(outcome)
}

// --- Farm ----------------------------------------------------------------

const FARM_KEY: &str = "farm_data";

/// Renvoie les données Ambr, en les retéléchargeant si le cache a vieilli ou
/// s'il ignore un personnage du compte (cas d'une sortie récente).
async fn farm_data(db: &Db, avatar_ids: &[i64], force: bool) -> Result<farm::FarmData> {
    let cached: Option<farm::FarmData> = match db.get_setting(FARM_KEY)? {
        Some(raw) => serde_json::from_str(&raw).ok(),
        None => None,
    };

    if !force {
        if let Some(data) = cached {
            if !data.is_stale(farm::now_secs()) && !data.misses_any(avatar_ids) {
                return Ok(data);
            }
        }
    }

    let fresh = farm::fetch().await?;
    db.set_setting(FARM_KEY, &serde_json::to_string(&fresh)?)?;
    Ok(fresh)
}

#[tauri::command]
async fn farm_plan(
    db: State<'_, Db>,
    day: String,
    avatar_ids: Vec<i64>,
    refresh: Option<bool>,
) -> Result<farm::FarmPlan> {
    if !farm::DAYS.contains(&day.as_str()) {
        return Err(Error::Msg(format!("Jour inconnu : {day}.")));
    }
    let data = farm_data(db.inner(), &avatar_ids, refresh.unwrap_or(false)).await?;
    Ok(farm::plan(&data, &day, &avatar_ids))
}

// --- Mises à jour --------------------------------------------------------

#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    version: String,
    notes: Option<String>,
}

/// Cherche une mise à jour. Renvoie `None` — et jamais une erreur — quand le
/// contrôle échoue : hors ligne ou endpoint injoignable, l'app doit démarrer
/// sans rien reprocher à l'utilisateur. La raison part sur la sortie d'erreur.
#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("updater indisponible : {e}");
            return Ok(None);
        }
    };
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            current: update.current_version.clone(),
            version: update.version.clone(),
            notes: update.body.clone(),
        })),
        Ok(None) => Ok(None),
        Err(e) => {
            eprintln!("contrôle de mise à jour échoué : {e}");
            Ok(None)
        }
    }
}

/// Télécharge et installe, puis relance. Ici les erreurs remontent : c'est une
/// action explicite de l'utilisateur, un échec silencieux serait pire.
#[tauri::command]
async fn update_install(app: AppHandle) -> Result<()> {
    use tauri_plugin_updater::UpdaterExt;

    let update = app
        .updater()?
        .check()
        .await?
        .ok_or_else(|| Error::Msg("Plus aucune mise à jour à installer.".into()))?;

    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(Db::open(&data_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_game,
            validate_game_dir,
            get_wish_url,
            sync_wishes,
            wish_history,
            dashboard_stats,
            hoyolab_open_login,
            hoyolab_capture,
            hoyolab_account,
            hoyolab_profile,
            codes_open_gift,
            codes_authorize,
            codes_list,
            codes_refresh,
            codes_redeem,
            codes_set_status,
            farm_plan,
            update_check,
            update_install
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Gensheet");
}