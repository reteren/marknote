#![allow(dead_code)]

#[cfg(all(windows, target_env = "msvc"))]
core::arch::global_asm!(
    r#"
    .section .drectve,"yn"
    .ascii " /MANIFESTDEPENDENCY:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\" "
    "#
);

#[path = "../src/encoding.rs"]
mod encoding;

#[path = "../src/atomic_write.rs"]
mod atomic_write;

#[path = "../src/formats/mod.rs"]
mod formats;

#[path = "../src/watcher.rs"]
mod watcher;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use encoding::LineEnding;
use tauri::Listener;
use watcher::FileWatcher;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("cargo manifest dir has parent")
        .join("fixtures")
}

// =========================================================================
// 1. Atomic write
// =========================================================================

#[test]
fn test_atomic_write_truncation_and_clean_directory() {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let target = dir.path().join("document.md");

    // Write long text.
    let long_text =
        b"This is a very long text occupying multiple blocks on disk and padding bytes...";
    atomic_write::write_atomic(&target, long_text).expect("initial write failed");

    let read_long = fs::read(&target).expect("read target failed");
    assert_eq!(read_long, long_text);

    // Write short text over the existing long text.
    let short_text = b"Short";
    atomic_write::write_atomic(&target, short_text).expect("overwrite failed");

    let read_short = fs::read(&target).expect("read overwritten target failed");
    assert_eq!(
        read_short, short_text,
        "The file must contain exactly the new content without the old tail"
    );
    assert_eq!(read_short.len(), 5);

    // A series of sequential atomic writes.
    for i in 0..15 {
        let content = format!("Revision {i} with payload: {}", "x".repeat(i * 100));
        atomic_write::write_atomic(&target, content.as_bytes())
            .unwrap_or_else(|e| panic!("write revision {i} failed: {e}"));
    }

    // Verify that the directory contains exactly one file and no temporary debris.
    let mut files = Vec::new();
    for entry in fs::read_dir(dir.path()).expect("read_dir failed") {
        let entry = entry.expect("dir entry failed");
        let name = entry.file_name().to_string_lossy().into_owned();
        files.push(name);
    }

    assert_eq!(
        files.len(),
        1,
        "Exactly one file should remain in the directory, found: {:?}",
        files
    );
    assert_eq!(files[0], "document.md");
}

// =========================================================================
// 2. Round trip through the format registry for files in fixtures/
// =========================================================================

#[test]
fn test_round_trip_clean_fixtures() {
    // Reference files without internal line-ending anomalies must match byte-for-byte.
    let clean_fixtures = [
        ("empty.md", "utf-8", LineEnding::Lf, false),
        ("utf8-bom.md", "utf-8", LineEnding::Lf, true),
        ("utf16le.md", "utf-16le", LineEnding::Lf, true),
        ("crlf.md", "utf-8", LineEnding::Crlf, false),
        ("lf.md", "utf-8", LineEnding::Lf, false),
        ("showcase.md", "utf-8", LineEnding::Lf, false),
    ];

    let dir = fixtures_dir();
    let temp_dir = tempfile::tempdir().expect("tempdir failed");

    for (name, expected_enc, expected_eol, expected_bom) in clean_fixtures {
        let path = dir.join(name);
        let raw_bytes = fs::read(&path).unwrap_or_else(|e| panic!("read {name} failed: {e}"));

        let adapter = formats::adapter_for_path(&path);
        let decoded = adapter
            .decode(&raw_bytes)
            .unwrap_or_else(|e| panic!("decode {name} failed: {e}"));

        assert_eq!(
            decoded.encoding, expected_enc,
            "{name}: unexpected encoding"
        );
        assert_eq!(
            decoded.line_ending, expected_eol,
            "{name}: unexpected line ending"
        );
        assert_eq!(decoded.bom, expected_bom, "{name}: BOM flag does not match");

        let encoded_bytes = adapter
            .encode(&decoded.text, &decoded)
            .unwrap_or_else(|e| panic!("encode {name} failed: {e}"));

        // Write a temporary copy.
        let copy_path = temp_dir.path().join(name);
        atomic_write::write_atomic(&copy_path, &encoded_bytes).expect("write copy failed");
        let disk_copy = fs::read(&copy_path).expect("read copy failed");

        assert_eq!(
            raw_bytes, disk_copy,
            "Bytes for {name} must match 100% after a round trip and disk write"
        );
    }
}

#[test]
fn test_round_trip_investigation_mixed_eol_and_cp1251() {
    let dir = fixtures_dir();

    // 1. Investigate mixed-eol.md.
    let mixed_path = dir.join("mixed-eol.md");
    let mixed_raw = fs::read(&mixed_path).expect("read mixed-eol.md failed");
    let mixed_adapter = formats::adapter_for_path(&mixed_path);
    let mixed_decoded = mixed_adapter
        .decode(&mixed_raw)
        .expect("decode mixed-eol.md failed");

    // mixed-eol.md contains two CRLF lines and two LF lines.
    // The majority rule (crlf >= lf) selects CRLF.
    assert_eq!(mixed_decoded.line_ending, LineEnding::Crlf);

    let mixed_encoded = mixed_adapter
        .encode(&mixed_decoded.text, &mixed_decoded)
        .expect("encode mixed-eol.md failed");

    // Source file: 67 bytes. Encoded file: 69 bytes (+2 bytes from normalizing two LF to CRLF).
    assert_eq!(mixed_raw.len(), 67);
    assert_eq!(mixed_encoded.len(), 69);
    // The first difference is at byte 56 (0x38): source LF (0x0A) becomes CRLF (0x0D 0x0A).
    assert_eq!(mixed_raw[56], 0x0A);
    assert_eq!(mixed_encoded[56], 0x0D);

    // 2. Investigate cp1251.txt.
    let cp1251_path = dir.join("cp1251.txt");
    let cp1251_raw = fs::read(&cp1251_path).expect("read cp1251.txt failed");
    let cp1251_adapter = formats::adapter_for_path(&cp1251_path);
    let cp1251_decoded = cp1251_adapter
        .decode(&cp1251_raw)
        .expect("decode cp1251.txt failed");

    assert_eq!(cp1251_decoded.encoding, "windows-1251");
    assert_eq!(cp1251_decoded.line_ending, LineEnding::Crlf);

    let cp1251_encoded = cp1251_adapter
        .encode(&cp1251_decoded.text, &cp1251_decoded)
        .expect("encode cp1251.txt failed");

    // There must be no difference here.
    //
    // The test used to record a two-byte difference and blame line-ending
    // normalization. That explanation was wrong: the fixture itself contained
    // accidental sequences of two consecutive carriage returns. The file is
    // fixed, and valid CP1251 with CRLF must round-trip byte-for-byte—this is
    // the “byte-for-byte preservation” promise in docs/FORMATS.md.
    assert!(
        !cp1251_raw.windows(3).any(|w| w == [0x0D, 0x0D, 0x0A]),
        "the fixture contains a double carriage return again and is corrupted"
    );
    assert_eq!(
        cp1251_encoded, cp1251_raw,
        "CP1251 with CRLF must round-trip without a single changed byte"
    );
}

// =========================================================================
// 3. Edit text while preserving its encoding (CP1251)
// =========================================================================

#[test]
fn test_cp1251_editing_preserves_encoding_and_line_endings() {
    let dir = fixtures_dir();
    let original_path = dir.join("cp1251.txt");
    let raw_bytes = fs::read(&original_path).expect("read cp1251.txt failed");

    let adapter = formats::adapter_for_path(&original_path);
    let decoded = adapter
        .decode(&raw_bytes)
        .expect("decode cp1251.txt failed");

    assert_eq!(decoded.encoding, "windows-1251");
    assert_eq!(decoded.line_ending, LineEnding::Crlf);

    // Append a new line containing plain ASCII text.
    let appended_line = "New third line in plain text.\n";
    let edited_text = format!("{}{appended_line}", decoded.text);

    // Encode it again while preserving the source document metadata.
    let encoded = adapter
        .encode(&edited_text, &decoded)
        .expect("encode edited cp1251 failed");

    // Save to the real disk through write_atomic.
    let temp_dir = tempfile::tempdir().expect("tempdir failed");
    let target_file = temp_dir.path().join("saved_cp1251.txt");
    atomic_write::write_atomic(&target_file, &encoded).expect("write_atomic failed");

    // Read the saved file back from disk.
    let read_back_raw = fs::read(&target_file).expect("read back file failed");

    // Decode and verify that the file stayed CP1251 with CRLF rather than becoming UTF-8.
    let re_decoded = adapter
        .decode(&read_back_raw)
        .expect("re-decode file failed");
    assert_eq!(
        re_decoded.encoding, "windows-1251",
        "The file must remain Windows-1251 rather than silently becoming UTF-8"
    );
    assert_eq!(
        re_decoded.line_ending,
        LineEnding::Crlf,
        "Line endings must remain CRLF"
    );
    assert!(
        re_decoded.text.contains("New third line in plain text.\n"),
        "The appended line must be present in the text"
    );

    // Check the appended line's Windows-1251 bytes. Its first five bytes are
    // the single-byte ASCII sequence for "New t", not multibyte UTF-8.
    assert!(
        read_back_raw
            .windows(5)
            .any(|w| w == [0x4E, 0x65, 0x77, 0x20, 0x74]),
        "Disk bytes must use the single-byte CP1251 encoding, not multibyte UTF-8"
    );
}

// =========================================================================
// 4. Watcher and suppression of own writes
// =========================================================================

#[test]
fn test_watcher_suppress_prevents_self_loop_and_allows_external() {
    let app = tauri::Builder::default()
        .any_thread()
        .build(tauri::generate_context!())
        .expect("build test tauri app failed");
    let handle = app.handle().clone();

    let events = Arc::new(Mutex::new(Vec::new()));
    let events_clone = events.clone();

    handle.listen_any("file-changed-externally", move |event| {
        events_clone
            .lock()
            .unwrap()
            .push(event.payload().to_string());
    });

    let watcher = FileWatcher::new(handle.clone());
    let temp_dir = tempfile::tempdir().expect("tempdir failed");
    let watched_file = temp_dir.path().join("note_under_watch.md");
    fs::write(&watched_file, b"# Initial Header\n").expect("write initial failed");

    watcher.watch("main", &watched_file);

    // Brief pause to initialize the notify debouncer.
    std::thread::sleep(Duration::from_millis(300));

    // SCENARIO A: own write after suppression.
    watcher.suppress(&watched_file);
    atomic_write::write_atomic(&watched_file, b"# Modified by Self (Autosave)\n")
        .expect("atomic write failed");

    // Wait for the debounce interval (watcher.rs uses 200 ms).
    std::thread::sleep(Duration::from_millis(600));

    assert!(
        events.lock().unwrap().is_empty(),
        "A suppressed write must not emit file-changed-externally, but got: {:?}",
        events.lock().unwrap()
    );

    // SCENARIO B: external write without suppression (after the 1.5 s suppression window).
    std::thread::sleep(Duration::from_millis(1600));

    // An external program changes the file directly on disk.
    atomic_write::write_atomic(&watched_file, b"# Modified Externally\n")
        .expect("external write failed");

    // Wait for the notify debouncer.
    std::thread::sleep(Duration::from_millis(800));

    let captured = events.lock().unwrap().clone();
    assert!(
        !captured.is_empty(),
        "An external unsuppressed write must emit file-changed-externally"
    );
    assert!(
        captured[0].contains("note_under_watch.md"),
        "The event payload must contain the changed file name"
    );

    watcher.unwatch("main");
}

#[test]
fn test_watcher_keeps_two_paths_in_one_window() {
    let app = tauri::Builder::default()
        .any_thread()
        .build(tauri::generate_context!())
        .expect("build test tauri app failed");
    let handle = app.handle().clone();

    let events = Arc::new(Mutex::new(Vec::new()));
    let events_clone = events.clone();
    handle.listen_any("file-changed-externally", move |event| {
        events_clone
            .lock()
            .unwrap()
            .push(event.payload().to_string());
    });

    let watcher = FileWatcher::new(handle);
    let temp_dir = tempfile::tempdir().expect("tempdir failed");
    let first = temp_dir.path().join("first.md");
    let second = temp_dir.path().join("second.md");
    fs::write(&first, b"first\n").expect("write first failed");
    fs::write(&second, b"second\n").expect("write second failed");

    // Both files belong to the same native window, but must remain separate
    // logical watches.  This used to replace `first` with `second`.
    watcher.watch("main", &first);
    watcher.watch("main", &second);
    std::thread::sleep(Duration::from_millis(300));

    atomic_write::write_atomic(&first, b"first changed\n").expect("write first failed");
    atomic_write::write_atomic(&second, b"second changed\n").expect("write second failed");
    std::thread::sleep(Duration::from_millis(900));

    let captured = events.lock().unwrap().clone();
    assert!(
        captured.iter().any(|event| event.contains("first.md")),
        "the first file change must arrive as a separate event: {captured:?}"
    );
    assert!(
        captured.iter().any(|event| event.contains("second.md")),
        "the second file change must arrive as a separate event: {captured:?}"
    );

    watcher.unwatch("main");
}

// =========================================================================
// 5. Large file (big-10k.md)
// =========================================================================

#[test]
fn test_big_file_performance_and_round_trip() {
    let dir = fixtures_dir();
    let big_path = dir.join("big-10k.md");
    let raw_bytes = fs::read(&big_path).expect("read big-10k.md failed");

    assert!(
        raw_bytes.len() > 1_000_000,
        "big-10k.md should be about 1 MB, got {} bytes",
        raw_bytes.len()
    );

    let start = Instant::now();

    let adapter = formats::adapter_for_path(&big_path);
    let decoded = adapter
        .decode(&raw_bytes)
        .expect("decode big-10k.md failed");
    let decode_time = start.elapsed();

    let encode_start = Instant::now();
    let encoded = adapter
        .encode(&decoded.text, &decoded)
        .expect("encode big-10k.md failed");
    let encode_time = encode_start.elapsed();

    let temp_dir = tempfile::tempdir().expect("tempdir failed");
    let copy_path = temp_dir.path().join("big-10k-copy.md");

    let write_start = Instant::now();
    atomic_write::write_atomic(&copy_path, &encoded).expect("write big-10k copy failed");
    let write_time = write_start.elapsed();

    let total_time = start.elapsed();

    let disk_copy = fs::read(&copy_path).expect("read big copy failed");
    assert_eq!(raw_bytes, disk_copy, "Large-file bytes must match 100%");

    println!(
        "Large file ({} bytes): decode {:?}, encode {:?}, atomic write {:?}. Total: {:?}",
        raw_bytes.len(),
        decode_time,
        encode_time,
        write_time,
        total_time
    );

    // The full read, parse, encode, and disk-write cycle must take no more than 1.5 seconds.
    assert!(
        total_time < Duration::from_millis(1500),
        "Large-file operations must complete in a reasonable time, took: {:?}",
        total_time
    );
}
