"""Generate the MarkNote application icons without external image assets."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "src-tauri" / "icons"
TEAL = (39, 220, 218, 255)
CARD = (32, 39, 49, 255)
FOLD = (82, 94, 108, 255)
TEXT = (104, 116, 132, 255)


def draw_icon(size: int) -> Image.Image:
    """Draw the rounded MarkNote card and a compact Markdown/list glyph."""
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    margin = round(canvas_size * 0.12)
    radius = round(canvas_size * 0.15)
    right = canvas_size - margin
    bottom = canvas_size - margin
    draw.rounded_rectangle((margin, margin, right, bottom), radius=radius, fill=CARD)

    fold_start = round(canvas_size * 0.64)
    draw.polygon(
        [(fold_start, margin), (right, fold_start), (fold_start, fold_start)],
        fill=FOLD,
    )

    width = max(3, round(canvas_size * 0.055))
    joint = "curve"
    y_top = round(canvas_size * 0.39)
    y_bottom = round(canvas_size * 0.58)
    x_left = round(canvas_size * 0.24)
    x_mid = round(canvas_size * 0.39)
    x_right = round(canvas_size * 0.54)
    draw.line(
        [(x_left, y_bottom), (x_left, y_top), (x_mid, round(canvas_size * 0.49)),
         (x_right, y_top), (x_right, y_bottom)],
        fill=TEAL,
        width=width,
        joint=joint,
    )

    arrow_x = round(canvas_size * 0.69)
    draw.line(
        [(arrow_x, y_top), (arrow_x, round(canvas_size * 0.55))],
        fill=TEAL,
        width=width,
    )
    draw.line(
        [(arrow_x - round(canvas_size * 0.07), round(canvas_size * 0.49)),
         (arrow_x, round(canvas_size * 0.56)),
         (arrow_x + round(canvas_size * 0.07), round(canvas_size * 0.49))],
        fill=TEAL,
        width=width,
        joint=joint,
    )

    line_width = max(2, round(canvas_size * 0.035))
    for offset, length in ((0.00, 0.56), (0.10, 0.43), (0.20, 0.31)):
        y = round(canvas_size * (0.68 + offset))
        draw.rounded_rectangle(
            (round(canvas_size * 0.24), y, round(canvas_size * (0.24 + length)), y + line_width),
            radius=line_width // 2,
            fill=TEXT,
        )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    draw_icon(32).save(ICON_DIR / "32x32.png", format="PNG")
    draw_icon(128).save(ICON_DIR / "128x128.png", format="PNG")
    draw_icon(256).save(ICON_DIR / "128x128@2x.png", format="PNG")

    # Pillow writes each requested size into the ICO directory, producing a
    # real multi-resolution ICO rather than a PNG with a renamed extension.
    draw_icon(256).save(
        ICON_DIR / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
