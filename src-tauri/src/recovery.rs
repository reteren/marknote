use std::{
    collections::{BTreeMap, BTreeSet},
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

use crate::atomic_write;

pub const RECOVERY_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint {
    pub size: u64,
    pub modified: Option<String>,
}

impl FileFingerprint {
    pub fn from_metadata(metadata: &fs::Metadata) -> Self {
        Self {
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos().to_string()),
        }
    }
}

pub fn file_fingerprint(path: &Path) -> io::Result<FileFingerprint> {
    fs::metadata(path).map(|metadata| FileFingerprint::from_metadata(&metadata))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub version: u32,
    pub window_label: String,
    pub tab_id: String,
    pub path: Option<String>,
    pub title: String,
    pub format_id: String,
    pub encoding: String,
    #[serde(default)]
    pub bom: bool,
    pub line_ending: String,
    pub text: String,
    pub updated_at: String,
    pub base_fingerprint: Option<FileFingerprint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovered_from: Option<String>,
}

impl RecoverySnapshot {
    fn validate(&self) -> io::Result<()> {
        if self.version != RECOVERY_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("unsupported recovery version {}", self.version),
            ));
        }
        if self.window_label.is_empty()
            || self.tab_id.is_empty()
            || self.format_id.is_empty()
            || !matches!(self.line_ending.as_str(), "lf" | "crlf")
            || self
                .recovered_from
                .as_deref()
                .is_some_and(|id| !is_entry_id(id))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "recovery entry has invalid identity or document metadata",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub id: String,
    #[serde(flatten)]
    pub snapshot: RecoverySnapshot,
    pub disk_fingerprint: Option<FileFingerprint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(test)]
pub enum RecoveryDecision {
    Untitled,
    RestorePath,
    UntitledRecovered,
}

#[cfg(test)]
pub fn decide_recovery(
    path: Option<&str>,
    base: Option<&FileFingerprint>,
    disk: Option<&FileFingerprint>,
) -> RecoveryDecision {
    match path {
        None => RecoveryDecision::Untitled,
        Some(_)
            if base.is_some_and(|fingerprint| fingerprint.modified.is_some()) && base == disk =>
        {
            RecoveryDecision::RestorePath
        }
        Some(_) => RecoveryDecision::UntitledRecovered,
    }
}

#[derive(Clone)]
pub struct RecoveryStore {
    inner: Arc<RecoveryStoreInner>,
}

struct RecoveryStoreInner {
    directory: PathBuf,
    entries: Mutex<BTreeMap<String, RecoverySnapshot>>,
}

impl RecoveryStore {
    /// Loads and validates the previous process's journal during Rust setup,
    /// before any window starts opening its launch documents.
    pub fn load(directory: impl Into<PathBuf>) -> io::Result<Self> {
        let directory = directory.into();
        fs::create_dir_all(&directory)?;
        let mut entries = BTreeMap::new();

        for item in fs::read_dir(&directory)? {
            let item = match item {
                Ok(item) => item,
                Err(error) => {
                    eprintln!("Could not inspect a recovery entry: {error}");
                    continue;
                }
            };
            let path = item.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            let id = item.file_name().to_string_lossy().into_owned();
            let parsed = fs::read(&path)
                .map_err(|error| error.to_string())
                .and_then(|bytes| {
                    serde_json::from_slice::<RecoverySnapshot>(&bytes)
                        .map_err(|error| error.to_string())
                })
                .and_then(|snapshot| {
                    snapshot.validate().map_err(|error| error.to_string())?;
                    if entry_id(&snapshot.window_label, &snapshot.tab_id) != id {
                        return Err("recovery filename does not match its tab identity".to_string());
                    }
                    Ok(snapshot)
                });
            match parsed {
                Ok(snapshot) => {
                    entries.insert(id, snapshot);
                }
                Err(error) => {
                    eprintln!(
                        "Ignoring corrupt recovery entry {}: {error}",
                        path.display()
                    );
                    if let Err(quarantine_error) = quarantine_bad_entry(&path) {
                        eprintln!(
                            "Could not quarantine corrupt recovery entry {}: {quarantine_error}",
                            path.display()
                        );
                    }
                }
            }
        }

        // A child snapshot is written before its old entry is removed during
        // restore. If a kill lands between those operations, keep the child
        // and discard its parent so the same document is not restored twice.
        let referenced = entries
            .values()
            .filter_map(|snapshot| snapshot.recovered_from.as_ref())
            .cloned()
            .collect::<BTreeSet<_>>();
        for parent_id in referenced {
            if entries.remove(&parent_id).is_some() {
                let parent_path = directory.join(&parent_id);
                if let Err(error) = remove_if_exists(&parent_path) {
                    eprintln!("Could not finish recovery journal transfer: {error}");
                }
            }
        }

        Ok(Self {
            inner: Arc::new(RecoveryStoreInner {
                directory,
                entries: Mutex::new(entries),
            }),
        })
    }

    pub fn list(&self) -> Vec<RecoveryEntry> {
        let snapshots = self
            .inner
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .map(|(id, snapshot)| (id.clone(), snapshot.clone()))
            .collect::<Vec<_>>();
        snapshots
            .into_iter()
            .map(|(id, snapshot)| RecoveryEntry {
                disk_fingerprint: snapshot
                    .path
                    .as_deref()
                    .and_then(|path| file_fingerprint(Path::new(path)).ok()),
                id,
                snapshot,
            })
            .collect()
    }

    pub fn write(&self, snapshot: RecoverySnapshot) -> io::Result<String> {
        snapshot.validate()?;
        let id = entry_id(&snapshot.window_label, &snapshot.tab_id);
        let mut bytes = serde_json::to_vec_pretty(&snapshot)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        bytes.push(b'\n');
        atomic_write::write_atomic(&self.inner.directory.join(&id), &bytes)
            .map_err(|error| io::Error::other(error.to_string()))?;
        self.inner
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id.clone(), snapshot);
        Ok(id)
    }

    pub fn delete_tab(&self, window_label: &str, tab_id: &str) -> io::Result<()> {
        self.delete_entry(&entry_id(window_label, tab_id))
    }

    pub fn delete_entry(&self, id: &str) -> io::Result<()> {
        if !is_entry_id(id) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid recovery entry id",
            ));
        }
        remove_if_exists(&self.inner.directory.join(id))?;
        self.inner
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(id);
        Ok(())
    }
}

fn entry_id(window_label: &str, tab_id: &str) -> String {
    format!(
        "{}-{}.json",
        safe_component(window_label),
        safe_component(tab_id)
    )
}

fn safe_component(component: &str) -> String {
    component
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn is_entry_id(id: &str) -> bool {
    !id.is_empty()
        && id.ends_with(".json")
        && Path::new(id).file_name().and_then(|name| name.to_str()) == Some(id)
        && !id
            .chars()
            .any(|character| matches!(character, '/' | '\\' | ':'))
}

fn remove_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn quarantine_bad_entry(path: &Path) -> io::Result<()> {
    let base_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "recovery entry has no name"))?
        .to_string_lossy();
    let mut candidate = path.with_file_name(format!("{base_name}.bad"));
    let mut suffix = 1_u32;
    while candidate.exists() {
        candidate = path.with_file_name(format!("{base_name}.{suffix}.bad"));
        suffix += 1;
    }
    fs::rename(path, candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(window_label: &str, tab_id: &str, text: &str) -> RecoverySnapshot {
        RecoverySnapshot {
            version: RECOVERY_VERSION,
            window_label: window_label.to_string(),
            tab_id: tab_id.to_string(),
            path: None,
            title: "Untitled.md".to_string(),
            format_id: "markdown".to_string(),
            encoding: "utf-8".to_string(),
            bom: false,
            line_ending: "lf".to_string(),
            text: text.to_string(),
            updated_at: "2026-09-23T00:00:00.000Z".to_string(),
            base_fingerprint: None,
            recovered_from: None,
        }
    }

    #[test]
    fn journal_store_writes_lists_and_deletes_entries() {
        let directory = tempfile::tempdir().unwrap();
        let store = RecoveryStore::load(directory.path().join("recovery")).unwrap();
        let id = store
            .write(snapshot("main", "tab-1", "unsaved text"))
            .unwrap();

        let entries = store.list();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "main-tab-1.json");
        assert_eq!(entries[0].snapshot.text, "unsaved text");
        assert!(directory.path().join("recovery").join(&id).is_file());

        store.delete_tab("main", "tab-1").unwrap();
        assert!(store.list().is_empty());
        assert!(!directory.path().join("recovery").join(id).exists());
    }

    #[test]
    fn recovery_decision_restores_only_when_base_fingerprint_matches() {
        let base = FileFingerprint {
            size: 42,
            modified: Some("123456".to_string()),
        };
        let same = base.clone();
        let changed = FileFingerprint {
            size: 43,
            modified: Some("123456".to_string()),
        };

        assert_eq!(
            decide_recovery(Some("note.md"), Some(&base), Some(&same)),
            RecoveryDecision::RestorePath
        );
        assert_eq!(
            decide_recovery(Some("note.md"), Some(&base), Some(&changed)),
            RecoveryDecision::UntitledRecovered
        );
        assert_eq!(
            decide_recovery(Some("note.md"), Some(&base), None),
            RecoveryDecision::UntitledRecovered
        );
        let unavailable_timestamp = FileFingerprint {
            size: 42,
            modified: None,
        };
        assert_eq!(
            decide_recovery(
                Some("note.md"),
                Some(&unavailable_timestamp),
                Some(&unavailable_timestamp)
            ),
            RecoveryDecision::UntitledRecovered
        );
        assert_eq!(
            decide_recovery(None, None, None),
            RecoveryDecision::Untitled
        );
    }

    #[test]
    fn corrupt_entry_is_quarantined_without_hiding_valid_entries() {
        let directory = tempfile::tempdir().unwrap();
        let recovery_dir = directory.path().join("recovery");
        fs::create_dir_all(&recovery_dir).unwrap();
        fs::write(recovery_dir.join("main-tab-bad.json"), b"{broken").unwrap();
        fs::write(
            recovery_dir.join("main-tab-good.json"),
            serde_json::to_vec(&snapshot("main", "tab-good", "safe")).unwrap(),
        )
        .unwrap();

        let store = RecoveryStore::load(&recovery_dir).unwrap();
        assert_eq!(store.list().len(), 1);
        assert!(!recovery_dir.join("main-tab-bad.json").exists());
        assert!(recovery_dir.join("main-tab-bad.json.bad").is_file());
    }

    #[test]
    fn transfer_child_keeps_the_new_entry_and_removes_the_parent() {
        let directory = tempfile::tempdir().unwrap();
        let recovery_dir = directory.path().join("recovery");
        let initial = RecoveryStore::load(&recovery_dir).unwrap();
        initial.write(snapshot("main", "tab-1", "recovered")).unwrap();
        let mut child = snapshot("main", "tab-1-session", "recovered");
        child.recovered_from = Some("main-tab-1.json".to_string());
        initial.write(child).unwrap();

        let restored = RecoveryStore::load(&recovery_dir).unwrap();
        let entries = restored.list();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "main-tab-1-session.json");
        assert!(!recovery_dir.join("main-tab-1.json").exists());
    }
}
