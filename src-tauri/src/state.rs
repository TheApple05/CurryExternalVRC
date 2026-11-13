use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::Path};

const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Pick {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Picks {
    pub avatar: Vec<Pick>,
    pub world: Vec<Pick>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SavedState {
    pub picks: Picks,
    pub accounts: Vec<String>,
    pub players: Vec<String>,
}

pub fn valid_id(id: &str, prefix: &str) -> bool {
    id.len() <= 128
        && id.strip_prefix(prefix).is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
}

impl SavedState {
    pub fn validate(&self) -> Result<(), String> {
        for (picks, prefix) in [(&self.picks.avatar, "avtr_"), (&self.picks.world, "wrld_")] {
            let mut seen = HashSet::new();
            if picks.len() > 5000
                || picks.iter().any(|p| {
                    !valid_id(&p.id, prefix)
                        || p.name.is_empty()
                        || p.name.chars().count() > 128
                        || !seen.insert(&p.id)
                })
            {
                return Err("Invalid bookmarks or more than 5,000 picks per list.".into());
            }
        }
        let mut seen = HashSet::new();
        if self.accounts.len() > 50
            || self.accounts.iter().any(|label| {
                label.trim().is_empty()
                    || label.chars().count() > 40
                    || !seen.insert(label.to_lowercase())
            })
        {
            return Err("Invalid account labels or more than 50 shortcuts.".into());
        }
        let mut seen = HashSet::new();
        if self.players.len() > 200
            || self
                .players
                .iter()
                .any(|id| !valid_id(id, "usr_") || !seen.insert(id))
        {
            return Err("Invalid profile IDs or more than 200 profiles.".into());
        }
        Ok(())
    }
}

pub fn load(path: &Path) -> Result<SavedState, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SavedState::default())
        }
        Err(error) => return Err(format!("Could not read saved data: {error}")),
    };
    if metadata.len() > MAX_BYTES {
        return Err("Saved data exceeds 2 MB; the original file has been preserved.".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("Could not read saved data: {e}"))?;
    let state: SavedState = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Saved data is invalid; the original file has been preserved: {e}"))?;
    state.validate()?;
    Ok(state)
}

pub fn save(path: &Path, state: &SavedState) -> Result<(), String> {
    state.validate()?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Saved data exceeds 2 MB.".into());
    }
    let parent = path.parent().ok_or("Missing data directory")?;
    fs::create_dir_all(parent).map_err(|e| format!("Could not create data directory: {e}"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path)
        .map_err(|e| format!("Could not replace saved data: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_invalid_write_preserve_last_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        assert_eq!(load(&path).unwrap(), SavedState::default());
        let mut state = SavedState {
            accounts: vec!["Work".into()],
            ..Default::default()
        };
        save(&path, &state).unwrap();
        state.players.push("usr_test-123".into());
        save(&path, &state).unwrap();
        assert_eq!(load(&path).unwrap(), state);
        state.accounts.push("work".into());
        assert!(save(&path, &state).is_err());
        assert_eq!(load(&path).unwrap().accounts, ["Work"]);
    }

    #[test]
    fn corrupt_data_is_not_silently_reset() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, "broken").unwrap();
        assert!(load(&path).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "broken");
    }

    #[cfg(windows)]
    #[test]
    fn failed_replacement_preserves_previous_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let original = SavedState::default();
        save(&path, &original).unwrap();
        // Allow reads while denying Windows permission to replace the file.
        let _locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        let changed = SavedState {
            accounts: vec!["Work".into()],
            ..Default::default()
        };
        assert!(save(&path, &changed).is_err());
        assert_eq!(load(&path).unwrap(), original);
    }

    #[test]
    fn rejects_invalid_ids_and_limits() {
        for id in ["avtr_", "avtr_../secret", "wrld_wrong", "avtr_💥"] {
            assert!(!valid_id(id, "avtr_"));
        }
        assert!(valid_id("avtr_a-b_123", "avtr_"));
        let mut state = SavedState {
            accounts: vec!["a".repeat(41)],
            ..Default::default()
        };
        assert!(state.validate().is_err());
        state.accounts.clear();
        state.players = (0..201).map(|i| format!("usr_{i}")).collect();
        assert!(state.validate().is_err());
    }
}
