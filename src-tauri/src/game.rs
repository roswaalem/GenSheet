use std::fs;
use std::path::{Path, PathBuf};
use serde::Serialize;
use crate::error::{Error, Result};

const DATA_DIR_NAME: &str = "GenshinImpact_Data";

#[derive(Serialize, Clone)]
pub struct GameInstall {
    pub game_dir: String,
    pub data_dir: String,
}

pub fn locate() -> Result<GameInstall> {
    if let Some(install) = from_output_log()? {
        return Ok(install);
    }
    for candidate in default_paths() {
        if let Some(install) = validate_dir(&candidate) {
            return Ok(install);
        }
    }
    Err(Error::Msg("Genshin introuvable : sélectionne le dossier du jeu manuellement.".into()))
}

pub fn validate(path: &str) -> Result<GameInstall> {
    validate_dir(Path::new(path))
        .ok_or_else(|| Error::Msg("Dossier invalide : GenshinImpact.exe introuvable ici.".into()))
}

// The game writes its own install path into output_log.txt at every launch.
fn from_output_log() -> Result<Option<GameInstall>> {
    let Some(home) = dirs::home_dir() else { return Ok(None) };
    let log = home.join("AppData/LocalLow/miHoYo/Genshin Impact/output_log.txt");
    if !log.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&log).unwrap_or_default();
    for line in text.lines() {
        if let Some(idx) = line.find(DATA_DIR_NAME) {
            let head = &line[..idx];
            // Walk back to the drive letter (e.g. "C:")
            if let Some(start) = head.rfind(':').and_then(|p| p.checked_sub(1)) {
                let data_dir = format!("{}{}", &line[start..idx], DATA_DIR_NAME);
                let data_path = PathBuf::from(data_dir);
                if let Some(game_dir) = data_path.parent() {
                    if let Some(install) = validate_dir(game_dir) {
                        return Ok(Some(install));
                    }
                }
            }
        }
    }
    Ok(None)
}

fn default_paths() -> Vec<PathBuf> {
    let suffixes = [
        "Program Files/HoYoPlay/games/Genshin Impact game",
        "Program Files/Genshin Impact/Genshin Impact game",
        "HoYoPlay/games/Genshin Impact game",
        "Genshin Impact/Genshin Impact game",
    ];
    let mut out = Vec::new();
    for drive in 'C'..='H' {
        for s in suffixes {
            out.push(PathBuf::from(format!("{drive}:/{s}")));
        }
    }
    out
}

fn validate_dir(dir: &Path) -> Option<GameInstall> {
    let exe_ok = dir.join("GenshinImpact.exe").exists() || dir.join("YuanShen.exe").exists();
    let data = dir.join(DATA_DIR_NAME);
    if exe_ok && data.is_dir() {
        Some(GameInstall {
            game_dir: dir.to_string_lossy().into_owned(),
            data_dir: data.to_string_lossy().into_owned(),
        })
    } else {
        None
    }
}