//! Read-only PDF adapter.  PDF has no reliable lossless Markdown mapping, so
//! the adapter exposes extracted text and never offers an encoder.

use super::{FormatAdapter, FormatCapabilities};
use std::panic::{catch_unwind, AssertUnwindSafe};

pub struct PdfAdapter;

/// Returns the PDF adapter for the M6 registry owner.
pub fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    vec![Box::new(PdfAdapter)]
}

impl FormatAdapter for PdfAdapter {
    fn caps(&self) -> FormatCapabilities {
        FormatCapabilities {
            id: "pdf".to_owned(),
            label: "PDF Document".to_owned(),
            default_extension: "pdf".to_owned(),
            extensions: vec!["pdf".to_owned()],
            editable: false,
            creatable: false,
            live_preview: false,
            autosave: false,
            lossy: true,
            syntax_mode: None,
            template: String::new(),
        }
    }

    fn decode(&self, bytes: &[u8]) -> anyhow::Result<crate::encoding::Decoded> {
        let extracted = catch_unwind(AssertUnwindSafe(|| {
            pdf_extract::extract_text_from_mem(bytes)
        }))
        .map_err(|_| {
            anyhow::anyhow!(
                "Could not read this PDF file. Check that it is a valid PDF and try again."
            )
        })?
        .map_err(|_| {
            anyhow::anyhow!(
                "Could not read this PDF file. Check that it is a valid PDF and try again."
            )
        })?;
        Ok(crate::encoding::Decoded {
            text: extracted.replace("\r\n", "\n").replace('\r', "\n"),
            encoding: "utf-8".to_owned(),
            bom: false,
            line_ending: crate::encoding::LineEnding::Lf,
        })
    }

    fn encode(&self, _text: &str, _src: &crate::encoding::Decoded) -> anyhow::Result<Vec<u8>> {
        Err(anyhow::anyhow!(
            "PDF files are read-only. Use Save As to create a Markdown copy."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_read_only() {
        let caps = PdfAdapter.caps();
        assert!(!caps.editable);
        assert!(!caps.creatable);
        assert!(!caps.live_preview);
        assert!(!caps.autosave);
        assert!(caps.lossy);
    }

    #[test]
    fn malformed_bytes_return_an_error() {
        let result = PdfAdapter.decode(b"not a PDF");
        assert!(result.is_err());
    }

    #[test]
    fn decodes_real_pdf_fixture_extracting_plain_text() {
        // Загружаем настоящий воспроизводимый PDF-документ из фикстур (src-tauri/tests/fixtures/sample.pdf).
        // Документ сгенерирован без сторонних библиотек через generate_sample_pdf.py.
        let bytes = include_bytes!("../../tests/fixtures/sample.pdf");
        let decoded = PdfAdapter
            .decode(bytes)
            .expect("валидный настоящий PDF должен успешно декодироваться");

        let text = &decoded.text;

        // 1. Проверяем наличие всех смысловых элементов документа:
        // - Заголовок документа
        assert!(
            text.contains("MarkNote PDF Extraction Test"),
            "заголовок документа должен быть извлечён"
        );
        // - Первый абзац с переносом строки
        assert!(
            text.contains("This is the first paragraph of the test document."),
            "первая строка первого абзаца должна быть извлечена"
        );
        assert!(
            text.contains("It has a line break inside the paragraph to verify extraction."),
            "вторая строка первого абзаца с переносом должна быть извлечена"
        );
        // - Второй абзац
        assert!(
            text.contains("The second paragraph introduces an itemized list below:"),
            "второй абзац должен присутствовать"
        );
        // - Элементы списка
        assert!(
            text.contains("- First item in the list"),
            "первый пункт списка должен быть извлечён"
        );
        assert!(
            text.contains("- Second item in the list"),
            "второй пункт списка должен быть извлечён"
        );
        assert!(
            text.contains("- Third item with additional text"),
            "третий пункт списка должен быть извлечён"
        );
        // - Заключительный абзац
        assert!(
            text.contains("Final conclusion paragraph verifying text flow and ordering."),
            "заключительный абзац должен присутствовать"
        );

        // 2. Проверяем строгий порядок следования текста (порядок не должен быть нарушен):
        let pos_heading = text.find("MarkNote PDF Extraction Test").unwrap();
        let pos_p1_l1 = text.find("This is the first paragraph").unwrap();
        let pos_p1_l2 = text.find("It has a line break inside").unwrap();
        let pos_p2 = text.find("The second paragraph introduces").unwrap();
        let pos_item1 = text.find("- First item").unwrap();
        let pos_item2 = text.find("- Second item").unwrap();
        let pos_item3 = text.find("- Third item").unwrap();
        let pos_conclusion = text.find("Final conclusion paragraph").unwrap();

        assert!(pos_heading < pos_p1_l1);
        assert!(pos_p1_l1 < pos_p1_l2);
        assert!(pos_p1_l2 < pos_p2);
        assert!(pos_p2 < pos_item1);
        assert!(pos_item1 < pos_item2);
        assert!(pos_item2 < pos_item3);
        assert!(pos_item3 < pos_conclusion);

        // 3. Честная фиксация того, что ТЕРЯЕТСЯ при извлечении из PDF:
        // - PDF — формат для печати, а не для разметки. Заголовок в нём — это лишь текст,
        //   отрисованный шрифтом большего кегля (18pt против 12pt).
        // - Семантическая структура Markdown (#, ##) отсутствует — извлекается чистый плоский текст.
        assert!(
            !text.contains("# MarkNote PDF Extraction Test"),
            "PDF-адаптер отдаёт плоский текст без искусственного угадывания заголовков"
        );
        // - Форматирование шрифтов (размер 18pt/12pt, гарнитура Helvetica) полностью теряется.
        // - Списки сохраняются как текст только благодаря символам дефиса '-', а не тегам разметки.
        // - Координаты и геометрия вёрстки схлопываются в обычные переносы строк '\\n'.
        //
        // Чего эта проверка НЕ доказывает, чтобы зелёный тест не читали шире,
        // чем он есть: фикстура — простой несжатый PDF 1.4 с одним шрифтом
        // Helvetica и текстом в операторах Tj. Настоящие документы из Word и
        // вёрстки приходят со сжатыми потоками (FlateDecode), встроенными
        // подмножествами шрифтов и кернингом через массивы TJ, где слова как
        // раз и рискуют слипнуться. Такой документ надо проверять отдельно и
        // на настоящем файле.
    }
}
