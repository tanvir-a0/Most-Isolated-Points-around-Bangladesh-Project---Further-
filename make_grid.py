"""Tile the district images from script 4 into printable grid pages.

Default is 5 columns x 4 rows = 20 districts a page, so 64 districts fill
four pages. Images are sorted by division, then district, so each page groups
neighbouring districts together.

Filenames are parsed for the caption, so they must keep the shape script 4
gives them:  p4_<Division>_<District>_<dist>m_zoom_<lat>_<lon>.jpg
Drive's duplicate "(1)" copies are ignored.

Usage
-----
    python make_grid.py <folder> [options]

    python make_grid.py Project_Further
    python make_grid.py Project_Further --cols 5 --rows 4
    python make_grid.py Project_Further --no-labels        # bare grid
    python make_grid.py Project_Further --page a4          # A4 portrait
    python make_grid.py Project_Further --pdf              # also write a PDF

Outputs grid_page_01.jpg ... into <folder>/grid/. Needs only Pillow.
"""

import argparse
import pathlib
import re
import sys

from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

CELL_PX = 700           # rendered size of each image cell
GUTTER = 14
MARGIN = 40
CAPTION_H = 62
BG = (255, 255, 255)
FG = (17, 17, 17)
SUB = (110, 110, 110)

A4_PORTRAIT = (2480, 3508)      # 300 dpi

# The trailing coordinates are four underscore-separated tokens, because the
# decimal point of each was written as '_': lat_int_lat_frac_lon_int_lon_frac.
NAME_RE = re.compile(
    r"^p4_(?P<div>[^_]+)_(?P<dist>.+?)_(?P<m>\d+)m_zoom_"
    r"(?P<la>-?\d+)_(?P<laf>\d+)_(?P<lo>-?\d+)_(?P<lof>\d+)$"
)


def parse(path: pathlib.Path):
    """Pull division, district and distance out of the filename."""
    m = NAME_RE.match(path.stem)
    if not m:
        return {"div": "", "dist": path.stem, "m": 0, "coord": ""}
    g = m.groupdict()
    return {"div": g["div"], "dist": g["dist"].replace("_", " "),
            "m": int(g["m"]),
            "coord": f"{g['la']}.{g['laf']}, {g['lo']}.{g['lof']}"}


def load_font(size: int, bold: bool = False):
    for name in (["arialbd.ttf", "seguisb.ttf"] if bold else ["arial.ttf", "segoeui.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def square(im: Image.Image, size: int) -> Image.Image:
    """Centre-crop to a square, then resize - fills the cell without distorting."""
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2,
                  (w + side) // 2, (h + side) // 2))
    return im.resize((size, size), Image.LANCZOS)


def build_page(items, cols, rows, labels, page_mode):
    cell_h = CELL_PX + (CAPTION_H if labels else 0)
    grid_w = cols * CELL_PX + (cols - 1) * GUTTER
    grid_h = rows * cell_h + (rows - 1) * GUTTER

    if page_mode == "a4":
        page_w, page_h = A4_PORTRAIT
        scale = min((page_w - 2 * MARGIN) / grid_w, (page_h - 2 * MARGIN) / grid_h)
        if scale < 1:
            grid_w, grid_h = int(grid_w * scale), int(grid_h * scale)
    else:
        page_w, page_h = grid_w + 2 * MARGIN, grid_h + 2 * MARGIN
        scale = 1.0

    page = Image.new("RGB", (page_w, page_h), BG)
    draw = ImageDraw.Draw(page)
    f_name = load_font(int(30 * scale), bold=True)
    f_sub = load_font(int(25 * scale))

    cw = int(CELL_PX * scale)
    ch = int(cell_h * scale)
    gut = int(GUTTER * scale)
    x0 = (page_w - (cols * cw + (cols - 1) * gut)) // 2
    y0 = (page_h - (rows * ch + (rows - 1) * gut)) // 2

    for idx, (path, meta) in enumerate(items):
        r, c = divmod(idx, cols)
        x = x0 + c * (cw + gut)
        y = y0 + r * (ch + gut)
        with Image.open(path) as im:
            page.paste(square(im.convert("RGB"), cw), (x, y))
        if labels:
            draw.text((x + 4, y + cw + int(8 * scale)),
                      f"{meta['dist']}", font=f_name, fill=FG)
            draw.text((x + 4, y + cw + int(8 * scale) + int(32 * scale)),
                      f"{meta['div']} · {meta['m']:,} m", font=f_sub, fill=SUB)
    return page


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", default=".")
    ap.add_argument("--cols", type=int, default=5)
    ap.add_argument("--rows", type=int, default=4)
    ap.add_argument("--no-labels", dest="labels", action="store_false",
                    help="bare grid, no district captions")
    ap.add_argument("--page", default="fit", choices=["fit", "a4"],
                    help="'fit' sizes the page to the grid; 'a4' uses A4 portrait")
    ap.add_argument("--pdf", action="store_true", help="also write all pages as one PDF")
    ap.add_argument("--quality", type=int, default=90)
    args = ap.parse_args()

    folder = pathlib.Path(args.folder).expanduser()
    if not folder.is_dir():
        print(f"not a folder: {folder}")
        return 1

    # skip Drive's "(1)" duplicates
    files = sorted(p for p in folder.glob("*.jpg") if "(" not in p.name)
    if not files:
        print(f"no .jpg files in {folder.resolve()}")
        return 1

    items = sorted(((p, parse(p)) for p in files),
                   key=lambda t: (t[1]["div"], t[1]["dist"]))

    per_page = args.cols * args.rows
    pages = [items[i:i + per_page] for i in range(0, len(items), per_page)]

    out = folder / "grid"
    out.mkdir(exist_ok=True)

    print(f"{len(items)} images -> {len(pages)} page(s) "
          f"of {args.cols}x{args.rows}\n")
    rendered = []
    for n, chunk in enumerate(pages, 1):
        page = build_page(chunk, args.cols, args.rows, args.labels, args.page)
        dst = out / f"grid_page_{n:02d}.jpg"
        page.save(dst, "JPEG", quality=args.quality, optimize=True)
        rendered.append(page)
        print(f"  {dst.name}  {page.size[0]}x{page.size[1]}  "
              f"{dst.stat().st_size / 1e6:.1f} MB  ({len(chunk)} districts)")

    if args.pdf:
        pdf = out / "district_grid.pdf"
        rendered[0].save(pdf, "PDF", resolution=150.0,
                         save_all=True, append_images=rendered[1:])
        print(f"  {pdf.name}  {pdf.stat().st_size / 1e6:.1f} MB")

    print(f"\nwritten to {out.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
