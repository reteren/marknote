//! Finding image links in Markdown text. Shared by ZIP export and the
//! Markdown package format, which both rewrite image destinations.

/// One `![alt](src)` found in the text: byte range of `src` and its value.
#[derive(Debug, PartialEq, Eq)]
pub struct ImageRef {
    pub start: usize,
    pub end: usize,
    pub src: String,
}

/// Finds Markdown image destinations, including `<angle bracket>` ones and an
/// optional title. Code spans and fenced blocks are not excluded: an image
/// written inside code is rare, and embedding it there is harmless.
pub fn image_refs(text: &str) -> Vec<ImageRef> {
    let bytes = text.as_bytes();
    let mut refs = Vec::new();
    let mut index = 0;
    while let Some(offset) = text[index..].find("![") {
        let open = index + offset;
        let Some(close_alt) = text[open + 2..].find("](").map(|value| open + 2 + value) else {
            break;
        };
        if text[open + 2..close_alt].contains('\n') {
            index = open + 2;
            continue;
        }
        let mut start = close_alt + 2;
        while start < bytes.len() && bytes[start] == b' ' {
            start += 1;
        }
        let (src_start, src_end, after) = if bytes.get(start) == Some(&b'<') {
            match text[start + 1..].find('>') {
                Some(length) => (start + 1, start + 1 + length, start + 2 + length),
                None => {
                    index = start;
                    continue;
                }
            }
        } else {
            let length = text[start..]
                .find(|character: char| character == ')' || character.is_whitespace())
                .unwrap_or(text.len() - start);
            (start, start + length, start + length)
        };
        let Some(close) = text[after..].find(')').map(|value| after + value) else {
            break;
        };
        if src_end > src_start && !text[after..close].contains('\n') {
            refs.push(ImageRef {
                start: src_start,
                end: src_end,
                src: text[src_start..src_end].to_owned(),
            });
        }
        index = close + 1;
    }
    refs
}


/// Replaces image destinations for which `replace` returns a new value.
pub fn rewrite_image_links(text: &str, mut replace: impl FnMut(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    for image in image_refs(text) {
        if let Some(replacement) = replace(&image.src) {
            out.push_str(&text[cursor..image.start]);
            out.push_str(&replacement);
            cursor = image.end;
        }
    }
    out.push_str(&text[cursor..]);
    out
}

/// Decodes `%XX` escapes; invalid UTF-8 leaves the value as it was.
pub fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_plain_angle_and_titled_image_destinations() {
        let text = "a ![x|400](note.assets/a%20b.png) b ![y](<note.assets/c d.gif> \"t\") ![z](https://e/f.png)
![broken
line](g.png)";
        let srcs: Vec<String> = image_refs(text).into_iter().map(|item| item.src).collect();
        assert_eq!(srcs, ["note.assets/a%20b.png", "note.assets/c d.gif", "https://e/f.png"]);
    }

    #[test]
    fn percent_decoding_handles_multibyte_and_trailing_escapes() {
        assert_eq!(percent_decode("caf%C3%A9%20x"), "café x");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("a%41"), "aA");
    }
}
