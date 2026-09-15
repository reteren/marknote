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
// 1. Атомарность записи
// =========================================================================

#[test]
fn test_atomic_write_truncation_and_clean_directory() {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let target = dir.path().join("document.md");

    // Записываем длинный текст
    let long_text =
        b"This is a very long text occupying multiple blocks on disk and padding bytes...";
    atomic_write::write_atomic(&target, long_text).expect("initial write failed");

    let read_long = fs::read(&target).expect("read target failed");
    assert_eq!(read_long, long_text);

    // Записываем короткий текст поверх существующего длинного
    let short_text = b"Short";
    atomic_write::write_atomic(&target, short_text).expect("overwrite failed");

    let read_short = fs::read(&target).expect("read overwritten target failed");
    assert_eq!(
        read_short, short_text,
        "Файл должен содержать ровно новое содержимое без хвоста старого"
    );
    assert_eq!(read_short.len(), 5);

    // Серия последовательных атомарных записей
    for i in 0..15 {
        let content = format!("Revision {i} with payload: {}", "x".repeat(i * 100));
        atomic_write::write_atomic(&target, content.as_bytes())
            .unwrap_or_else(|e| panic!("write revision {i} failed: {e}"));
    }

    // Проверяем, что в папке лежит ровно один файл и нет мусорных временных файлов
    let mut files = Vec::new();
    for entry in fs::read_dir(dir.path()).expect("read_dir failed") {
        let entry = entry.expect("dir entry failed");
        let name = entry.file_name().to_string_lossy().into_owned();
        files.push(name);
    }

    assert_eq!(
        files.len(),
        1,
        "В каталоге должен остаться ровно один файл, но найдено: {:?}",
        files
    );
    assert_eq!(files[0], "document.md");
}

// =========================================================================
// 2. Круговой прогон через реестр форматов на файлах из fixtures/
// =========================================================================

#[test]
fn test_round_trip_clean_fixtures() {
    // Эталонные файлы без внутренних аномалий переводов строк должны совпадать байт в байт
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
            "{name}: неожиданная кодировка"
        );
        assert_eq!(
            decoded.line_ending, expected_eol,
            "{name}: неожиданный перевод строк"
        );
        assert_eq!(decoded.bom, expected_bom, "{name}: флаг BOM не совпадает");

        let encoded_bytes = adapter
            .encode(&decoded.text, &decoded)
            .unwrap_or_else(|e| panic!("encode {name} failed: {e}"));

        // Записываем во временную копию
        let copy_path = temp_dir.path().join(name);
        atomic_write::write_atomic(&copy_path, &encoded_bytes).expect("write copy failed");
        let disk_copy = fs::read(&copy_path).expect("read copy failed");

        assert_eq!(
            raw_bytes, disk_copy,
            "Байты {name} после кругового прогона и записи на диск должны совпадать на 100%"
        );
    }
}

#[test]
fn test_round_trip_investigation_mixed_eol_and_cp1251() {
    let dir = fixtures_dir();

    // 1. Исследование mixed-eol.md
    let mixed_path = dir.join("mixed-eol.md");
    let mixed_raw = fs::read(&mixed_path).expect("read mixed-eol.md failed");
    let mixed_adapter = formats::adapter_for_path(&mixed_path);
    let mixed_decoded = mixed_adapter
        .decode(&mixed_raw)
        .expect("decode mixed-eol.md failed");

    // mixed-eol.md содержит 2 строки CRLF и 2 строки LF.
    // По правилу большинства (crlf >= lf) выбирается CRLF.
    assert_eq!(mixed_decoded.line_ending, LineEnding::Crlf);

    let mixed_encoded = mixed_adapter
        .encode(&mixed_decoded.text, &mixed_decoded)
        .expect("encode mixed-eol.md failed");

    // Исходный файл: 67 байт. Закодированный файл: 69 байт (+2 байта за счёт нормализации двух LF в CRLF).
    assert_eq!(mixed_raw.len(), 67);
    assert_eq!(mixed_encoded.len(), 69);
    // Первое расхождение на байте 56 (0x38): исходный был LF (0x0A), стал CRLF (0x0D 0x0A).
    assert_eq!(mixed_raw[56], 0x0A);
    assert_eq!(mixed_encoded[56], 0x0D);

    // 2. Исследование cp1251.txt
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

    // Здесь расхождения быть НЕ должно.
    //
    // Раньше тест фиксировал расхождение в два байта и объяснял его
    // нормализацией переводов строк. Объяснение было неверным: в самой
    // фикстуре лежали случайно записанные последовательности из двух
    // возвратов каретки подряд. Файл исправлен, и корректный CP1251 с CRLF
    // обязан проходить круговой прогон байт в байт — это и есть обещание
    // «сохранение байт в байт» из docs/FORMATS.md.
    assert!(
        !cp1251_raw.windows(3).any(|w| w == [0x0D, 0x0D, 0x0A]),
        "в фикстуре снова появился двойной возврат каретки — она испорчена"
    );
    assert_eq!(
        cp1251_encoded, cp1251_raw,
        "CP1251 с CRLF обязан проходить круговой прогон без единого изменённого байта"
    );
}

// =========================================================================
// 3. Правка текста с сохранением кодировки (CP1251)
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

    // Дописываем новую строку на кириллице
    let appended_line = "Новая третья строка кириллицы.\n";
    let edited_text = format!("{}{appended_line}", decoded.text);

    // Кодируем обратно с сохранением метаданных исходного документа
    let encoded = adapter
        .encode(&edited_text, &decoded)
        .expect("encode edited cp1251 failed");

    // Сохраняем на настоящий диск через write_atomic
    let temp_dir = tempfile::tempdir().expect("tempdir failed");
    let target_file = temp_dir.path().join("saved_cp1251.txt");
    atomic_write::write_atomic(&target_file, &encoded).expect("write_atomic failed");

    // Читаем сохранённый файл обратно с диска
    let read_back_raw = fs::read(&target_file).expect("read back file failed");

    // Декодируем и проверяем: файл остался в CP1251, с CRLF, а не стал UTF-8
    let re_decoded = adapter
        .decode(&read_back_raw)
        .expect("re-decode file failed");
    assert_eq!(
        re_decoded.encoding, "windows-1251",
        "Файл обязан сохраниться в Windows-1251, а не молча стать UTF-8"
    );
    assert_eq!(
        re_decoded.line_ending,
        LineEnding::Crlf,
        "Переводы строк обязаны остаться CRLF"
    );
    assert!(
        re_decoded.text.contains("Новая третья строка кириллицы.\n"),
        "Добавленная кириллическая строка должна корректно присутствовать в тексте"
    );

    // Проверяем байты добавленной строки в Windows-1251:
    // 'Н' в CP1251 = 0xCD, 'о' = 0xEE, 'в' = 0xE2, 'а' = 0xE0, 'я' = 0xFF
    assert!(
        read_back_raw
            .windows(5)
            .any(|w| w == [0xCD, 0xEE, 0xE2, 0xE0, 0xFF]),
        "Байты на диске должны быть в однобайтовой кодировке CP1251, а не многобайтовым UTF-8"
    );
}

// =========================================================================
// 4. Наблюдатель и подавление собственных записей
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

    // Небольшая пауза для инициализации дебаунсера notify
    std::thread::sleep(Duration::from_millis(300));

    // СЦЕНАРИЙ А: Собственная запись с предварительным suppress
    watcher.suppress(&watched_file);
    atomic_write::write_atomic(&watched_file, b"# Modified by Self (Autosave)\n")
        .expect("atomic write failed");

    // Ждём время дебаунса (в watcher.rs дебаунс равен 200 мс)
    std::thread::sleep(Duration::from_millis(600));

    assert!(
        events.lock().unwrap().is_empty(),
        "Запись после suppress не должна вызывать событие file-changed-externally, но получено: {:?}",
        events.lock().unwrap()
    );

    // СЦЕНАРИЙ Б: Посторонняя запись без suppress (после истечения 1.5 с окна подавления)
    std::thread::sleep(Duration::from_millis(1600));

    // Внешняя программа напрямую меняет файл на диске
    atomic_write::write_atomic(&watched_file, b"# Modified Externally\n")
        .expect("external write failed");

    // Ждём срабатывания дебаунсера notify
    std::thread::sleep(Duration::from_millis(800));

    let captured = events.lock().unwrap().clone();
    assert!(
        !captured.is_empty(),
        "Посторонняя запись без suppress обязана вызвать событие file-changed-externally"
    );
    assert!(
        captured[0].contains("note_under_watch.md"),
        "Payload события должен содержать имя изменённого файла"
    );

    watcher.unwatch("main");
}

// =========================================================================
// 5. Большой файл (big-10k.md)
// =========================================================================

#[test]
fn test_big_file_performance_and_round_trip() {
    let dir = fixtures_dir();
    let big_path = dir.join("big-10k.md");
    let raw_bytes = fs::read(&big_path).expect("read big-10k.md failed");

    assert!(
        raw_bytes.len() > 1_000_000,
        "big-10k.md должен быть размером около 1 МБ, получено {} байт",
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
    assert_eq!(
        raw_bytes, disk_copy,
        "Байты большого файла должны совпадать на 100%"
    );

    println!(
        "Большой файл ({} байт): декодирование {:?}, кодирование {:?}, атомарная запись {:?}. Всего: {:?}",
        raw_bytes.len(),
        decode_time,
        encode_time,
        write_time,
        total_time
    );

    // Весь цикл чтения, разбора, кодирования и записи на диск должен занимать не более 1.5 секунды
    assert!(
        total_time < Duration::from_millis(1500),
        "Операции с большим файлом должны укладываться в разумное время, затрачено: {:?}",
        total_time
    );
}
