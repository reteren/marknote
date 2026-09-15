//! A deliberately small RTF reader/writer.
//!
//! RTF is a poor interchange format for an editor: preserving every font,
//! field, shape, and section property would require a full document model.
//! This adapter therefore handles the subset which has a direct Markdown
//! representation and marks the format as lossy in its capabilities.

use super::{FormatAdapter, FormatCapabilities};

pub struct RtfAdapter;

/// Returns the RTF adapter for the M6 registry owner.
pub fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    vec![Box::new(RtfAdapter)]
}

impl FormatAdapter for RtfAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: "rtf".to_owned(),
            label: "Rich Text Format".to_owned(),
            default_extension: "rtf".to_owned(),
            extensions: vec!["rtf".to_owned()],
            editable: true,
            creatable: false,
            live_preview: true,
            autosave: false,
            lossy: true,
            syntax_mode: None,
            template: String::new(),
        }
    }

    fn decode(&self, bytes: &[u8]) -> anyhow::Result<crate::encoding::Decoded> {
        Ok(crate::encoding::Decoded {
            text: decode_rtf(bytes)?,
            encoding: "utf-8".to_owned(),
            bom: false,
            line_ending: crate::encoding::LineEnding::Lf,
        })
    }

    fn encode(&self, text: &str, _src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>> {
        Ok(encode_rtf(text).into_bytes())
    }
}

#[derive(Clone)]
struct RtfState {
    codepage: &'static encoding_rs::Encoding,
    unicode_fallback: usize,
    skip_group: bool,
    bold: bool,
    italic: bool,
    strike: bool,
    font_size_half_points: usize,
    list: ListKind,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ListKind {
    None,
    Bullet,
    Numbered,
}

impl Default for RtfState {
    fn default() -> Self {
        Self {
            codepage: encoding_rs::WINDOWS_1252,
            unicode_fallback: 1,
            skip_group: false,
            bold: false,
            italic: false,
            strike: false,
            font_size_half_points: 24,
            list: ListKind::None,
        }
    }
}

struct RtfParser<'a> {
    bytes: &'a [u8],
    position: usize,
    state: RtfState,
    stack: Vec<RtfState>,
    output: String,
    paragraph: String,
    rendered_bold: bool,
    rendered_italic: bool,
    rendered_strike: bool,
}

impl<'a> RtfParser<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            position: 0,
            state: RtfState::default(),
            stack: Vec::new(),
            output: String::new(),
            paragraph: String::new(),
            rendered_bold: false,
            rendered_italic: false,
            rendered_strike: false,
        }
    }

    fn parse(mut self) -> anyhow::Result<String> {
        if self.bytes.is_empty() {
            return Ok(String::new());
        }

        while self.position < self.bytes.len() {
            match self.bytes[self.position] {
                b'{' => {
                    self.stack.push(self.state.clone());
                    self.position += 1;
                }
                b'}' => {
                    self.state = self.stack.pop().ok_or_else(|| {
                        anyhow::anyhow!(
                            "This RTF document is invalid or incomplete. Check the file and try again."
                        )
                    })?;
                    self.position += 1;
                }
                b'\\' => self.control_word()?,
                _ => self.text_run(),
            }
        }

        if !self.stack.is_empty() {
            return Err(anyhow::anyhow!(
                "This RTF document is invalid or incomplete. Check the file and try again."
            ));
        }
        self.flush_paragraph();
        Ok(self.output)
    }

    fn text_run(&mut self) {
        let start = self.position;
        while self.position < self.bytes.len()
            && !matches!(self.bytes[self.position], b'{' | b'}' | b'\\')
        {
            self.position += 1;
        }
        if self.state.skip_group || start == self.position {
            return;
        }
        let (decoded, _, _) = self
            .state
            .codepage
            .decode(&self.bytes[start..self.position]);
        self.append_text(&decoded);
    }

    fn control_word(&mut self) -> anyhow::Result<()> {
        debug_assert_eq!(self.bytes[self.position], b'\\');
        self.position += 1;
        if self.position >= self.bytes.len() {
            return Ok(());
        }

        let symbol = self.bytes[self.position];
        if matches!(symbol, b'\\' | b'{' | b'}') {
            if !self.state.skip_group {
                self.append_text(match symbol {
                    b'\\' => "\\",
                    b'{' => "{",
                    _ => "}",
                });
            }
            self.position += 1;
            return Ok(());
        }
        if symbol == b'\'' {
            self.position += 1;
            if self.position + 1 >= self.bytes.len() {
                return Err(anyhow::anyhow!(
                    "This RTF document is invalid or incomplete. Check the file and try again."
                ));
            }
            let high = hex_value(self.bytes[self.position]);
            let low = hex_value(self.bytes[self.position + 1]);
            self.position += 2;
            let Some(byte) = high.and_then(|high| low.map(|low| (high << 4) | low)) else {
                return Err(anyhow::anyhow!(
                    "This RTF document is invalid or incomplete. Check the file and try again."
                ));
            };
            if !self.state.skip_group {
                let encoded_byte = [byte];
                let (decoded, _, _) = self.state.codepage.decode(&encoded_byte);
                self.append_text(&decoded);
            }
            return Ok(());
        }
        if symbol == b'*' {
            self.position += 1;
            self.state.skip_group = true;
            return Ok(());
        }

        if !symbol.is_ascii_alphabetic() {
            self.position += 1;
            if self.state.skip_group {
                return Ok(());
            }
            match symbol {
                b'~' => self.append_text("\u{00a0}"),
                b'-' => self.append_text("\u{00ad}"),
                b'_' => self.append_text("\u{2011}"),
                _ => {}
            }
            return Ok(());
        }

        let name_start = self.position;
        while self.position < self.bytes.len() && self.bytes[self.position].is_ascii_alphabetic() {
            self.position += 1;
        }
        let name = std::str::from_utf8(&self.bytes[name_start..self.position])?;
        let mut parameter = None;
        let parameter_start = self.position;
        if self.position < self.bytes.len()
            && matches!(self.bytes[self.position], b'-' | b'+' | b'0'..=b'9')
        {
            if self.bytes[self.position] == b'-' || self.bytes[self.position] == b'+' {
                self.position += 1;
            }
            let digits_start = self.position;
            while self.position < self.bytes.len() && self.bytes[self.position].is_ascii_digit() {
                self.position += 1;
            }
            if digits_start != self.position {
                parameter = std::str::from_utf8(&self.bytes[parameter_start..self.position])?
                    .parse::<i32>()
                    .ok();
            } else {
                self.position = parameter_start;
            }
        }
        if self.position < self.bytes.len() && self.bytes[self.position] == b' ' {
            self.position += 1;
        }

        if self.state.skip_group {
            if name == "bin" {
                self.position = self
                    .position
                    .saturating_add(parameter.unwrap_or_default().max(0) as usize)
                    .min(self.bytes.len());
            }
            return Ok(());
        }

        match name {
            "rtf" | "ansi" | "mac" | "deff" | "deflang" | "viewkind" | "viewscale" | "paperw"
            | "paperh" | "margl" | "margr" | "margt" | "margb" | "f" | "fcharset" | "fprq"
            | "lang" => {}
            "ansicpg" => {
                if let Some(number) = parameter {
                    self.state.codepage = codepage(number);
                }
            }
            "uc" => {
                self.state.unicode_fallback = parameter.unwrap_or(1).max(0) as usize;
            }
            "u" => {
                if let Some(number) = parameter {
                    let code_unit = (number as i64).rem_euclid(65_536) as u16;
                    if let Some(character) = char::from_u32(code_unit as u32) {
                        self.append_text(&character.to_string());
                    }
                    self.skip_fallback(self.state.unicode_fallback);
                }
            }
            "b" => self.state.bold = parameter != Some(0),
            "i" => self.state.italic = parameter != Some(0),
            // Markdown has no underline primitive in the editor's contract;
            // keep the current bold/italic state intact and simply drop it.
            "ul" | "ulnone" => {}
            "strike" => self.state.strike = parameter != Some(0),
            "fs" => self.state.font_size_half_points = parameter.unwrap_or(24).max(1) as usize,
            "plain" => {
                self.state.bold = false;
                self.state.italic = false;
                self.state.strike = false;
                self.state.font_size_half_points = 24;
            }
            "pard" => {
                self.state.list = ListKind::None;
                self.state.font_size_half_points = 24;
            }
            "par" => self.flush_paragraph(),
            "line" => self.paragraph.push('\n'),
            "tab" => self.append_text("    "),
            "bullet" => {
                self.state.list = ListKind::Bullet;
            }
            "pnlvlblt" => self.state.list = ListKind::Bullet,
            "pndec" => self.state.list = ListKind::Numbered,
            "pntext" | "fonttbl" | "colortbl" | "stylesheet" | "info" | "pict" | "object"
            | "header" | "footer" | "footnote" | "annotation" | "atnauthor" | "field"
            | "fldinst" => self.state.skip_group = true,
            "bin" => {
                self.position = self
                    .position
                    .saturating_add(parameter.unwrap_or_default().max(0) as usize)
                    .min(self.bytes.len());
            }
            "emdash" => self.append_text("—"),
            "endash" => self.append_text("–"),
            "lquote" => self.append_text("‘"),
            "rquote" => self.append_text("’"),
            "ldblquote" => self.append_text("“"),
            "rdblquote" => self.append_text("”"),
            _ => {}
        }
        Ok(())
    }

    fn skip_fallback(&mut self, mut count: usize) {
        while count > 0 && self.position < self.bytes.len() {
            match self.bytes[self.position] {
                b'{' | b'}' => break,
                b'\\' if self.position + 1 < self.bytes.len() => {
                    if self.bytes[self.position + 1] == b'\''
                        && self.position + 3 < self.bytes.len()
                    {
                        self.position += 4;
                    } else {
                        self.position += 2;
                    }
                }
                _ => self.position += 1,
            }
            count -= 1;
        }
    }

    fn append_text(&mut self, text: &str) {
        if text.is_empty() || self.state.skip_group {
            return;
        }
        self.sync_formatting();
        let escaped = escape_markdown(text);
        self.paragraph.push_str(&escaped);
    }

    fn sync_formatting(&mut self) {
        if self.rendered_bold != self.state.bold {
            self.paragraph.push_str("**");
            self.rendered_bold = self.state.bold;
        }
        if self.rendered_italic != self.state.italic {
            self.paragraph.push('*');
            self.rendered_italic = self.state.italic;
        }
        if self.rendered_strike != self.state.strike {
            self.paragraph.push_str("~~");
            self.rendered_strike = self.state.strike;
        }
    }

    fn flush_paragraph(&mut self) {
        if self.paragraph.is_empty() {
            return;
        }
        self.sync_formatting();
        if self.rendered_strike {
            self.paragraph.push_str("~~");
            self.rendered_strike = false;
        }
        if self.rendered_italic {
            self.paragraph.push('*');
            self.rendered_italic = false;
        }
        if self.rendered_bold {
            self.paragraph.push_str("**");
            self.rendered_bold = false;
        }
        let mut line = std::mem::take(&mut self.paragraph);
        let heading_level = match self.state.font_size_half_points {
            48.. => Some(1),
            36..=47 => Some(2),
            28..=35 => Some(3),
            _ => None,
        };
        if let Some(level) = heading_level {
            line = format!("{} {}", "#".repeat(level), line.trim_start());
        }
        line = match self.state.list {
            ListKind::None => line,
            ListKind::Bullet => format!("- {line}"),
            ListKind::Numbered => format!("1. {line}"),
        };
        if !self.output.is_empty() {
            self.output.push('\n');
        }
        self.output.push_str(line.trim_end());
    }
}

fn decode_rtf(bytes: &[u8]) -> anyhow::Result<String> {
    if !bytes
        .windows(5)
        .any(|window| window.eq_ignore_ascii_case(br"{\rtf"))
    {
        return Err(anyhow::anyhow!("Not a valid RTF document."));
    }
    RtfParser::new(bytes).parse()
}

fn codepage(number: i32) -> &'static encoding_rs::Encoding {
    match number {
        1251 => encoding_rs::WINDOWS_1251,
        1250 => encoding_rs::WINDOWS_1250,
        1252 => encoding_rs::WINDOWS_1252,
        1253 => encoding_rs::WINDOWS_1253,
        1254 => encoding_rs::WINDOWS_1254,
        1255 => encoding_rs::WINDOWS_1255,
        1256 => encoding_rs::WINDOWS_1256,
        1257 => encoding_rs::WINDOWS_1257,
        1258 => encoding_rs::WINDOWS_1258,
        932 => encoding_rs::SHIFT_JIS,
        936 => encoding_rs::GBK,
        949 => encoding_rs::EUC_KR,
        950 => encoding_rs::BIG5,
        _ => encoding_rs::WINDOWS_1252,
    }
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn escape_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for character in text.chars() {
        if matches!(character, '\\' | '*' | '_' | '~' | '[' | ']' | '`') {
            result.push('\\');
        }
        result.push(character);
    }
    result
}

fn encode_rtf(text: &str) -> String {
    let mut result = String::from(r"{\rtf1\ansi\ansicpg1252\deff0\uc1\viewkind4\fs24 ");
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    for line in normalized.split('\n') {
        result.push_str(r"\pard ");
        let (prefix, body) = markdown_line_prefix(line);
        result.push_str(prefix);
        encode_inline(body, &mut result);
        result.push_str(r"\par ");
    }
    result.push('}');
    result
}

fn markdown_line_prefix(line: &str) -> (&'static str, &str) {
    let trimmed = line.trim_start();
    let hashes = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if (1..=6).contains(&hashes) && trimmed.chars().nth(hashes) == Some(' ') {
        return match hashes {
            1 => (r"\fs48\b ", trimmed[2..].trim_start()),
            2 => (r"\fs36\b ", trimmed[3..].trim_start()),
            _ => (r"\fs28\b ", trimmed[hashes + 1..].trim_start()),
        };
    }
    if let Some(body) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
    {
        return (r"\pnlvlblt ", body);
    }
    if let Some(dot) = trimmed.find(". ") {
        if dot > 0
            && trimmed[..dot]
                .chars()
                .all(|character| character.is_ascii_digit())
        {
            return (r"\pndec ", &trimmed[dot + 2..]);
        }
    }
    ("", line)
}

fn encode_inline(text: &str, output: &mut String) {
    let mut index = 0;
    let mut bold = false;
    let mut italic = false;
    let mut strike = false;
    let characters: Vec<char> = text.chars().collect();
    while index < characters.len() {
        if index + 1 < characters.len() && characters[index] == '*' && characters[index + 1] == '*'
        {
            output.push_str(if bold { r"\b0 " } else { r"\b " });
            bold = !bold;
            index += 2;
        } else if index + 1 < characters.len()
            && characters[index] == '~'
            && characters[index + 1] == '~'
        {
            output.push_str(if strike { r"\strike0 " } else { r"\strike " });
            strike = !strike;
            index += 2;
        } else if characters[index] == '*' || characters[index] == '_' {
            output.push_str(if italic { r"\i0 " } else { r"\i " });
            italic = !italic;
            index += 1;
        } else if characters[index] == '\\' && index + 1 < characters.len() {
            encode_rtf_char(characters[index + 1], output);
            index += 2;
        } else {
            encode_rtf_char(characters[index], output);
            index += 1;
        }
    }
    if strike {
        output.push_str(r"\strike0 ");
    }
    if italic {
        output.push_str(r"\i0 ");
    }
    if bold {
        output.push_str(r"\b0 ");
    }
    output.push_str(r"\fs24 ");
}

fn encode_rtf_char(character: char, output: &mut String) {
    match character {
        '\\' => output.push_str(r"\\"),
        '{' => output.push_str(r"\{"),
        '}' => output.push_str(r"\}"),
        '\n' => output.push_str(r"\line "),
        character if character.is_ascii() && !character.is_ascii_control() => {
            output.push(character)
        }
        character => {
            let mut units_buffer = [0; 2];
            for unit in character.encode_utf16(&mut units_buffer).iter().copied() {
                let signed = i16::from_ne_bytes(unit.to_ne_bytes());
                output.push_str(&format!(r"\u{signed}?"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_disable_autosave_and_mark_lossy() {
        let caps = RtfAdapter.caps();
        assert!(caps.editable);
        assert!(!caps.creatable);
        assert!(caps.live_preview);
        assert!(!caps.autosave);
        assert!(caps.lossy);
    }

    #[test]
    fn decodes_cyrillic_from_windows_1251() {
        let bytes = b"{\\rtf1\\ansi\\ansicpg1251 \\cf0\xCF\xF0\xE8\xE2\xE5\xF2}";
        assert_eq!(decode_rtf(bytes).expect("valid RTF"), "Привет");
    }

    #[test]
    fn decodes_unicode_escape() {
        let bytes = br"{\rtf1\ansi\uc1\u1055?\u1088?\u1080?\u1074?\u1077?\u1090?}";
        assert_eq!(decode_rtf(bytes).expect("valid RTF"), "Привет");
    }

    #[test]
    fn decodes_inline_formatting_and_lists() {
        let bytes = br"{\rtf1\ansi\ansicpg1251\b \'e6\'e8\'f0\'ed\'fb\'e9\b0  \'e8 \i \'ea\'f3\'f0\'f1\'e8\'e2\i0\par\pnlvlblt \'ef\'f3\'ed\'ea\'f2\par}";
        let text = decode_rtf(bytes).expect("valid RTF");
        assert!(text.contains("**жирный**"));
        assert!(text.contains("*курсив*"));
        assert!(text.contains("- пункт"));
    }

    #[test]
    fn markdown_rtf_round_trip_preserves_text() {
        let markdown = "# Заголовок\nТекст **жирный** и *курсивный*\n- пункт";
        let rtf = encode_rtf(markdown);
        let decoded = decode_rtf(rtf.as_bytes()).expect("encoded RTF");
        assert!(decoded.contains("Заголовок"));
        assert!(decoded.contains("жирный"));
        assert!(decoded.contains("курсивный"));
        assert!(decoded.contains("пункт"));
    }
}
