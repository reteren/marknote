use std::{path::Path, time::Instant};

use marknote_lib::spellcheck::SpellcheckService;

#[test]
fn every_bundled_dictionary_is_a_parseable_hunspell_pair() {
    let dictionary_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("dictionaries");
    for tag in ["en", "ru", "de", "es", "fr", "it", "pt", "ar"] {
        let directory = dictionary_dir.join(tag);
        let aff = std::fs::read_to_string(directory.join("index.aff"))
            .unwrap_or_else(|error| panic!("could not read {tag} affix file: {error}"));
        let dic = std::fs::read_to_string(directory.join("index.dic"))
            .unwrap_or_else(|error| panic!("could not read {tag} word list: {error}"));
        spellbook::Dictionary::new(&aff, &dic)
            .unwrap_or_else(|error| panic!("could not parse {tag} dictionary: {error}"));
    }
}

#[test]
fn bundled_dictionaries_check_suggest_gate_scripts_and_meet_warm_performance_target() {
    let dictionary_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("dictionaries");
    let config_dir = tempfile::tempdir().expect("temporary config directory");
    let service = SpellcheckService::new(dictionary_dir, config_dir.path().to_owned());
    let english = vec!["en".to_owned()];
    let english_and_russian = vec!["en".to_owned(), "ru".to_owned()];

    let aple_errors = service.check("aple".to_owned(), english.clone());
    assert_eq!(aple_errors.len(), 1);
    assert_eq!((aple_errors[0].from, aple_errors[0].to), (0, 4));
    let english_suggestions = service.suggest("aple".to_owned(), english.clone(), 3);
    assert!(
        english_suggestions
            .iter()
            .any(|suggestion| suggestion == "apple"),
        "suggestions for aple: {english_suggestions:?}"
    );
    println!("Hunspell suggestions: aple -> {english_suggestions:?}");

    let russian_sentence =
        "\u{041f}\u{0440}\u{0438}\u{0432}\u{0435}\u{0442} \u{043c}\u{0438}\u{0440}";
    assert!(service
        .check(russian_sentence.to_owned(), english.clone())
        .is_empty());
    assert!(service
        .check(russian_sentence.to_owned(), english_and_russian.clone())
        .is_empty());

    let misspelled_banana = "\u{0431}\u{0430}\u{043d}\u{0430}\u{043d}\u{043d}";
    let banana = "\u{0431}\u{0430}\u{043d}\u{0430}\u{043d}";
    let russian_suggestions =
        service.suggest(misspelled_banana.to_owned(), vec!["ru".to_owned()], 3);
    assert_eq!(
        russian_suggestions.first().map(String::as_str),
        Some(banana)
    );
    println!("Hunspell suggestions: {misspelled_banana} -> {russian_suggestions:?}");

    let teh_suggestions = service.suggest("teh".to_owned(), english.clone(), 3);
    assert_eq!(teh_suggestions.first().map(String::as_str), Some("the"));
    println!("Hunspell suggestions: teh -> {teh_suggestions:?}");

    let english_words = vec!["the"; 100].join(" ");
    let russian_words = vec!["\u{043c}\u{0438}\u{0440}"; 100].join(" ");
    let paragraph = format!("{english_words} {russian_words}");
    let _ = service.check(paragraph.clone(), english_and_russian.clone());
    let started = Instant::now();
    let _ = service.check(paragraph, english_and_russian);
    let elapsed = started.elapsed();
    println!("Warm spellcheck: {elapsed:?} for a 200-word paragraph in en+ru.");
    assert!(elapsed.as_millis() < 50, "warm spellcheck took {elapsed:?}");
}
