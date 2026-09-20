use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

use crate::atomic_write;

pub(crate) const UI_LANGUAGES: &[&str] =
    &["en", "ru", "de", "es", "pt", "it", "fr", "zh", "ja", "ar"];
const MIN_ZOOM_PERCENT: i32 = 50;
const MAX_ZOOM_PERCENT: i32 = 200;
const MIN_AUTOSAVE_DELAY_MS: i64 = 250;
const MAX_AUTOSAVE_DELAY_MS: i64 = 60_000;
const MIN_TAB_WIDTH: u8 = 1;
const MAX_TAB_WIDTH: u8 = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub spellcheck: SpellcheckSettings,
    #[serde(default)]
    pub auto_correct: AutoCorrectSettings,
    #[serde(default)]
    pub editor: EditorSettings,
    #[serde(default)]
    pub live_preview: LivePreviewSettings,
    #[serde(default)]
    pub files: FileSettings,
    #[serde(default)]
    pub windows: WindowSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: default_language(),
            spellcheck: SpellcheckSettings::default(),
            auto_correct: AutoCorrectSettings::default(),
            editor: EditorSettings::default(),
            live_preview: LivePreviewSettings::default(),
            files: FileSettings::default(),
            windows: WindowSettings::default(),
        }
    }
}

impl Settings {
    /// Clamps values received from IPC or the file to safe ranges.
    pub fn validate(&mut self) {
        self.language = normalize_language(&self.language, true);
        self.editor.zoom_percent = self
            .editor
            .zoom_percent
            .clamp(MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT);
        self.editor.tab_width = self.editor.tab_width.clamp(MIN_TAB_WIDTH, MAX_TAB_WIDTH);
        self.files.autosave_delay_ms = self
            .files
            .autosave_delay_ms
            .clamp(MIN_AUTOSAVE_DELAY_MS, MAX_AUTOSAVE_DELAY_MS);
    }

    /// Resolves `system` to the system language and falls back to English when no translation exists.
    pub fn resolved_language(&self) -> String {
        resolve_language(&self.language, &system_language_code())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellcheckSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub skip_code_formula_links: bool,
}

impl Default for SpellcheckSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            skip_code_formula_links: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoCorrectSettings {
    #[serde(default)]
    pub smart_quotes: bool,
    #[serde(default)]
    pub double_hyphen_to_em_dash: bool,
    #[serde(default)]
    pub capitalize_after_period: bool,
    #[serde(default)]
    pub three_dots_to_ellipsis: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u8,
    #[serde(default = "default_zoom")]
    pub zoom_percent: i32,
    #[serde(default)]
    pub column_width: ColumnWidth,
    #[serde(default = "default_tab_width")]
    pub tab_width: u8,
    #[serde(default = "default_true")]
    pub insert_spaces: bool,
    #[serde(default = "default_true")]
    pub soft_wrap: bool,
    #[serde(default)]
    pub show_invisibles: bool,
    #[serde(default)]
    pub line_numbers: bool,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            font_family: default_font_family(),
            font_size: default_font_size(),
            zoom_percent: default_zoom(),
            column_width: ColumnWidth::default(),
            tab_width: default_tab_width(),
            insert_spaces: true,
            soft_wrap: true,
            show_invisibles: false,
            line_numbers: false,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColumnWidth {
    Narrow,
    #[default]
    Normal,
    Wide,
    FullWidth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePreviewSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub reveal_markup: MarkupRevealMode,
    #[serde(default = "default_true")]
    pub render_formulas: bool,
    #[serde(default = "default_true")]
    pub render_images: bool,
    #[serde(default)]
    pub max_image_width: MaxImageWidth,
    #[serde(default = "default_preview_limit")]
    pub disable_above_bytes: u64,
}

impl Default for LivePreviewSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            reveal_markup: MarkupRevealMode::default(),
            render_formulas: true,
            render_images: true,
            max_image_width: MaxImageWidth::default(),
            disable_above_bytes: default_preview_limit(),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkupRevealMode {
    #[default]
    Cursor,
    Line,
    Never,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaxImageWidth {
    #[default]
    Column,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSettings {
    #[serde(default = "default_true")]
    pub autosave: bool,
    #[serde(default = "default_autosave_delay")]
    pub autosave_delay_ms: i64,
    #[serde(default = "default_true")]
    pub save_on_window_blur: bool,
    #[serde(default = "default_new_document_format")]
    pub new_document_format: String,
    #[serde(default)]
    pub new_document_encoding: NewDocumentEncoding,
    #[serde(default)]
    pub new_document_line_ending: NewDocumentLineEnding,
    #[serde(default)]
    pub trim_trailing_spaces: bool,
    #[serde(default)]
    pub final_newline: bool,
}

impl Default for FileSettings {
    fn default() -> Self {
        Self {
            autosave: true,
            autosave_delay_ms: default_autosave_delay(),
            save_on_window_blur: true,
            new_document_format: default_new_document_format(),
            new_document_encoding: NewDocumentEncoding::default(),
            new_document_line_ending: NewDocumentLineEnding::default(),
            trim_trailing_spaces: false,
            final_newline: false,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NewDocumentEncoding {
    #[default]
    Utf8,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NewDocumentLineEnding {
    #[default]
    System,
    Lf,
    Crlf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSettings {
    #[serde(default = "default_true")]
    pub remember_size_and_position: bool,
    #[serde(default)]
    pub startup_action: StartupAction,
    #[serde(default = "default_true")]
    pub raise_existing_window: bool,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            remember_size_and_position: true,
            startup_action: StartupAction::default(),
            raise_existing_window: true,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupAction {
    #[default]
    StartScreen,
    RecentFiles,
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("settings file I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("settings JSON could not be serialized: {0}")]
    Json(#[from] serde_json::Error),
    #[error("atomic settings write failed: {0}")]
    AtomicWrite(#[source] anyhow::Error),
}

#[derive(Debug)]
struct SettingsDocument {
    settings: Settings,
    raw: Value,
}

/// Application settings and the original JSON used to preserve unknown future fields.
pub struct SettingsState {
    path: PathBuf,
    document: Mutex<SettingsDocument>,
}

pub const MIGRATION_FONT_FAMILY_DEFAULT: &str = "fontFamilyDefault";
pub const MIGRATION_SPELLCHECK_SINGLE_LANGUAGE: &str = "spellcheckSingleLanguage";

fn is_migration_applied(raw: &Value, migration_name: &str) -> bool {
    raw.get("migrations")
        .and_then(|m| m.as_object())
        .and_then(|obj| obj.get(migration_name))
        .and_then(|val| val.as_bool())
        .unwrap_or(false)
}

fn set_migration_applied(raw: &mut Value, migration_name: &str) {
    if !raw.is_object() {
        *raw = Value::Object(Map::new());
    }
    let obj = raw.as_object_mut().unwrap();
    if !obj.contains_key("migrations") || !obj["migrations"].is_object() {
        obj.insert("migrations".to_string(), Value::Object(Map::new()));
    }
    let migrations = obj.get_mut("migrations").unwrap().as_object_mut().unwrap();
    migrations.insert(migration_name.to_string(), Value::Bool(true));
}

/// Marks every migration as complete: a file written by this version is already
/// in the new shape, so there is nothing left to migrate.
fn mark_all_migrations_applied(raw: &mut Value) {
    set_migration_applied(raw, MIGRATION_FONT_FAMILY_DEFAULT);
    set_migration_applied(raw, MIGRATION_SPELLCHECK_SINGLE_LANGUAGE);
}

/// Applies one-time migrations for obsolete defaults in the settings file.
/// Returns true when the file changed and must be rewritten to disk.
fn migrate_document(document: &mut SettingsDocument) -> bool {
    migrate_font_family_default(document)
}

/// Replaces the old font default (`system-serif`) with the current one.
fn migrate_font_family_default(document: &mut SettingsDocument) -> bool {
    if is_migration_applied(&document.raw, MIGRATION_FONT_FAMILY_DEFAULT) {
        return false;
    }

    let is_old_serif_default = document
        .raw
        .get("editor")
        .and_then(|editor| editor.get("fontFamily"))
        .and_then(|val| val.as_str())
        .map(|val| val.trim() == "system-serif")
        .unwrap_or(false);

    set_migration_applied(&mut document.raw, MIGRATION_FONT_FAMILY_DEFAULT);

    if is_old_serif_default {
        if let Some(editor) = document
            .raw
            .get_mut("editor")
            .and_then(|e| e.as_object_mut())
        {
            editor.insert(
                "fontFamily".to_string(),
                Value::String("system-sans".to_string()),
            );
        }
        document.settings.editor.font_family = "system-sans".to_string();
        true
    } else {
        false
    }
}

impl SettingsState {
    pub fn defaults(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            document: Mutex::new(default_document()),
        }
    }

    /// Reads the file once. A missing file is normal; a corrupt file is moved to a backup.
    pub fn load(path: impl Into<PathBuf>) -> Result<Self, SettingsError> {
        let path = path.into();
        let (document, should_save) = match fs::read(&path) {
            Ok(bytes) => match parse_document(&bytes) {
                Ok(mut document) => {
                    let migrated = migrate_document(&mut document);
                    (document, migrated)
                }
                Err(()) => {
                    quarantine_broken_file(&path)?;
                    (default_document(), false)
                }
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => (default_document(), false),
            Err(error) => return Err(SettingsError::Io(error)),
        };
        let state = Self {
            path,
            document: Mutex::new(document),
        };
        if should_save {
            let raw = state.lock_document().raw.clone();
            state.write_value(&raw)?;
        }
        Ok(state)
    }

    pub fn get(&self) -> Settings {
        self.lock_document().settings.clone()
    }

    pub fn save(&self, mut settings: Settings) -> Result<Settings, SettingsError> {
        settings.validate();
        let mut document = self.lock_document();
        let mut merged = merge_values(document.raw.clone(), serde_json::to_value(&settings)?);
        mark_all_migrations_applied(&mut merged);
        self.write_value(&merged)?;
        document.settings = settings.clone();
        document.raw = merged;
        Ok(settings)
    }

    pub fn reset(&self) -> Result<Settings, SettingsError> {
        self.save(Settings::default())
    }

    /// Creates the file when explicitly asked to “Show settings file”, if it does not exist.
    pub fn ensure_file_exists(&self) -> Result<PathBuf, SettingsError> {
        let mut document = self.lock_document();
        if !self.path.exists() {
            let mut settings = document.settings.clone();
            settings.validate();
            let mut merged = merge_values(document.raw.clone(), serde_json::to_value(&settings)?);
            mark_all_migrations_applied(&mut merged);
            self.write_value(&merged)?;
            document.settings = settings;
            document.raw = merged;
        }
        Ok(self.path.clone())
    }

    fn write_value(&self, value: &Value) -> Result<(), SettingsError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut bytes = serde_json::to_vec_pretty(value)?;
        bytes.push(b'\n');
        atomic_write::write_atomic(&self.path, &bytes).map_err(SettingsError::AtomicWrite)
    }

    fn lock_document(&self) -> std::sync::MutexGuard<'_, SettingsDocument> {
        self.document
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn parse_document(bytes: &[u8]) -> Result<SettingsDocument, ()> {
    let raw: Value = serde_json::from_slice(bytes).map_err(|_| ())?;
    let mut settings: Settings = serde_json::from_value(raw.clone()).map_err(|_| ())?;
    settings.validate();
    Ok(SettingsDocument { settings, raw })
}

fn default_document() -> SettingsDocument {
    let mut raw = Value::Object(Map::new());
    mark_all_migrations_applied(&mut raw);
    SettingsDocument {
        settings: Settings::default(),
        raw,
    }
}

fn quarantine_broken_file(path: &Path) -> io::Result<()> {
    let broken_path = path.with_file_name("settings.broken.json");
    if broken_path.exists() {
        fs::remove_file(&broken_path)?;
    }
    fs::rename(path, broken_path)
}

fn merge_values(existing: Value, current: Value) -> Value {
    match (existing, current) {
        (Value::Object(mut old), Value::Object(new)) => {
            for (key, current_value) in new {
                let merged = match old.remove(&key) {
                    Some(old_value) => merge_values(old_value, current_value),
                    None => current_value,
                };
                old.insert(key, merged);
            }
            Value::Object(old)
        }
        (_, current) => current,
    }
}

fn normalize_language(language: &str, allow_system: bool) -> String {
    let normalized = language.trim().to_ascii_lowercase();
    if allow_system && normalized == "system" {
        return normalized;
    }
    let base = normalized.split(['-', '_']).next().unwrap_or_default();
    if UI_LANGUAGES.contains(&base) {
        base.to_owned()
    } else {
        "en".to_owned()
    }
}

pub fn resolve_language(preference: &str, system_language: &str) -> String {
    let preferred = normalize_language(preference, true);
    if preferred == "system" {
        normalize_language(system_language, false)
    } else {
        preferred
    }
}

/// Returns the Windows UI locale code, limited to MarkNote's available translations.
pub fn system_language_code() -> String {
    #[cfg(windows)]
    {
        // GetUserDefaultUILanguage returns the user's Windows UI language.
        #[link(name = "kernel32")]
        extern "system" {
            fn GetUserDefaultUILanguage() -> u16;
        }
        let language_id = unsafe { GetUserDefaultUILanguage() };
        language_from_id(language_id).unwrap_or("en").to_owned()
    }
    #[cfg(not(windows))]
    {
        let locale = ["LC_ALL", "LC_MESSAGES", "LANG"]
            .iter()
            .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))
            .unwrap_or_default();
        resolve_language("system", &locale)
    }
}

fn language_from_id(language_id: u16) -> Option<&'static str> {
    match language_id & 0x03ff {
        0x0001 => Some("ar"),
        0x0004 => Some("zh"),
        0x0007 => Some("de"),
        0x0009 => Some("en"),
        0x000a => Some("es"),
        0x000c => Some("fr"),
        0x0010 => Some("it"),
        0x0011 => Some("ja"),
        0x0016 => Some("pt"),
        0x0019 => Some("ru"),
        _ => None,
    }
}

fn default_language() -> String {
    "en".to_owned()
}

// Defaults match the current appearance: --font-text in src/styles/theme.css is
// Inter and --font-size-text is 16px. Otherwise an update would silently change
// the font and size for everyone who never touched a setting.
fn default_font_family() -> String {
    "system-sans".to_owned()
}

const fn default_font_size() -> u8 {
    16
}

const fn default_zoom() -> i32 {
    100
}

const fn default_tab_width() -> u8 {
    4
}

const fn default_autosave_delay() -> i64 {
    2_000
}

fn default_new_document_format() -> String {
    "markdown".to_owned()
}

const fn default_preview_limit() -> u64 {
    5 * 1024 * 1024
}

const fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_uses_defaults_without_creating_a_file() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("settings.json");
        let state = SettingsState::load(&path).expect("load defaults");

        assert_eq!(state.get(), Settings::default());
        assert!(!path.exists());
    }

    #[test]
    fn corrupted_file_uses_defaults_and_is_renamed() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("settings.json");
        fs::write(&path, b"{ definitely not json").expect("write broken settings");

        let state = SettingsState::load(&path).expect("load defaults after corruption");

        assert_eq!(state.get(), Settings::default());
        assert!(!path.exists());
        assert_eq!(
            fs::read(directory.path().join("settings.broken.json")).expect("read backup"),
            b"{ definitely not json"
        );
    }

    #[test]
    fn unknown_fields_survive_read_modify_and_write() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("settings.json");
        fs::write(
            &path,
            br#"{"language":"en","editor":{"zoomPercent":120,"futureEditor":{"flag":true}},"futureTopLevel":{"value":7}}"#,
        )
        .expect("write initial settings");

        let state = SettingsState::load(&path).expect("load settings");
        let mut settings = state.get();
        settings.editor.zoom_percent = 130;
        state.save(settings).expect("save settings");
        let written: Value = serde_json::from_slice(&fs::read(path).expect("read saved settings"))
            .expect("parse saved JSON");

        assert_eq!(written["editor"]["zoomPercent"], 130);
        assert_eq!(written["editor"]["futureEditor"]["flag"], true);
        assert_eq!(written["futureTopLevel"]["value"], 7);
    }

    #[test]
    fn values_are_clamped_and_language_codes_are_validated() {
        let mut settings = Settings::default();
        settings.editor.zoom_percent = 900;
        settings.editor.tab_width = 0;
        settings.files.autosave_delay_ms = -50;
        settings.language = "xx-YY".to_owned();
        settings.validate();

        assert_eq!(settings.editor.zoom_percent, MAX_ZOOM_PERCENT);
        assert_eq!(settings.editor.tab_width, MIN_TAB_WIDTH);
        assert_eq!(settings.files.autosave_delay_ms, MIN_AUTOSAVE_DELAY_MS);
        assert_eq!(settings.language, "en");

        settings.editor.zoom_percent = -1;
        settings.files.autosave_delay_ms = i64::MAX;
        settings.validate();
        assert_eq!(settings.editor.zoom_percent, MIN_ZOOM_PERCENT);
        assert_eq!(settings.files.autosave_delay_ms, MAX_AUTOSAVE_DELAY_MS);
    }

    #[test]
    fn json_round_trip_preserves_every_settings_field() {
        let settings = Settings {
            language: "ar".to_owned(),
            spellcheck: SpellcheckSettings {
                enabled: false,
                skip_code_formula_links: false,
            },
            auto_correct: AutoCorrectSettings {
                smart_quotes: true,
                double_hyphen_to_em_dash: true,
                capitalize_after_period: true,
                three_dots_to_ellipsis: true,
            },
            editor: EditorSettings {
                font_family: "serif".to_owned(),
                font_size: 20,
                zoom_percent: 120,
                column_width: ColumnWidth::Wide,
                tab_width: 8,
                insert_spaces: false,
                soft_wrap: false,
                show_invisibles: true,
                line_numbers: true,
            },
            live_preview: LivePreviewSettings {
                enabled: false,
                reveal_markup: MarkupRevealMode::Never,
                render_formulas: false,
                render_images: false,
                max_image_width: MaxImageWidth::Column,
                disable_above_bytes: 3_000_000,
            },
            files: FileSettings {
                autosave: false,
                autosave_delay_ms: 4_000,
                save_on_window_blur: false,
                new_document_format: "plain".to_owned(),
                new_document_encoding: NewDocumentEncoding::Utf8,
                new_document_line_ending: NewDocumentLineEnding::Crlf,
                trim_trailing_spaces: true,
                final_newline: true,
            },
            windows: WindowSettings {
                remember_size_and_position: false,
                startup_action: StartupAction::RecentFiles,
                raise_existing_window: false,
            },
        };

        let json = serde_json::to_vec(&settings).expect("serialize");
        let restored: Settings = serde_json::from_slice(&json).expect("deserialize");
        assert_eq!(restored, settings);
    }

    #[test]
    fn system_language_uses_supported_locale_or_english_fallback() {
        assert_eq!(resolve_language("system", "fr-FR"), "fr");
        assert_eq!(resolve_language("system", "xx-YY"), "en");
        assert_eq!(language_from_id(0x0409), Some("en"));
        assert_eq!(language_from_id(0x0419), Some("ru"));
        assert_eq!(language_from_id(0x0401), Some("ar"));
        assert_eq!(language_from_id(0x0411), Some("ja"));
        assert_eq!(language_from_id(0x7c04), Some("zh"));
    }

    #[test]
    fn old_default_system_serif_migrates_to_system_sans_and_is_rewritten_once() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("settings.json");
        fs::write(
            &path,
            br#"{"editor":{"fontFamily":"system-serif","zoomPercent":110}}"#,
        )
        .expect("write initial unmigrated settings");

        // First load: old default must be migrated to system-sans and saved to disk.
        let state = SettingsState::load(&path).expect("first load");
        assert_eq!(state.get().editor.font_family, "system-sans");
        assert_eq!(state.get().editor.zoom_percent, 110);

        let written: Value = serde_json::from_slice(&fs::read(&path).expect("read migrated file"))
            .expect("parse JSON");
        assert_eq!(written["editor"]["fontFamily"], "system-sans");
        assert_eq!(written["editor"]["zoomPercent"], 110);
        assert_eq!(written["migrations"]["fontFamilyDefault"], true);

        let mtime_after_first = fs::metadata(&path)
            .expect("metadata")
            .modified()
            .expect("mtime");

        // Small delay so that a hypothetical second write would produce a different timestamp.
        std::thread::sleep(std::time::Duration::from_millis(50));

        // Second load: migration already marked, file must NOT be rewritten.
        let state2 = SettingsState::load(&path).expect("second load");
        assert_eq!(state2.get().editor.font_family, "system-sans");

        let mtime_after_second = fs::metadata(&path)
            .expect("metadata")
            .modified()
            .expect("mtime");
        assert_eq!(
            mtime_after_first, mtime_after_second,
            "migrated settings file should not be touched on second load"
        );
    }

    #[test]
    fn consciously_chosen_system_serif_is_never_overwritten_or_touched() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("settings.json");
        let initial_bytes = br#"{"editor":{"fontFamily":"system-serif","zoomPercent":120},"migrations":{"fontFamilyDefault":true}}"#;
        fs::write(&path, initial_bytes).expect("write settings with conscious serif");

        let mtime_before = fs::metadata(&path)
            .expect("metadata")
            .modified()
            .expect("mtime");

        std::thread::sleep(std::time::Duration::from_millis(50));

        let state = SettingsState::load(&path).expect("load settings");
        assert_eq!(
            state.get().editor.font_family,
            "system-serif",
            "conscious choice of serif must be preserved"
        );
        assert_eq!(state.get().editor.zoom_percent, 120);

        let current_bytes = fs::read(&path).expect("read file");
        assert_eq!(
            current_bytes, initial_bytes,
            "file content should be completely untouched"
        );

        let mtime_after = fs::metadata(&path)
            .expect("metadata")
            .modified()
            .expect("mtime");
        assert_eq!(
            mtime_before, mtime_after,
            "file with conscious serif choice should not be touched at all"
        );
    }

    #[test]
    fn conscious_choice_of_serif_after_migration_is_persisted_and_survives_restart() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("settings.json");
        fs::write(
            &path,
            br#"{"editor":{"fontFamily":"system-serif","zoomPercent":100}}"#,
        )
        .expect("write old settings");

        // 1. Initial load migrates to system-sans.
        let state = SettingsState::load(&path).expect("initial load");
        assert_eq!(state.get().editor.font_family, "system-sans");

        // 2. User explicitly chooses system-serif and saves.
        let mut settings = state.get();
        settings.editor.font_family = "system-serif".to_owned();
        state.save(settings).expect("save user choice");

        let saved_json: Value =
            serde_json::from_slice(&fs::read(&path).expect("read saved file")).expect("parse JSON");
        assert_eq!(saved_json["editor"]["fontFamily"], "system-serif");
        assert_eq!(saved_json["migrations"]["fontFamilyDefault"], true);

        let mtime_saved = fs::metadata(&path)
            .expect("metadata")
            .modified()
            .expect("mtime");
        std::thread::sleep(std::time::Duration::from_millis(50));

        // 3. Next application restart: conscious choice must NOT be reset or touched.
        let restarted = SettingsState::load(&path).expect("load restarted");
        assert_eq!(restarted.get().editor.font_family, "system-serif");

        let mtime_restarted = fs::metadata(&path)
            .expect("metadata")
            .modified()
            .expect("mtime");
        assert_eq!(
            mtime_saved, mtime_restarted,
            "restarted load must not rewrite file with conscious serif"
        );
    }

    #[test]
    fn legacy_spellcheck_language_fields_are_ignored_and_preserved() {
        for (enabled, json_enabled) in [(true, "true"), (false, "false")] {
            let directory = tempfile::tempdir().expect("temporary directory");
            let path = directory.path().join("settings.json");
            let source = format!(
                r#"{{"spellcheck":{{"enabled":{json_enabled},"language":"ru","languages":["ru","en"],"futureSpellcheck":{{"kept":true}}}},"migrations":{{"spellcheckSingleLanguage":true}}}}"#
            );
            fs::write(&path, source).expect("write legacy settings");

            let state = SettingsState::load(&path).expect("legacy settings must load");
            assert_eq!(state.get().spellcheck.enabled, enabled);

            state.save(state.get()).expect("save legacy settings");
            let written: Value =
                serde_json::from_slice(&fs::read(&path).expect("read saved settings"))
                    .expect("parse saved JSON");
            assert_eq!(written["spellcheck"]["language"], "ru");
            assert_eq!(written["spellcheck"]["languages"][0], "ru");
            assert_eq!(written["spellcheck"]["futureSpellcheck"]["kept"], true);
            assert_eq!(written["migrations"]["spellcheckSingleLanguage"], true);
        }
    }

    #[test]
    fn migration_preserves_unknown_fields_and_other_settings() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("settings.json");
        fs::write(
            &path,
            br#"{"editor":{"fontFamily":"system-serif","highlightCurrentLine":true},"customField":"test-value"}"#,
        )
        .expect("write settings with unknown fields");

        let state = SettingsState::load(&path).expect("load settings");
        assert_eq!(state.get().editor.font_family, "system-sans");

        let written: Value =
            serde_json::from_slice(&fs::read(&path).expect("read file")).expect("parse JSON");
        assert_eq!(written["editor"]["fontFamily"], "system-sans");
        assert_eq!(written["editor"]["highlightCurrentLine"], true);
        assert_eq!(written["customField"], "test-value");
        assert_eq!(written["migrations"]["fontFamilyDefault"], true);
    }
}
