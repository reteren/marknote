use super::{FormatAdapter, FormatCapabilities};
use serde::{Deserialize, Serialize};

/// JSON syntax error with its position in the document.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonError {
    pub line: usize,
    pub column: usize,
    pub message: String,
}

/// Ordered representation of a JSON value that preserves object key order.
/// Unlike `serde_json::Value` (which stores keys in a `BTreeMap` and sorts them
/// alphabetically), `OrderedValue` stores key-value pairs in
/// `Vec<(String, OrderedValue)>`, preserving the original order without an
/// external dependency or the `preserve_order` feature.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum OrderedValue {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
    Array(Vec<OrderedValue>),
    Object(Vec<(String, OrderedValue)>),
}

impl<'de> Deserialize<'de> for OrderedValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct OrderedVisitor;

        impl<'de> serde::de::Visitor<'de> for OrderedVisitor {
            type Value = OrderedValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("any valid JSON value")
            }

            fn visit_bool<E>(self, v: bool) -> Result<Self::Value, E> {
                Ok(OrderedValue::Bool(v))
            }

            fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E> {
                Ok(OrderedValue::Number(v.into()))
            }

            fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E> {
                Ok(OrderedValue::Number(v.into()))
            }

            fn visit_f64<E>(self, v: f64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                serde_json::Number::from_f64(v)
                    .map(OrderedValue::Number)
                    .ok_or_else(|| serde::de::Error::custom("not a valid float"))
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> {
                Ok(OrderedValue::String(v.to_owned()))
            }

            fn visit_string<E>(self, v: String) -> Result<Self::Value, E> {
                Ok(OrderedValue::String(v))
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(OrderedValue::Null)
            }

            fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                Deserialize::deserialize(deserializer)
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(OrderedValue::Null)
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::SeqAccess<'de>,
            {
                let mut elements = Vec::new();
                while let Some(elem) = seq.next_element()? {
                    elements.push(elem);
                }
                Ok(OrderedValue::Array(elements))
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::MapAccess<'de>,
            {
                let mut entries = Vec::new();
                while let Some((key, val)) = map.next_entry::<String, OrderedValue>()? {
                    entries.push((key, val));
                }
                Ok(OrderedValue::Object(entries))
            }
        }

        deserializer.deserialize_any(OrderedVisitor)
    }
}

impl Serialize for OrderedValue {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            OrderedValue::Null => serializer.serialize_unit(),
            OrderedValue::Bool(b) => serializer.serialize_bool(*b),
            OrderedValue::Number(n) => n.serialize(serializer),
            OrderedValue::String(s) => serializer.serialize_str(s),
            OrderedValue::Array(arr) => {
                use serde::ser::SerializeSeq;
                let mut seq = serializer.serialize_seq(Some(arr.len()))?;
                for elem in arr {
                    seq.serialize_element(elem)?;
                }
                seq.end()
            }
            OrderedValue::Object(entries) => {
                use serde::ser::SerializeMap;
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                for (k, v) in entries {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
        }
    }
}

/// Checks JSON syntax and reports the exact error line and column.
/// Returns None when the document is valid.
#[allow(dead_code)]
pub fn validate(text: &str) -> Option<JsonError> {
    let mut de = serde_json::Deserializer::from_str(text);
    if let Err(err) = serde_json::Value::deserialize(&mut de) {
        return Some(JsonError {
            line: err.line(),
            column: err.column(),
            message: err.to_string(),
        });
    }
    if let Err(err) = de.end() {
        return Some(JsonError {
            line: err.line(),
            column: err.column(),
            message: err.to_string(),
        });
    }
    None
}

/// Formats JSON with two-space indentation while preserving object key order.
#[allow(dead_code)]
pub fn format(text: &str) -> anyhow::Result<String> {
    let mut de = serde_json::Deserializer::from_str(text);
    let val: OrderedValue = Deserialize::deserialize(&mut de).map_err(|e| {
        anyhow::anyhow!(
            "JSON syntax error at line {}, column {}: {}",
            e.line(),
            e.column(),
            e
        )
    })?;
    de.end().map_err(|e| {
        anyhow::anyhow!(
            "Trailing data at line {}, column {}: {}",
            e.line(),
            e.column(),
            e
        )
    })?;

    let mut buf = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"  ");
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    val.serialize(&mut ser)?;
    let mut formatted = String::from_utf8(buf)?;
    if !formatted.ends_with('\n') {
        formatted.push('\n');
    }
    Ok(formatted)
}

/// JSON format adapter.
#[derive(Debug, Clone, Default)]
pub struct JsonAdapter;

impl FormatAdapter for JsonAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: "json".to_owned(),
            label: "JSON".to_owned(),
            default_extension: "json".to_owned(),
            // Keep jsonc separate because serde_json does not support comments.
            // jsonc uses a dedicated CodeAdapter with JSON highlighting.
            extensions: vec!["json".to_owned()],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: Some("json".to_owned()),
            template: "{}\n".to_owned(),
        }
    }

    fn decode(&self, bytes: &[u8]) -> anyhow::Result<crate::encoding::Decoded> {
        Ok(crate::encoding::decode(bytes))
    }

    fn encode(&self, text: &str, src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>> {
        Ok(crate::encoding::encode(
            text,
            &src.encoding,
            src.bom,
            src.line_ending,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_json_passes_validation() {
        let sample = r#"{
            "title": "MarkNote",
            "version": 1,
            "features": ["preview", "autosave", null, true, false],
            "nested": {
                "author": "reteren",
                "count": 42.5
            }
        }"#;

        assert_eq!(validate(sample), None);
    }

    #[test]
    fn test_broken_json_returns_line_and_column() {
        let broken = "{\n  \"first\": 1,\n  \"second\": \n}";
        let error = validate(broken).expect("broken JSON must return an error");
        assert_eq!(error.line, 4);
        assert_eq!(error.column, 1);
        assert!(!error.message.is_empty());
    }

    #[test]
    fn test_trailing_comma_error() {
        let trailing = "{\n  \"a\": 1,\n}";
        let error = validate(trailing).expect("a trailing comma is invalid in JSON");
        assert_eq!(error.line, 3);
        assert_eq!(error.column, 1);
    }

    #[test]
    fn test_trailing_garbage_detected() {
        let garbage = r#"{"a": 1} unexpected"#;
        let error = validate(garbage).expect("trailing garbage must return an error");
        assert_eq!(error.line, 1);
        assert_eq!(error.column, 10);
    }

    #[test]
    fn test_format_preserves_key_order() {
        // Keys are intentionally not alphabetical (z, m, a, x, b).
        let input = r#"{"zebra": 10, "monkey": "banana", "apple": [3, 2, 1], "xylophone": true, "bear": null}"#;
        let formatted = format(input).expect("formatting valid JSON must succeed");

        let lines: Vec<&str> = formatted.lines().map(str::trim).collect();
        assert_eq!(lines[0], "{");
        assert_eq!(lines[1], "\"zebra\": 10,");
        assert_eq!(lines[2], "\"monkey\": \"banana\",");
        assert_eq!(lines[3], "\"apple\": [");
        assert_eq!(lines[4], "3,");
        assert_eq!(lines[5], "2,");
        assert_eq!(lines[6], "1");
        assert_eq!(lines[7], "],");
        assert_eq!(lines[8], "\"xylophone\": true,");
        assert_eq!(lines[9], "\"bear\": null");
        assert_eq!(lines[10], "}");

        // Verify that the order was not changed to apple, bear, monkey, xylophone, zebra.
        let pos_z = formatted.find("\"zebra\"").unwrap();
        let pos_m = formatted.find("\"monkey\"").unwrap();
        let pos_a = formatted.find("\"apple\"").unwrap();
        let pos_x = formatted.find("\"xylophone\"").unwrap();
        let pos_b = formatted.find("\"bear\"").unwrap();

        assert!(pos_z < pos_m);
        assert!(pos_m < pos_a);
        assert!(pos_a < pos_x);
        assert!(pos_x < pos_b);
    }

    #[test]
    fn test_format_nested_key_order() {
        let input = r#"{"outer_z": {"inner_b": 2, "inner_a": 1}, "outer_a": 0}"#;
        let formatted = format(input).unwrap();
        let pos_oz = formatted.find("\"outer_z\"").unwrap();
        let pos_oa = formatted.find("\"outer_a\"").unwrap();
        let pos_ib = formatted.find("\"inner_b\"").unwrap();
        let pos_ia = formatted.find("\"inner_a\"").unwrap();

        assert!(pos_oz < pos_ib);
        assert!(pos_ib < pos_ia);
        assert!(pos_ia < pos_oa);
    }

    #[test]
    fn test_format_invalid_json_returns_error() {
        assert!(format("{ invalid }").is_err());
    }

    #[test]
    fn test_json_adapter_caps() {
        let adapter = JsonAdapter;
        let caps = adapter.caps();
        assert_eq!(caps.id, "json");
        assert_eq!(caps.label, "JSON");
        assert_eq!(caps.default_extension, "json");
        assert_eq!(caps.extensions, vec!["json".to_owned()]);
        assert_eq!(caps.template, "{}\n");
        assert_eq!(caps.syntax_mode.as_deref(), Some("json"));
        assert!(caps.editable);
        assert!(caps.creatable);
        assert!(!caps.live_preview);
        assert!(caps.autosave);
        assert!(!caps.lossy);
    }

    #[test]
    fn test_decode_encode_roundtrip() {
        let adapter = JsonAdapter;
        let raw_bytes = b"{\r\n  \"hello\": \"\xd0\xbc\xd0\xb8\xd1\x80\"\r\n}\r\n";
        let decoded = adapter.decode(raw_bytes).expect("decoding succeeded");
        assert_eq!(decoded.line_ending, crate::encoding::LineEnding::Crlf);

        let encoded = adapter
            .encode(&decoded.text, &decoded)
            .expect("encoding succeeded");
        assert_eq!(encoded, raw_bytes);
    }
}
