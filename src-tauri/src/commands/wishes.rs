//! Commandes du tableau de bord : détection du jeu et synchronisation des vœux.

use tauri::State;

use crate::db::{self, Db};
use crate::error::Result;
use crate::{authkey, gacha, game};

#[tauri::command]
pub fn detect_game() -> Result<game::GameInstall> {
    game::locate()
}

#[tauri::command]
pub fn validate_game_dir(path: String) -> Result<game::GameInstall> {
    game::validate(&path)
}

#[tauri::command]
pub fn get_wish_url(data_dir: String) -> Result<String> {
    authkey::extract_wish_url(&data_dir)
}

#[tauri::command]
pub async fn sync_wishes(db: State<'_, Db>, wish_url: String) -> Result<gacha::SyncReport> {
    gacha::sync_all(db.inner(), &wish_url).await
}

#[tauri::command]
pub fn wish_history(
    db: State<'_, Db>,
    page: u64,
    per_page: u64,
    banner: Option<String>,
) -> Result<db::WishPage> {
    db.wish_history(page, per_page, banner)
}

#[tauri::command]
pub fn dashboard_stats(db: State<'_, Db>) -> Result<db::DashboardStats> {
    db.stats()
}

#[tauri::command]
pub fn wish_analysis(db: State<'_, Db>) -> Result<Vec<db::BannerStats>> {
    db.wish_analysis()
}
