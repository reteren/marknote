use super::{FormatAdapter, FormatCapabilities};

pub struct PlainAdapter;

impl FormatAdapter for PlainAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: "plain".to_owned(),
            label: "Plain Text".to_owned(),
            default_extension: "txt".to_owned(),
            extensions: vec![
                "txt".to_owned(),
                "log".to_owned(),
                "ini".to_owned(),
                "env".to_owned(),
                "text".to_owned(),
            ],
            editable: true,
            creatable: true,
            live_preview: false,
            autosave: true,
            lossy: false,
            syntax_mode: None,
            template: String::new(),
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
