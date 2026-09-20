#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Debug, Clone)]
pub struct Decoded {
    pub text: String,
    pub encoding: String,
    pub bom: bool,
    pub line_ending: LineEnding,
}

pub fn decode(bytes: &[u8]) -> Decoded {
    #[cfg(not(test))]
    crate::startup_trace::mark("encoding-detect-start");
    let (encoding, bom, payload) = if bytes.is_empty() {
        (encoding_rs::UTF_8, false, bytes)
    } else if bytes.starts_with(b"\xEF\xBB\xBF") {
        (encoding_rs::UTF_8, true, &bytes[3..])
    } else if bytes.starts_with(b"\xFF\xFE") {
        (encoding_rs::UTF_16LE, true, &bytes[2..])
    } else if bytes.starts_with(b"\xFE\xFF") {
        (encoding_rs::UTF_16BE, true, &bytes[2..])
    } else {
        let mut detector = chardetng::EncodingDetector::new();
        detector.feed(bytes, true);
        (detector.guess(None, true), false, bytes)
    };
    #[cfg(not(test))]
    crate::startup_trace::mark("encoding-detected");

    let (decoded, _) = encoding.decode_without_bom_handling(payload);
    let text = decoded.into_owned();
    #[cfg(not(test))]
    crate::startup_trace::mark("encoding-decoded");
    let line_ending = detect_line_ending(&text);

    Decoded {
        text: normalize_line_endings(&text),
        encoding: encoding.name().to_ascii_lowercase(),
        bom,
        line_ending,
    }
}

pub fn encode(text: &str, encoding: &str, bom: bool, line_ending: LineEnding) -> Vec<u8> {
    let normalized = normalize_line_endings(text);
    let with_line_endings = match line_ending {
        LineEnding::Lf => normalized,
        LineEnding::Crlf => normalized.replace('\n', "\r\n"),
    };

    let normalized_encoding = encoding.trim().to_ascii_lowercase();
    let mut result = Vec::new();

    match normalized_encoding.as_str() {
        "utf-16le" | "utf16le" => {
            if bom {
                result.extend_from_slice(b"\xFF\xFE");
            }
            for unit in with_line_endings.encode_utf16() {
                result.extend_from_slice(&unit.to_le_bytes());
            }
        }
        "utf-16be" | "utf16be" => {
            if bom {
                result.extend_from_slice(b"\xFE\xFF");
            }
            for unit in with_line_endings.encode_utf16() {
                result.extend_from_slice(&unit.to_be_bytes());
            }
        }
        "utf-8" | "utf8" => {
            if bom {
                result.extend_from_slice(b"\xEF\xBB\xBF");
            }
            result.extend_from_slice(with_line_endings.as_bytes());
        }
        _ => {
            let encoding = encoding_rs::Encoding::for_label(normalized_encoding.as_bytes())
                .unwrap_or(encoding_rs::UTF_8);
            if bom && encoding == encoding_rs::UTF_8 {
                result.extend_from_slice(b"\xEF\xBB\xBF");
            }
            let (encoded, _, _) = encoding.encode(&with_line_endings);
            result.extend_from_slice(&encoded);
        }
    }

    result
}

fn detect_line_ending(text: &str) -> LineEnding {
    let bytes = text.as_bytes();
    let crlf = bytes.windows(2).filter(|pair| *pair == b"\r\n").count();
    let lf = bytes
        .iter()
        .enumerate()
        .filter(|(index, byte)| **byte == b'\n' && (*index == 0 || bytes[*index - 1] != b'\r'))
        .count();

    if crlf > 0 && crlf >= lf {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_file() {
        let decoded = decode(&[]);
        assert_eq!(decoded.text, "");
        assert_eq!(decoded.encoding, "utf-8");
        assert!(!decoded.bom);
        assert_eq!(decoded.line_ending, LineEnding::Lf);
        assert!(encode(
            &decoded.text,
            &decoded.encoding,
            decoded.bom,
            decoded.line_ending
        )
        .is_empty());
    }

    #[test]
    fn utf8_without_bom() {
        let bytes = "\u{41f}\u{440}\u{438}\u{432}\u{435}\u{442}\n".as_bytes();
        let decoded = decode(bytes);
        assert_eq!(decoded.text, "\u{41f}\u{440}\u{438}\u{432}\u{435}\u{442}\n");
        assert_eq!(decoded.encoding, "utf-8");
        assert!(!decoded.bom);
    }

    #[test]
    fn utf8_with_bom() {
        let mut bytes = b"\xEF\xBB\xBF".to_vec();
        bytes.extend_from_slice("\u{442}\u{435}\u{43a}\u{441}\u{442}".as_bytes());
        let decoded = decode(&bytes);
        assert_eq!(decoded.text, "\u{442}\u{435}\u{43a}\u{441}\u{442}");
        assert_eq!(decoded.encoding, "utf-8");
        assert!(decoded.bom);
        assert_eq!(
            encode(
                &decoded.text,
                &decoded.encoding,
                decoded.bom,
                decoded.line_ending
            ),
            bytes
        );
    }

    #[test]
    fn utf16le_with_bom() {
        let mut bytes = b"\xFF\xFE".to_vec();
        for unit in "\u{442}\u{435}\u{43a}\u{441}\u{442}\r\n".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let decoded = decode(&bytes);
        assert_eq!(decoded.text, "\u{442}\u{435}\u{43a}\u{441}\u{442}\n");
        assert_eq!(decoded.encoding, "utf-16le");
        assert!(decoded.bom);
        assert_eq!(decoded.line_ending, LineEnding::Crlf);
        assert_eq!(
            encode(
                &decoded.text,
                &decoded.encoding,
                decoded.bom,
                decoded.line_ending
            ),
            bytes
        );
    }

    #[test]
    fn cp1251_cyrillic() {
        let bytes = [0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2];
        let decoded = decode(&bytes);
        assert_eq!(decoded.text, "\u{41f}\u{440}\u{438}\u{432}\u{435}\u{442}");
        assert_eq!(decoded.encoding, "windows-1251");
        assert_eq!(
            encode(
                &decoded.text,
                &decoded.encoding,
                decoded.bom,
                decoded.line_ending
            ),
            bytes
        );
    }

    #[test]
    fn crlf_file() {
        let decoded = decode(b"one\r\ntwo\r\n");
        assert_eq!(decoded.text, "one\ntwo\n");
        assert_eq!(decoded.line_ending, LineEnding::Crlf);
        assert_eq!(
            encode(
                &decoded.text,
                &decoded.encoding,
                decoded.bom,
                decoded.line_ending
            ),
            b"one\r\ntwo\r\n"
        );
    }

    #[test]
    fn mixed_line_endings_use_majority_rule() {
        let decoded = decode(b"one\r\ntwo\nthree\r\nfour\n");
        assert_eq!(decoded.text, "one\ntwo\nthree\nfour\n");
        assert_eq!(decoded.line_ending, LineEnding::Crlf);
    }

    #[test]
    fn decode_encode_round_trip() {
        let bytes = b"\xEF\xBB\xBFfirst\r\nsecond\r\n";
        let decoded = decode(bytes);
        let encoded = encode(
            &decoded.text,
            &decoded.encoding,
            decoded.bom,
            decoded.line_ending,
        );
        assert_eq!(encoded, bytes);
    }
}
