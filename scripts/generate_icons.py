"""Build the MarkNote icon set from one source image.

Scaling uses the nearest-neighbor filter intentionally: the image is posterized,
with sharp edges and grain, and smoothing filters turn it into blur—especially
at 32 pixels, where the taskbar and Explorer icon are actually seen.

Run:     python scripts/generate_icons.py
Source:  src-tauri/icons/icon-source.png (512x512, RGBA with transparency)
"""

from __future__ import annotations

import struct
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
SOURCE = ICONS / "icon-source.png"

# Sizes for tauri.conf.json: file name -> side length in pixels.
PNG_TARGETS = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
}

# Contents of the ICO. Windows chooses the appropriate size, so cover both
# small uses (file lists, taskbar) and large uses (tiles, Alt-Tab).
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def scale(src: Image.Image, side: int) -> Image.Image:
    """Downscale with nearest-neighbor filtering and no smoothing."""
    return src.resize((side, side), Image.Resampling.NEAREST)


def png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """Write an ICO manually.

    Pillow rescales images with its own filter when saving ICO and ignores how
    the image was prepared, while we specifically need nearest-neighbor output.
    Build the container ourselves: header, entry table, then PNG payloads for
    each size (Windows Vista and later understand this layout).
    """
    payloads = [png_bytes(image) for image in images]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)

    entries = bytearray()
    for image, payload in zip(images, payloads):
        side = 0 if image.width >= 256 else image.width  # 256 is written as 0
        entries += struct.pack(
            "<BBBBHHII", side, side, 0, 0, 1, 32, len(payload), offset
        )
        offset += len(payload)

    path.write_bytes(header + bytes(entries) + b"".join(payloads))


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"source image not found: {SOURCE}")

    source = Image.open(SOURCE).convert("RGBA")
    if source.size != (512, 512):
        print(f"warning: source is {source.size}; expected 512x512")

    for name, side in PNG_TARGETS.items():
        image = scale(source, side)
        image.save(ICONS / name, format="PNG", optimize=True)
        print(f"{name:16} {side}x{side}")

    write_ico(ICONS / "icon.ico", [scale(source, side) for side in ICO_SIZES])
    print(f"{'icon.ico':16} {', '.join(str(s) for s in ICO_SIZES)}")

    # Check: an opaque background means the source lost its alpha channel,
    # leaving the icon with a white square around the image.
    alpha = scale(source, 32).getchannel("A")
    if alpha.getextrema()[0] != 0:
        print("warning: the icon has no transparent pixels")


if __name__ == "__main__":
    main()
