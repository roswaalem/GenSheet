//! API game record de HoYoLAB (serveurs overseas).
//!
//! Aucune API officielle n'existe : endpoints, sel du « DS » et noms d'en-têtes
//! viennent de l'implémentation de référence de la communauté (genshin.py) et
//! peuvent casser à n'importe quel patch.
//!
//! Trois volets : la plomberie signée ([`http`]), le profil du compte
//! ([`profile`]) et le détail des personnages ([`characters`]). Les types et
//! fonctions publics sont ré-exportés ici, pour que l'appelant écrive
//! `hoyolab::fetch_profile` sans connaître le découpage interne.

mod characters;
mod http;
mod profile;

use serde::{Deserialize, Serialize};

pub use characters::{fetch_character_build, fetch_characters, Character, CharacterBuild};
pub use http::Session;
pub use profile::{fetch_profile, find_account, Profile};

/// Base commune des endpoints game record.
pub(crate) const RECORD_BASE: &str =
    "https://sg-public-api.hoyolab.com/event/game_record/genshin/api";

/// Le compte Genshin (UID + serveur) rattaché au profil HoYoLAB connecté.
#[derive(Serialize, Deserialize, Clone)]
pub struct Account {
    pub uid: String,
    pub region: String,
    pub nickname: String,
    pub level: i64,
}
