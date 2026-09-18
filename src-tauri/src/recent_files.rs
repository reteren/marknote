use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::atomic_write;

pub const MAX_RECENT_FILES: usize = 10;

#[derive(Debug, Error)]
pub enum RecentFilesError {
    #[error("recent files file I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("recent files JSON could not be serialized: {0}")]
    Json(#[from] serde_json::Error),
    #[error("atomic recent files write failed: {0}")]
    AtomicWrite(#[source] anyhow::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileEntry {
    pub path: String,
    pub opened_at: u64,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug)]
struct RecentFilesDocument {
    entries: Vec<RecentFileEntry>,
    raw: Value,
}

pub struct RecentFilesState {
    path: PathBuf,
    document: Mutex<RecentFilesDocument>,
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn paths_match(a: &str, b: &str) -> bool {
    let pa = Path::new(a);
    let pb = Path::new(b);
    if pa == pb {
        return true;
    }
    #[cfg(windows)]
    {
        if let (Ok(ca), Ok(cb)) = (pa.canonicalize(), pb.canonicalize()) {
            return ca == cb;
        }
        a.eq_ignore_ascii_case(b)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

impl RecentFilesState {
    pub fn defaults(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            document: Mutex::new(default_document()),
        }
    }

    pub fn load(path: impl Into<PathBuf>) -> Result<Self, RecentFilesError> {
        let path = path.into();
        let document = match fs::read(&path) {
            Ok(bytes) => match parse_document(&bytes) {
                Ok(doc) => doc,
                Err(()) => {
                    quarantine_broken_file(&path)?;
                    default_document()
                }
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => default_document(),
            Err(error) => return Err(RecentFilesError::Io(error)),
        };

        Ok(Self {
            path,
            document: Mutex::new(document),
        })
    }

    pub fn get_and_prune(&self) -> Result<Vec<RecentFileEntry>, RecentFilesError> {
        let mut doc = self.lock_document();
        let initial_len = doc.entries.len();
        doc.entries.retain(|entry| Path::new(&entry.path).is_file());
        if doc.entries.len() > MAX_RECENT_FILES {
            doc.entries.truncate(MAX_RECENT_FILES);
        }
        if doc.entries.len() != initial_len {
            self.persist_locked(&mut doc)?;
        }
        Ok(doc.entries.clone())
    }

    pub fn add(&self, path: &str) -> Result<(), RecentFilesError> {
        self.add_with_timestamp(path, current_timestamp_ms())
    }

    pub fn add_with_timestamp(&self, path: &str, timestamp: u64) -> Result<(), RecentFilesError> {
        let mut doc = self.lock_document();

        // Remove duplicate if already present
        let mut existing_extra = None;
        if let Some(pos) = doc.entries.iter().position(|e| paths_match(&e.path, path)) {
            let removed = doc.entries.remove(pos);
            existing_extra = Some(removed.extra);
        }

        // Add to front
        doc.entries.insert(
            0,
            RecentFileEntry {
                path: path.to_string(),
                opened_at: timestamp,
                extra: existing_extra.unwrap_or_default(),
            },
        );

        if doc.entries.len() > MAX_RECENT_FILES {
            doc.entries.truncate(MAX_RECENT_FILES);
        }

        self.persist_locked(&mut doc)
    }

    pub fn clear(&self) -> Result<(), RecentFilesError> {
        let mut doc = self.lock_document();
        doc.entries.clear();
        self.persist_locked(&mut doc)
    }

    fn persist_locked(&self, doc: &mut RecentFilesDocument) -> Result<(), RecentFilesError> {
        if !doc.raw.is_object() {
            doc.raw = Value::Object(serde_json::Map::new());
        }
        let obj = doc.raw.as_object_mut().unwrap();
        let entries_val = serde_json::to_value(&doc.entries)?;
        obj.insert("recentFiles".to_string(), entries_val);

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut bytes = serde_json::to_vec_pretty(&doc.raw)?;
        bytes.push(b'\n');
        atomic_write::write_atomic(&self.path, &bytes).map_err(RecentFilesError::AtomicWrite)
    }

    fn lock_document(&self) -> std::sync::MutexGuard<'_, RecentFilesDocument> {
        self.document
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn parse_document(bytes: &[u8]) -> Result<RecentFilesDocument, ()> {
    let raw: Value = serde_json::from_slice(bytes).map_err(|_| ())?;
    let entries: Vec<RecentFileEntry> = if let Some(arr) = raw.get("recentFiles") {
        serde_json::from_value(arr.clone()).map_err(|_| ())?
    } else if raw.is_array() {
        serde_json::from_value(raw.clone()).map_err(|_| ())?
    } else {
        Vec::new()
    };
    Ok(RecentFilesDocument { entries, raw })
}

fn default_document() -> RecentFilesDocument {
    let mut map = serde_json::Map::new();
    map.insert("version".to_string(), Value::Number(1.into()));
    map.insert("recentFiles".to_string(), Value::Array(Vec::new()));
    RecentFilesDocument {
        entries: Vec::new(),
        raw: Value::Object(map),
    }
}

fn quarantine_broken_file(path: &Path) -> io::Result<()> {
    let broken_path = path.with_file_name("recent-files.broken.json");
    if broken_path.exists() {
        fs::remove_file(&broken_path)?;
    }
    fs::rename(path, broken_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_uses_defaults_without_creating_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent-files.json");

        let state = RecentFilesState::load(&path).unwrap();
        assert_eq!(state.get_and_prune().unwrap().len(), 0);
        assert!(
            !path.exists(),
            "load should not create file on disk until write"
        );
    }

    #[test]
    fn add_and_deduplication() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent-files.json");
        let state = RecentFilesState::load(&path).unwrap();

        let file1 = dir.path().join("file1.md");
        let file2 = dir.path().join("file2.md");
        fs::write(&file1, "1").unwrap();
        fs::write(&file2, "2").unwrap();

        state
            .add_with_timestamp(&file1.to_string_lossy(), 1000)
            .unwrap();
        state
            .add_with_timestamp(&file2.to_string_lossy(), 2000)
            .unwrap();

        let entries = state.get_and_prune().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, file2.to_string_lossy());
        assert_eq!(entries[0].opened_at, 2000);
        assert_eq!(entries[1].path, file1.to_string_lossy());

        // Re-adding file1 moves it to front and updates timestamp
        state
            .add_with_timestamp(&file1.to_string_lossy(), 3000)
            .unwrap();
        let updated = state.get_and_prune().unwrap();
        assert_eq!(updated.len(), 2);
        assert_eq!(updated[0].path, file1.to_string_lossy());
        assert_eq!(updated[0].opened_at, 3000);
        assert_eq!(updated[1].path, file2.to_string_lossy());
    }

    #[test]
    fn max_ten_entries_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent-files.json");
        let state = RecentFilesState::load(&path).unwrap();

        for i in 1..=15 {
            let f = dir.path().join(format!("file_{i}.md"));
            fs::write(&f, "content").unwrap();
            state
                .add_with_timestamp(&f.to_string_lossy(), i as u64 * 100)
                .unwrap();
        }

        let entries = state.get_and_prune().unwrap();
        assert_eq!(entries.len(), MAX_RECENT_FILES);
        // Most recent should be file_15
        let file_15 = dir.path().join("file_15.md");
        assert_eq!(entries[0].path, file_15.to_string_lossy());
        // Oldest kept should be file_6
        let file_6 = dir.path().join("file_6.md");
        assert_eq!(entries[9].path, file_6.to_string_lossy());
    }

    #[test]
    fn prunes_non_existent_files_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent-files.json");
        let state = RecentFilesState::load(&path).unwrap();

        let f1 = dir.path().join("live.md");
        let f2 = dir.path().join("deleted.md");
        fs::write(&f1, "live").unwrap();
        fs::write(&f2, "will delete").unwrap();

        state.add(&f1.to_string_lossy()).unwrap();
        state.add(&f2.to_string_lossy()).unwrap();

        assert_eq!(state.get_and_prune().unwrap().len(), 2);

        // Delete f2
        fs::remove_file(&f2).unwrap();

        // get_and_prune should remove f2 and persist
        let pruned = state.get_and_prune().unwrap();
        assert_eq!(pruned.len(), 1);
        assert_eq!(pruned[0].path, f1.to_string_lossy());

        // Reload state to ensure disk was updated
        let reloaded = RecentFilesState::load(&path).unwrap();
        let reloaded_entries = reloaded.get_and_prune().unwrap();
        assert_eq!(reloaded_entries.len(), 1);
        assert_eq!(reloaded_entries[0].path, f1.to_string_lossy());
    }

    #[test]
    fn clear_erases_all_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent-files.json");
        let state = RecentFilesState::load(&path).unwrap();

        let f = dir.path().join("file.md");
        fs::write(&f, "content").unwrap();
        state.add(&f.to_string_lossy()).unwrap();
        assert_eq!(state.get_and_prune().unwrap().len(), 1);

        state.clear().unwrap();
        assert_eq!(state.get_and_prune().unwrap().len(), 0);

        let reloaded = RecentFilesState::load(&path).unwrap();
        assert_eq!(reloaded.get_and_prune().unwrap().len(), 0);
    }

    #[test]
    fn preserves_unknown_fields_top_level_and_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent-files.json");
        let f = dir.path().join("f.md");
        fs::write(&f, "hello").unwrap();

        let initial_json = serde_json::json!({
            "version": 2,
            "customTopField": "preserved",
            "recentFiles": [
                {
                    "path": f.to_string_lossy(),
                    "openedAt": 12345,
                    "customEntryField": 999
                }
            ]
        });

        fs::write(&path, serde_json::to_vec_pretty(&initial_json).unwrap()).unwrap();

        let state = RecentFilesState::load(&path).unwrap();
        // Modify by re-adding with newer timestamp
        state
            .add_with_timestamp(&f.to_string_lossy(), 67890)
            .unwrap();

        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["version"], 2);
        assert_eq!(saved["customTopField"], "preserved");
        assert_eq!(saved["recentFiles"][0]["openedAt"], 67890);
        assert_eq!(saved["recentFiles"][0]["customEntryField"], 999);
    }

    #[test]
    fn corrupted_file_quarantined() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent-files.json");
        fs::write(&path, b"not valid json").unwrap();

        let state = RecentFilesState::load(&path).unwrap();
        assert_eq!(state.get_and_prune().unwrap().len(), 0);

        let broken_path = dir.path().join("recent-files.broken.json");
        assert!(
            broken_path.exists(),
            "broken file must be renamed to quarantine"
        );
    }
}
