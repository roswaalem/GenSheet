use std::fs;
use std::path::{Path, PathBuf};
use crate::error::{Error, Result};

// The event page is versioned by a hash that changes whenever HoYoverse reworks
// it (…gacha-v3, …gacha-df01aea2, …): match the stable prefix, not the full name.
const EVENT_PAGE_MARKER: &str = "e20190909gacha";
const API_MARKER: &str = "getGachaLog";

pub fn extract_wish_url(data_dir: &str) -> Result<String> {
    let caches = cache_files(Path::new(data_dir))?;
    let mut last_err = None;
    // Newest cache first, but fall back: the game keeps webCaches from older
    // versions around and the most recent one is not always the populated one.
    for cache_file in caches {
        match url_from_cache(&cache_file) {
            Ok(url) => return Ok(url),
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| Error::Msg("Dossier webCaches vide.".into())))
}

fn url_from_cache(cache_file: &Path) -> Result<String> {
    // The file may be locked while the game is running: copy it first.
    let tmp = std::env::temp_dir().join("gensheet_data_2");
    fs::copy(cache_file, &tmp)?;
    let bytes = fs::read(&tmp)?;
    let _ = fs::remove_file(&tmp);

    let text = String::from_utf8_lossy(&bytes);
    let url = text
        .split("1/0/")
        .filter(|chunk| {
            chunk.starts_with("http")
                && chunk.contains("authkey=")
                && (chunk.contains(EVENT_PAGE_MARKER) || chunk.contains(API_MARKER))
        })
        .last()
        .ok_or_else(|| Error::Msg(
            "Aucune URL de vœux en cache : ouvre l'historique des vœux dans le jeu, puis réessaie.".into(),
        ))?;

    // Strip trailing binary garbage.
    Ok(url.chars().take_while(|c| !c.is_control()).collect())
}

// webCaches versions, most recently modified first.
fn cache_files(data_dir: &Path) -> Result<Vec<PathBuf>> {
    let web_caches = data_dir.join("webCaches");
    let mut versions: Vec<PathBuf> = fs::read_dir(&web_caches)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_dir())
        .collect();
    versions.sort_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok());
    versions.reverse();
    Ok(versions
        .into_iter()
        .map(|v| v.join("Cache/Cache_Data/data_2"))
        .filter(|f| f.is_file())
        .collect())
}