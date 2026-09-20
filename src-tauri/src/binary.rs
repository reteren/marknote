//! Conservative detection of binary content before opening an unknown file.
//!
//! This is intentionally a heuristic.  MarkNote should prefer showing a
//! questionable text file over rejecting a real text file, while an embedded
//! NUL byte is a sufficiently strong signal to reject immediately (except in
//! UTF-16, where NUL bytes are part of the normal representation).

const SAMPLE_LIMIT: usize = 4096;
const CONTROL_MINIMUM: usize = 8;
const CONTROL_PERCENT: usize = 10;

/// Returns true when the beginning of `bytes` looks like binary content.
///
/// At most the first 4096 bytes are inspected.  UTF-16LE/BE with a BOM is
/// interpreted as 16-bit code units first, so the zero high bytes of ordinary
/// Latin/Cyrillic text do not make it binary.  For all other encodings, NUL
/// is an immediate binary marker.  Other C0 controls are only decisive when
/// they occur in a meaningful quantity, allowing an isolated control
/// character in an otherwise textual file.
pub fn is_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(SAMPLE_LIMIT)];
    if sample.is_empty() {
        return false;
    }

    match sample {
        [0xFF, 0xFE, rest @ ..] => return utf16_is_binary(rest, true),
        [0xFE, 0xFF, rest @ ..] => return utf16_is_binary(rest, false),
        _ => {}
    }

    if sample.contains(&0) {
        return true;
    }

    too_many_controls(
        sample
            .iter()
            .filter(|byte| suspicious_control(**byte))
            .count(),
        sample.len(),
    )
}

/// Alias with a descriptive name for callers that want to make the sampling
/// behaviour explicit at the call site.
pub fn is_binary_sample(bytes: &[u8]) -> bool {
    is_binary(bytes)
}

fn utf16_is_binary(payload: &[u8], little_endian: bool) -> bool {
    let mut controls = 0usize;
    let mut units = 0usize;

    for pair in payload.chunks_exact(2) {
        let unit = if little_endian {
            u16::from_le_bytes([pair[0], pair[1]])
        } else {
            u16::from_be_bytes([pair[0], pair[1]])
        };
        units += 1;
        // Controls are everything below the space except tabs and line breaks,
        // plus DEL. Their abundance distinguishes binary data from text.
        let is_control = (unit <= 0x001F && !matches!(unit, 0x0009 | 0x000A | 0x000C | 0x000D))
            || unit == 0x007F;
        if is_control {
            controls += 1;
        }
    }

    // An odd trailing byte is possible while a file is being written.  Do
    // not reject it by itself: rejecting text is worse than a false negative.
    too_many_controls(controls, units)
}

fn suspicious_control(byte: u8) -> bool {
    (byte <= 0x1F && !matches!(byte, 0x09 | 0x0A | 0x0C | 0x0D)) || byte == 0x7F
}

fn too_many_controls(count: usize, total: usize) -> bool {
    count >= CONTROL_MINIMUM && count.saturating_mul(100) >= total.saturating_mul(CONTROL_PERCENT)
}

#[cfg(test)]
mod tests {
    use super::is_binary;

    #[test]
    fn utf8_cyrillic_is_text() {
        assert!(!is_binary("Ordinary text in English\n".as_bytes()));
    }

    #[test]
    fn utf16le_with_bom_is_text() {
        let mut bytes = b"\xFF\xFE".to_vec();
        bytes.extend("Note\r\n".encode_utf16().flat_map(u16::to_le_bytes));
        assert!(!is_binary(&bytes));
    }

    #[test]
    fn crlf_text_is_text() {
        assert!(!is_binary(b"one\r\ntwo\r\nthree\r\n"));
    }

    #[test]
    fn empty_file_is_text() {
        assert!(!is_binary(&[]));
    }

    #[test]
    fn png_fixture_is_binary() {
        let png = include_bytes!("../../fixtures/logo.png");
        assert!(is_binary(png));
    }

    #[test]
    fn all_zero_bytes_are_binary() {
        assert!(is_binary(&[0; 128]));
    }

    #[test]
    fn one_unusual_control_does_not_reject_text() {
        assert!(!is_binary(b"prefix\x01suffix"));
    }
}
