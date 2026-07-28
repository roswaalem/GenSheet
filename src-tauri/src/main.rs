// Évite une fenêtre console supplémentaire sous Windows en build release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod authkey;
mod catalog;
mod codes;
mod commands;
mod db;
mod error;
mod farm;
mod gacha;
mod game;
mod hoyolab;
mod map;
mod weapons;

use tauri::Manager;

use db::Db;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(Db::open(&data_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_game,
            commands::validate_game_dir,
            commands::get_wish_url,
            commands::sync_wishes,
            commands::wish_history,
            commands::dashboard_stats,
            commands::wish_analysis,
            commands::hoyolab_open_login,
            commands::hoyolab_capture,
            commands::hoyolab_account,
            commands::hoyolab_profile,
            commands::hoyolab_characters,
            commands::hoyolab_character_build,
            commands::character_catalog,
            commands::character_detail,
            commands::weapon_catalog,
            commands::weapon_detail,
            commands::codes_open_gift,
            commands::codes_authorize,
            commands::codes_list,
            commands::codes_refresh,
            commands::codes_redeem,
            commands::codes_set_status,
            commands::farm_plan,
            commands::map_list,
            commands::map_info,
            commands::map_labels,
            commands::map_points,
            commands::map_collected,
            commands::map_toggle_point,
            commands::map_export,
            commands::map_import,
            commands::update_check,
            commands::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Gensheet");
}
