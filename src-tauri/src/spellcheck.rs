use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

use serde::Serialize;

use crate::atomic_write;

const DICTIONARY_TAGS: [&str; 8] = ["en", "ru", "de", "es", "fr", "it", "pt", "ar"];
const USER_WORDS_FILE: &str = "spelling-user-words.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellLanguage {
    pub tag: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Misspelling {
    pub from: u32,
    pub to: u32,
}

#[derive(Clone)]
pub struct SpellcheckService {
    inner: Arc<Mutex<DictionaryService>>,
}

impl SpellcheckService {
    /// Creates a lazy spellcheck service rooted at the packaged dictionaries.
    /// Dictionary files are read only after the first check or suggestion request.
    pub fn new(dictionary_dir: PathBuf, config_dir: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(DictionaryService::new(
                dictionary_dir,
                config_dir,
            ))),
        }
    }

    pub fn languages(&self) -> Vec<SpellLanguage> {
        DICTIONARY_TAGS
            .iter()
            .map(|tag| SpellLanguage {
                tag: (*tag).to_owned(),
                name: native_language_name(tag),
            })
            .collect()
    }

    pub fn check(&self, text: String, languages: Vec<String>) -> Vec<Misspelling> {
        lock_service(&self.inner).check(&text, &languages)
    }

    pub fn suggest(&self, word: String, languages: Vec<String>, limit: u32) -> Vec<String> {
        lock_service(&self.inner).suggest(&word, &languages, limit)
    }

    pub fn add_word(&self, word: String, languages: Vec<String>) {
        lock_service(&self.inner).add_word(&word, &languages);
    }
}

fn lock_service(service: &Mutex<DictionaryService>) -> MutexGuard<'_, DictionaryService> {
    service
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn native_language_name(tag: &str) -> String {
    match tag {
        "en" => "English".to_owned(),
        "ru" => "\u{0420}\u{0443}\u{0441}\u{0441}\u{043a}\u{0438}\u{0439}".to_owned(),
        "de" => "Deutsch".to_owned(),
        "es" => "Espa\u{00f1}ol".to_owned(),
        "fr" => "Fran\u{00e7}ais".to_owned(),
        "it" => "Italiano".to_owned(),
        "pt" => "Portugu\u{00ea}s".to_owned(),
        "ar" => "\u{0627}\u{0644}\u{0639}\u{0631}\u{0628}\u{064a}\u{0629}".to_owned(),
        _ => tag.to_owned(),
    }
}

struct DictionaryService {
    dictionary_dir: PathBuf,
    config_dir: PathBuf,
    dictionaries: HashMap<&'static str, spellbook::Dictionary>,
    failed_loads: HashSet<&'static str>,
}

impl DictionaryService {
    fn new(dictionary_dir: PathBuf, config_dir: PathBuf) -> Self {
        Self {
            dictionary_dir,
            config_dir,
            dictionaries: HashMap::new(),
            failed_loads: HashSet::new(),
        }
    }

    fn check(&mut self, text: &str, languages: &[String]) -> Vec<Misspelling> {
        let tokens = tokenize(text);
        let mut result = Vec::new();
        if tokens.is_empty() {
            return result;
        }

        let mut selected_by_script: HashMap<Script, Vec<&'static str>> = HashMap::new();
        for token in &tokens {
            let script = script_of_text(token.text);
            if script == Script::Other || selected_by_script.contains_key(&script) {
                continue;
            }
            let selected = selected_languages(languages, script);
            for tag in &selected {
                self.ensure_dictionary_loaded(tag);
            }
            selected_by_script.insert(script, selected);
        }

        for token in tokens {
            let script = script_of_text(token.text);
            let Some(tags) = selected_by_script.get(&script) else {
                continue;
            };
            if tags.is_empty() {
                continue;
            }
            let loaded_tags = tags
                .iter()
                .filter(|tag| self.dictionaries.contains_key(*tag));
            let loaded_tags: Vec<_> = loaded_tags.copied().collect();
            if loaded_tags.is_empty() {
                continue;
            }
            let is_correct = loaded_tags.iter().any(|tag| {
                self.dictionaries
                    .get(tag)
                    .is_some_and(|dictionary| dictionary_accepts(dictionary, token.text))
            });
            if !is_correct {
                result.push(Misspelling {
                    from: token.from,
                    to: token.to,
                });
            }
        }

        result
    }

    fn suggest(&mut self, word: &str, languages: &[String], limit: u32) -> Vec<String> {
        let script = script_of_text(word);
        if script == Script::Other || limit == 0 {
            return Vec::new();
        }
        let tags = selected_languages(languages, script);
        for tag in &tags {
            self.ensure_dictionary_loaded(tag);
        }

        let mut generated = Vec::new();
        let mut hunspell = Vec::new();
        for tag in tags {
            if let Some(dictionary) = self.dictionaries.get(tag) {
                let mut suggestions = Vec::new();
                dictionary.suggest(word, &mut suggestions);
                hunspell.extend(suggestions);
                generated.extend(nearby_dictionary_words(dictionary, word, script));
            }
        }
        generated.extend(hunspell);
        filter_suggestions(word, generated, limit)
    }

    fn add_word(&mut self, word: &str, languages: &[String]) {
        let selected = selected_languages_any_script(languages);
        let Some(target) =
            preferred_language(word, &selected).or_else(|| selected.first().copied())
        else {
            return;
        };

        let mut user_words = self.read_user_words();
        let words_for_language = user_words.entry(target.to_owned()).or_default();
        if !words_for_language
            .iter()
            .any(|existing| existing.to_lowercase() == word.to_lowercase())
        {
            words_for_language.push(word.to_owned());
            if let Err(error) = self.write_user_words(&user_words) {
                eprintln!("Could not save spelling user word: {error}");
                return;
            }
        }

        self.ensure_dictionary_loaded(target);
        if let Some(dictionary) = self.dictionaries.get_mut(target) {
            if let Err(error) = dictionary.add(word) {
                eprintln!("Could not add spelling user word to the dictionary: {error}");
            }
        }
    }

    fn ensure_dictionary_loaded(&mut self, tag: &'static str) {
        if self.dictionaries.contains_key(tag) || self.failed_loads.contains(tag) {
            return;
        }
        let directory = self.dictionary_dir.join(tag);
        let loaded = (|| {
            let aff = fs::read_to_string(directory.join("index.aff"))?;
            let dic = fs::read_to_string(directory.join("index.dic"))?;
            let mut dictionary = spellbook::Dictionary::new(&aff, &dic)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            if let Some(words) = self.read_user_words().get(tag) {
                for word in words {
                    if let Err(error) = dictionary.add(word) {
                        eprintln!("Could not load spelling user word: {error}");
                    }
                }
            }
            Ok::<_, std::io::Error>(dictionary)
        })();

        match loaded {
            Ok(dictionary) => {
                self.dictionaries.insert(tag, dictionary);
            }
            Err(error) => {
                eprintln!("Could not load bundled spelling dictionary {tag}: {error}");
                self.failed_loads.insert(tag);
            }
        }
    }

    fn user_words_path(&self) -> PathBuf {
        self.config_dir.join(USER_WORDS_FILE)
    }

    fn read_user_words(&self) -> HashMap<String, Vec<String>> {
        let path = self.user_words_path();
        match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(words) => words,
                Err(error) => {
                    eprintln!(
                        "Could not parse spelling user words at {}: {error}",
                        path.display()
                    );
                    HashMap::new()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => {
                eprintln!(
                    "Could not read spelling user words at {}: {error}",
                    path.display()
                );
                HashMap::new()
            }
        }
    }

    fn write_user_words(&self, words: &HashMap<String, Vec<String>>) -> anyhow::Result<()> {
        fs::create_dir_all(&self.config_dir)?;
        let mut bytes = serde_json::to_vec_pretty(words)?;
        bytes.push(b'\n');
        atomic_write::write_atomic(&self.user_words_path(), &bytes)
    }
}

fn dictionary_accepts(dictionary: &spellbook::Dictionary, word: &str) -> bool {
    case_variants(word)
        .iter()
        .any(|variant| dictionary.check(variant))
}

fn case_variants(word: &str) -> Vec<String> {
    let mut variants = vec![word.to_owned()];
    let letters: Vec<char> = word
        .chars()
        .filter(|character| character.is_alphabetic())
        .collect();
    if letters.is_empty() {
        return variants;
    }

    if letters.iter().all(|character| character.is_lowercase()) {
        let lower = word.to_lowercase();
        let mut title = String::new();
        let mut first_letter = true;
        for character in lower.chars() {
            if character.is_alphabetic() && first_letter {
                title.extend(character.to_uppercase());
                first_letter = false;
            } else {
                title.push(character);
            }
        }
        variants.push(title);
        variants.push(word.to_uppercase());
    } else if letters[0].is_uppercase()
        && letters
            .iter()
            .skip(1)
            .all(|character| character.is_lowercase())
    {
        variants.push(word.to_lowercase());
    }

    variants
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Script {
    Latin,
    Cyrillic,
    Arabic,
    Other,
}

fn script_of_text(text: &str) -> Script {
    let mut found = Script::Other;
    for character in text.chars() {
        let current = script_of_char(character);
        if current == Script::Other {
            continue;
        }
        if found != Script::Other && found != current {
            return Script::Other;
        }
        found = current;
    }
    found
}

fn script_of_char(character: char) -> Script {
    let code = character as u32;
    match code {
        0x0041..=0x024f | 0x1e00..=0x1eff | 0x2c60..=0x2c7f | 0xa720..=0xa7ff | 0xab30..=0xab6f => {
            Script::Latin
        }
        0x0400..=0x052f | 0x1c80..=0x1c8f | 0x2de0..=0x2dff | 0xa640..=0xa69f => Script::Cyrillic,
        0x0600..=0x06ff | 0x0750..=0x077f | 0x08a0..=0x08ff | 0xfb50..=0xfdff | 0xfe70..=0xfeff => {
            Script::Arabic
        }
        _ => Script::Other,
    }
}

fn canonical_language_tag(tag: &str) -> Option<&'static str> {
    let base = tag
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    DICTIONARY_TAGS
        .iter()
        .copied()
        .find(|candidate| *candidate == base)
}

fn script_for_language(tag: &str) -> Script {
    match canonical_language_tag(tag) {
        Some("ru") => Script::Cyrillic,
        Some("ar") => Script::Arabic,
        Some("en" | "de" | "es" | "fr" | "it" | "pt") => Script::Latin,
        _ => Script::Other,
    }
}

fn selected_languages(languages: &[String], script: Script) -> Vec<&'static str> {
    selected_languages_any_script(languages)
        .into_iter()
        .filter(|tag| script_for_language(tag) == script)
        .collect()
}

fn selected_languages_any_script(languages: &[String]) -> Vec<&'static str> {
    let mut seen = HashSet::new();
    languages
        .iter()
        .filter_map(|language| canonical_language_tag(language))
        .filter(|tag| seen.insert(*tag))
        .collect()
}

fn preferred_language(word: &str, languages: &[&'static str]) -> Option<&'static str> {
    let script = script_of_text(word);
    languages
        .iter()
        .copied()
        .find(|language| script != Script::Other && script_for_language(language) == script)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Token<'a> {
    text: &'a str,
    from: u32,
    to: u32,
}

fn tokenize(text: &str) -> Vec<Token<'_>> {
    let mut utf16_offset = 0usize;
    let chars: Vec<(usize, usize, char)> = text
        .char_indices()
        .map(|(byte_offset, character)| {
            let current_utf16 = utf16_offset;
            utf16_offset += character.len_utf16();
            (byte_offset, current_utf16, character)
        })
        .collect();
    let mut result = Vec::new();
    let mut index = 0usize;

    while index < chars.len() {
        if !is_token_letter_or_number(chars[index].2) {
            index += 1;
            continue;
        }

        let start = index;
        index += 1;
        while index < chars.len() {
            let character = chars[index].2;
            if is_token_letter_or_number(character) || is_combining_mark(character) {
                index += 1;
                continue;
            }
            if is_word_joiner(character)
                && index > start
                && index + 1 < chars.len()
                && is_token_letter_or_number(chars[index - 1].2)
                && is_token_letter_or_number(chars[index + 1].2)
            {
                index += 1;
                continue;
            }
            break;
        }

        let byte_start = chars[start].0;
        let byte_end = chars
            .get(index)
            .map_or(text.len(), |(byte_offset, _, _)| *byte_offset);
        let candidate = &text[byte_start..byte_end];
        if candidate.chars().any(char::is_numeric)
            || !candidate.chars().any(char::is_alphabetic)
            || is_short_all_caps(candidate)
            || looks_like_url_email_or_path(text, byte_start, byte_end)
        {
            continue;
        }

        let utf16_start = chars[start].1;
        let utf16_end = chars
            .get(index)
            .map_or(utf16_offset, |(_, offset, _)| *offset);
        result.push(Token {
            text: candidate,
            from: u32::try_from(utf16_start).unwrap_or(u32::MAX),
            to: u32::try_from(utf16_end).unwrap_or(u32::MAX),
        });
    }

    result
}

fn is_token_letter_or_number(character: char) -> bool {
    character.is_alphanumeric()
}

fn is_word_joiner(character: char) -> bool {
    matches!(character, '\'' | '\u{2019}' | '-' | '\u{2010}' | '\u{2011}')
}

fn is_combining_mark(character: char) -> bool {
    matches!(character as u32,
        0x0300..=0x036f | 0x0483..=0x0489 | 0x0591..=0x05bd | 0x05bf..=0x05c7
        | 0x0610..=0x061a | 0x064b..=0x065f | 0x0670 | 0x06d6..=0x06ed
        | 0x1ab0..=0x1aff | 0x1dc0..=0x1dff | 0x20d0..=0x20ff | 0xfe20..=0xfe2f)
}

fn is_short_all_caps(word: &str) -> bool {
    let letters: Vec<char> = word
        .chars()
        .filter(|character| character.is_alphabetic())
        .collect();
    !letters.is_empty()
        && letters.len() <= 5
        && letters.iter().all(|character| character.is_uppercase())
}

fn looks_like_url_email_or_path(text: &str, byte_start: usize, byte_end: usize) -> bool {
    let segment_start = text[..byte_start]
        .char_indices()
        .rev()
        .find_map(|(offset, character)| {
            character
                .is_whitespace()
                .then_some(offset + character.len_utf8())
        })
        .unwrap_or(0);
    let segment_end = text[byte_end..]
        .char_indices()
        .find_map(|(offset, character)| character.is_whitespace().then_some(byte_end + offset))
        .unwrap_or(text.len());
    let segment = &text[segment_start..segment_end];
    let lower_segment = segment.to_ascii_lowercase();
    segment.contains('@')
        || segment.contains('/')
        || segment.contains('\\')
        || segment.contains("://")
        || lower_segment.starts_with("www.")
        || segment.contains('_')
        || has_dot_between_letters(segment)
}

fn has_dot_between_letters(text: &str) -> bool {
    let characters: Vec<char> = text.chars().collect();
    characters.windows(3).any(|window| {
        window[0].is_alphanumeric() && window[1] == '.' && window[2].is_alphanumeric()
    })
}

fn filter_suggestions(word: &str, suggestions: Vec<String>, limit: u32) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }
    let word_script = script_of_text(word);
    if word_script == Script::Other {
        return Vec::new();
    }

    let best_distance = suggestions
        .iter()
        .filter(|suggestion| script_of_text(suggestion) == word_script)
        .map(|suggestion| damerau_levenshtein(word, suggestion))
        .min();
    let Some(best_distance) = best_distance else {
        return Vec::new();
    };

    let letter_count = word
        .chars()
        .filter(|character| character.is_alphabetic())
        .count();
    let threshold = (best_distance + usize::from(letter_count >= 7)).min(3);
    let mut seen = HashSet::new();
    suggestions
        .into_iter()
        .filter_map(|suggestion| {
            if script_of_text(&suggestion) != word_script
                || damerau_levenshtein(word, &suggestion) > threshold
            {
                return None;
            }
            let suggestion = preserve_capitalization(word, &suggestion);
            seen.insert(suggestion.to_lowercase()).then_some(suggestion)
        })
        .take(limit.min(3) as usize)
        .collect()
}

fn nearby_dictionary_words(
    dictionary: &spellbook::Dictionary,
    word: &str,
    script: Script,
) -> Vec<String> {
    let alphabet: Vec<char> = match script {
        Script::Latin => "abcdefghijklmnopqrstuvwxyz".chars().collect(),
        Script::Cyrillic => (0x0430..=0x044f)
            .filter_map(char::from_u32)
            .chain(std::iter::once('\u{0451}'))
            .collect(),
        Script::Arabic => (0x0621..=0x064a).filter_map(char::from_u32).collect(),
        Script::Other => return Vec::new(),
    };
    let characters: Vec<char> = word.chars().collect();
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for index in 1..characters.len() {
        if characters[index] == characters[index - 1] {
            let mut deletion = characters.clone();
            deletion.remove(index);
            push_accepted_candidate(
                dictionary,
                word,
                deletion.into_iter().collect(),
                &mut seen,
                &mut candidates,
            );
        }
    }
    for index in 0..characters.len().saturating_sub(1) {
        let mut transposition = characters.clone();
        transposition.swap(index, index + 1);
        push_accepted_candidate(
            dictionary,
            word,
            transposition.into_iter().collect(),
            &mut seen,
            &mut candidates,
        );
    }
    for index in 0..=characters.len() {
        for letter in &alphabet {
            let repeats_neighbor = characters.get(index.wrapping_sub(1)) == Some(letter)
                || characters.get(index) == Some(letter);
            if repeats_neighbor {
                let mut insertion = characters.clone();
                insertion.insert(index, *letter);
                push_accepted_candidate(
                    dictionary,
                    word,
                    insertion.into_iter().collect(),
                    &mut seen,
                    &mut candidates,
                );
            }
        }
    }
    for index in 0..=characters.len() {
        for letter in &alphabet {
            if characters.get(index.wrapping_sub(1)) == Some(letter)
                || characters.get(index) == Some(letter)
            {
                continue;
            }
            let mut insertion = characters.clone();
            insertion.insert(index, *letter);
            push_accepted_candidate(
                dictionary,
                word,
                insertion.into_iter().collect(),
                &mut seen,
                &mut candidates,
            );
        }
    }
    for index in 0..characters.len() {
        if index > 0 && characters[index] == characters[index - 1] {
            continue;
        }
        let mut deletion = characters.clone();
        deletion.remove(index);
        push_accepted_candidate(
            dictionary,
            word,
            deletion.into_iter().collect(),
            &mut seen,
            &mut candidates,
        );
    }
    for index in 0..characters.len() {
        for letter in &alphabet {
            if characters[index].eq_ignore_ascii_case(letter) {
                continue;
            }
            let mut substitution = characters.clone();
            substitution[index] = *letter;
            push_accepted_candidate(
                dictionary,
                word,
                substitution.into_iter().collect(),
                &mut seen,
                &mut candidates,
            );
        }
    }

    candidates
}

fn push_accepted_candidate(
    dictionary: &spellbook::Dictionary,
    original_word: &str,
    candidate: String,
    seen: &mut HashSet<String>,
    output: &mut Vec<String>,
) {
    if candidate == original_word || !seen.insert(candidate.to_lowercase()) {
        return;
    }
    if dictionary_accepts(dictionary, &candidate) {
        output.push(candidate);
    }
}

fn preserve_capitalization(word: &str, candidate: &str) -> String {
    let letters: Vec<char> = word
        .chars()
        .filter(|character| character.is_alphabetic())
        .collect();
    if letters.is_empty() {
        return candidate.to_owned();
    }
    if letters.iter().all(|character| character.is_uppercase()) {
        return candidate.to_uppercase();
    }
    if letters.iter().all(|character| character.is_lowercase()) {
        return candidate.to_lowercase();
    }
    if letters[0].is_uppercase()
        && letters
            .iter()
            .skip(1)
            .all(|character| character.is_lowercase())
    {
        let mut chars = candidate.to_lowercase().chars().collect::<Vec<_>>();
        if let Some(first_index) = chars.iter().position(|character| character.is_alphabetic()) {
            let uppercase = chars[first_index].to_uppercase().collect::<Vec<_>>();
            if uppercase.len() == 1 {
                chars[first_index] = uppercase[0];
                return chars.into_iter().collect();
            }
            chars.splice(first_index..=first_index, uppercase);
            return chars.into_iter().collect();
        }
        return chars.into_iter().collect();
    }

    let mut source_cases = letters.iter();
    candidate
        .chars()
        .map(|character| {
            if !character.is_alphabetic() {
                character.to_string()
            } else if source_cases
                .next()
                .is_some_and(|source| source.is_uppercase())
            {
                character.to_uppercase().collect()
            } else {
                character.to_lowercase().collect()
            }
        })
        .collect()
}

fn damerau_levenshtein(left: &str, right: &str) -> usize {
    let left: Vec<char> = left.to_lowercase().chars().collect();
    let right: Vec<char> = right.to_lowercase().chars().collect();
    let rows = left.len() + 2;
    let columns = right.len() + 2;
    let infinity = left.len() + right.len();
    let mut matrix = vec![0usize; rows * columns];
    let index = |row: usize, column: usize| row * columns + column;
    matrix[index(0, 0)] = infinity;
    for row in 0..=left.len() {
        matrix[index(row + 1, 0)] = infinity;
        matrix[index(row + 1, 1)] = row;
    }
    for column in 0..=right.len() {
        matrix[index(0, column + 1)] = infinity;
        matrix[index(1, column + 1)] = column;
    }

    let mut last_seen = HashMap::new();
    for (left_index, left_character) in left.iter().enumerate() {
        let row = left_index + 1;
        let mut last_match_column = 0usize;
        for (right_index, right_character) in right.iter().enumerate() {
            let column = right_index + 1;
            let matching_row = last_seen.get(right_character).copied().unwrap_or(0usize);
            let matching_column = last_match_column;
            let substitution_cost = if left_character == right_character {
                last_match_column = column;
                0
            } else {
                1
            };

            let substitution = matrix[index(row, column)] + substitution_cost;
            let insertion = matrix[index(row + 1, column)] + 1;
            let deletion = matrix[index(row, column + 1)] + 1;
            let transposition = matrix[index(matching_row, matching_column)]
                + (row - matching_row - 1)
                + 1
                + (column - matching_column - 1);
            matrix[index(row + 1, column + 1)] =
                substitution.min(insertion).min(deletion).min(transposition);
        }
        last_seen.insert(*left_character, row);
    }
    matrix[index(left.len() + 1, right.len() + 1)]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn bundled_languages_are_returned_in_contract_order_with_native_names() {
        let service = SpellcheckService::new(PathBuf::new(), PathBuf::new());
        let languages = service.languages();
        assert_eq!(
            languages
                .iter()
                .map(|language| language.tag.as_str())
                .collect::<Vec<_>>(),
            DICTIONARY_TAGS
        );
        assert_eq!(languages[0].name, "English");
        assert_eq!(
            languages[1].name,
            "\u{0420}\u{0443}\u{0441}\u{0441}\u{043a}\u{0438}\u{0439}"
        );
        assert_eq!(
            languages[7].name,
            "\u{0627}\u{0644}\u{0639}\u{0631}\u{0628}\u{064a}\u{0629}"
        );
    }

    #[test]
    fn tokenizer_skips_digits_acronyms_urls_emails_and_paths_and_uses_utf16_offsets() {
        let text = "\u{1f600} aple light-weight can't ab12 API URL https://example.com/test foo@example.com C:\\users\\name";
        let tokens = tokenize(text);
        let words: Vec<&str> = tokens.iter().map(|token| token.text).collect();
        assert_eq!(words, ["aple", "light-weight", "can't"]);
        assert_eq!((tokens[0].from, tokens[0].to), (3, 7));
        assert_eq!(tokens[1].text, "light-weight");
    }

    #[test]
    fn tokenizer_keeps_diacritics_and_internal_word_joiners() {
        let tokens = tokenize("na\u{00ef}ve rock\u{2019}n\u{2019}roll state-of-the-art");
        assert_eq!(
            tokens.iter().map(|token| token.text).collect::<Vec<_>>(),
            [
                "na\u{00ef}ve",
                "rock\u{2019}n\u{2019}roll",
                "state-of-the-art"
            ]
        );
    }

    #[test]
    fn script_gating_uses_only_languages_that_cover_the_word() {
        let english = vec!["en".to_owned()];
        let english_and_russian = vec!["en-US".to_owned(), "ru-RU".to_owned()];
        let russian = "\u{041f}\u{0440}\u{0438}\u{0432}\u{0435}\u{0442}";
        assert!(selected_languages(&english, script_of_text(russian)).is_empty());
        assert_eq!(
            selected_languages(&english_and_russian, script_of_text(russian)),
            ["ru"]
        );
        assert_eq!(selected_languages(&english, script_of_text("aple")), ["en"]);
        assert!(!has_supported_script("123", &english));
        assert!(!has_supported_script("!!!", &english));
    }

    fn has_supported_script(word: &str, languages: &[String]) -> bool {
        let script = script_of_text(word);
        script != Script::Other && !selected_languages(languages, script).is_empty()
    }

    #[test]
    fn case_variants_accept_capitalized_and_sentence_initial_forms() {
        assert!(case_variants("jesus").contains(&"Jesus".to_owned()));
        assert!(case_variants("jesus").contains(&"JESUS".to_owned()));
        assert!(case_variants("Monday").contains(&"monday".to_owned()));
        assert!(case_variants("London").contains(&"london".to_owned()));
        assert!(!case_variants("aple").contains(&"apple".to_owned()));
    }

    #[test]
    fn suggestions_are_distance_filtered_ordered_deduplicated_and_case_preserving() {
        assert_eq!(
            filter_suggestions(
                "aple",
                vec!["apple".to_owned(), "apply".to_owned(), "APPLE".to_owned()],
                3,
            ),
            ["apple"]
        );
        assert_eq!(
            filter_suggestions("Aple", vec!["apple".to_owned()], 3),
            ["Apple"]
        );
        assert_eq!(
            filter_suggestions("teh", vec!["the".to_owned(), "their".to_owned()], 3),
            ["the"]
        );
        assert_eq!(damerau_levenshtein("teh", "the"), 1);
        assert_eq!(damerau_levenshtein("CAFE", "cafe"), 0);
    }

    #[test]
    fn suggestions_reject_other_scripts_and_obey_the_upper_bound() {
        let word = "\u{0431}\u{0430}\u{043d}\u{0430}\u{043d}\u{043d}";
        let banana = "\u{0431}\u{0430}\u{043d}\u{0430}\u{043d}";
        let filtered = filter_suggestions(
            word,
            vec![
                "banana".to_owned(),
                banana.to_owned(),
                banana.to_uppercase(),
            ],
            1,
        );
        assert_eq!(filtered, [banana]);
        assert!(filter_suggestions("aple", vec!["apple".to_owned()], 0).is_empty());
    }

    #[test]
    fn user_words_load_into_dictionary_and_persist_by_language() {
        let dictionary_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("dictionaries");
        let config_dir = tempfile::tempdir().expect("temporary config directory");
        let service = SpellcheckService::new(dictionary_dir, config_dir.path().to_owned());
        let word = "marknoteunlistedword";
        assert_eq!(
            service.check(word.to_owned(), vec!["en".to_owned()]).len(),
            1
        );
        service.add_word(word.to_owned(), vec!["en".to_owned()]);
        assert!(service
            .check(word.to_owned(), vec!["en".to_owned()])
            .is_empty());
        let saved: HashMap<String, Vec<String>> = serde_json::from_slice(
            &fs::read(config_dir.path().join(USER_WORDS_FILE)).expect("read saved user words"),
        )
        .expect("parse saved user words");
        assert_eq!(saved["en"], [word]);

        let restarted = SpellcheckService::new(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("dictionaries"),
            config_dir.path().to_owned(),
        );
        assert!(restarted
            .check(word.to_owned(), vec!["en".to_owned()])
            .is_empty());
    }

    #[test]
    fn full_damerau_levenshtein_handles_unrestricted_transpositions() {
        assert_eq!(damerau_levenshtein("CA", "ABC"), 2);
        assert_eq!(damerau_levenshtein("abcd", "badc"), 2);
    }
}
