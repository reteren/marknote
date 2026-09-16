#!/usr/bin/env python3
"""
Скрипт для воспроизводимой генерации фикстуры sample.pdf без сторонних зависимостей.
Генерирует стандартный валидный PDF 1.4 документ с заголовком, несколькими абзацами,
переносом строки внутри абзаца и списком.
"""

from pathlib import Path


def generate_pdf() -> bytes:
    header = "%PDF-1.4\n"
    obj1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    obj2 = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
    obj3 = (
        "3 0 obj\n"
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\n"
        "endobj\n"
    )
    obj4 = (
        "4 0 obj\n"
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n"
        "endobj\n"
    )

    stream_text = """BT
/F1 18 Tf
72 720 Td
24 TL
(MarkNote PDF Extraction Test) Tj
T*
/F1 12 Tf
16 TL
T*
(This is the first paragraph of the test document.) Tj
T*
(It has a line break inside the paragraph to verify extraction.) Tj
T*
T*
(The second paragraph introduces an itemized list below:) Tj
T*
T*
(- First item in the list) Tj
T*
(- Second item in the list) Tj
T*
(- Third item with additional text) Tj
T*
T*
(Final conclusion paragraph verifying text flow and ordering.) Tj
ET
"""

    stream_bytes = stream_text.encode("latin1")
    stream_len = len(stream_bytes)

    obj5 = f"5 0 obj\n<< /Length {stream_len} >>\nstream\n{stream_text}endstream\nendobj\n"

    offsets = [0]
    body = ""
    offset = len(header.encode("latin1"))

    for obj in [obj1, obj2, obj3, obj4, obj5]:
        offsets.append(offset)
        body += obj
        offset += len(obj.encode("latin1"))

    xref_offset = offset
    xref = "xref\n0 6\n0000000000 65535 f \n"
    for off in offsets[1:]:
        xref += f"{off:010d} 00000 n \n"

    trailer = f"""trailer
<< /Size 6 /Root 1 0 R >>
startxref
{xref_offset}
%%EOF
"""

    return (header + body + xref + trailer).encode("latin1")


def main() -> None:
    target = Path(__file__).parent / "sample.pdf"
    content = generate_pdf()
    target.write_bytes(content)
    print(f"Generated {target} ({len(content)} bytes)")


if __name__ == "__main__":
    main()
