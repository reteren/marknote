"""Сборка набора иконок MarkNote из одного исходника.

Масштабирование идёт по ближайшему соседу. Это сделано намеренно: рисунок
постеризован, с резкими границами и зернистостью, и сглаживающие фильтры
превращают его в мыло — особенно на 32 пикселях, где как раз и видно иконку
в панели задач и в проводнике.

Запуск:  python scripts/generate_icons.py
Исходник: src-tauri/icons/icon-source.png (512x512, RGBA с прозрачным фоном)
"""

from __future__ import annotations

import struct
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
SOURCE = ICONS / "icon-source.png"

# Размеры для tauri.conf.json: имя файла -> сторона в пикселях.
PNG_TARGETS = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
}

# Что кладём в ICO. Windows выбирает подходящий размер сам, поэтому важно
# покрыть и мелкие (список файлов, панель задач), и крупные (плитки, alt-tab).
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def scale(src: Image.Image, side: int) -> Image.Image:
    """Уменьшение по ближайшему соседу, без сглаживания."""
    return src.resize((side, side), Image.Resampling.NEAREST)


def png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """Пишем ICO вручную.

    Pillow при сохранении ICO пересчитывает размеры своим фильтром и
    игнорирует то, как изображение было подготовлено, — а нам нужен именно
    ближайший сосед. Поэтому собираем контейнер сами: заголовок, таблица
    записей, следом PNG-полезная нагрузка каждого размера (Windows Vista и
    новее это понимает).
    """
    payloads = [png_bytes(image) for image in images]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)

    entries = bytearray()
    for image, payload in zip(images, payloads):
        side = 0 if image.width >= 256 else image.width  # 256 пишется как 0
        entries += struct.pack(
            "<BBBBHHII", side, side, 0, 0, 1, 32, len(payload), offset
        )
        offset += len(payload)

    path.write_bytes(header + bytes(entries) + b"".join(payloads))


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"нет исходника: {SOURCE}")

    source = Image.open(SOURCE).convert("RGBA")
    if source.size != (512, 512):
        print(f"предупреждение: исходник {source.size}, ожидалось 512x512")

    for name, side in PNG_TARGETS.items():
        image = scale(source, side)
        image.save(ICONS / name, format="PNG", optimize=True)
        print(f"{name:16} {side}x{side}")

    write_ico(ICONS / "icon.ico", [scale(source, side) for side in ICO_SIZES])
    print(f"{'icon.ico':16} {', '.join(str(s) for s in ICO_SIZES)}")

    # Проверка: непрозрачный фон означает, что исходник потерял альфу где-то
    # по дороге, и иконка будет с белым квадратом вокруг рисунка.
    alpha = scale(source, 32).getchannel("A")
    if alpha.getextrema()[0] != 0:
        print("предупреждение: в иконке нет прозрачных пикселей")


if __name__ == "__main__":
    main()
