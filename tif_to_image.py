"""Convert the GeoTIFFs exported by script 4 into JPG or PNG.

The exports are already 8-bit RGB (Earth Engine's .visualize() did that), so
this is a repack, not a rescale - no contrast stretching is applied and what
you see is what the export contained.

Usage
-----
    python tif_to_image.py <folder> [--fmt jpg|png] [--max-px 4000] [--quality 92]

    python tif_to_image.py .
    python tif_to_image.py "C:/Users/me/Downloads" --fmt png
    python tif_to_image.py . --max-px 2000        # shrink for sharing

Outputs land next to each .tif. Existing files are skipped unless --overwrite.
Needs only Pillow.
"""

import argparse
import pathlib
import sys

from PIL import Image

# These exports run to thousands of pixels a side; Pillow's decompression-bomb
# guard would otherwise refuse them.
Image.MAX_IMAGE_PIXELS = None


def convert(src: pathlib.Path, fmt: str, max_px: int, quality: int,
            overwrite: bool) -> str:
    dst = src.with_suffix("." + fmt)
    if dst.exists() and not overwrite:
        return "skipped (exists)"

    with Image.open(src) as im:
        # style() overlays make the export RGBA. JPEG has no alpha channel, so
        # flatten onto black, which matches the nodata border Earth Engine
        # writes around a non-rectangular region.
        if im.mode in ("RGBA", "LA", "PA"):
            im = im.convert("RGBA")
            flat = Image.new("RGB", im.size, (0, 0, 0))
            flat.paste(im, mask=im.split()[-1])
            im = flat
        elif im.mode != "RGB":
            im = im.convert("RGB")

        if max_px and max(im.size) > max_px:
            im.thumbnail((max_px, max_px), Image.LANCZOS)

        if fmt in ("jpg", "jpeg"):
            im.save(dst, "JPEG", quality=quality, optimize=True)
        else:
            im.save(dst, "PNG", optimize=True)

    size_mb = dst.stat().st_size / 1e6
    return f"{dst.name}  {im.size[0]}x{im.size[1]}  {size_mb:.1f} MB"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", default=".",
                    help="folder holding the .tif files (default: current)")
    ap.add_argument("--fmt", default="jpg", choices=["jpg", "png"],
                    help="output format (default: jpg)")
    ap.add_argument("--max-px", type=int, default=0,
                    help="longest side in pixels; 0 keeps full resolution")
    ap.add_argument("--quality", type=int, default=92,
                    help="JPEG quality 1-95 (default: 92)")
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()

    folder = pathlib.Path(args.folder).expanduser()
    if not folder.is_dir():
        print(f"not a folder: {folder}")
        return 1

    tifs = sorted(p for p in folder.iterdir()
                  if p.suffix.lower() in (".tif", ".tiff"))
    if not tifs:
        print(f"no .tif files in {folder.resolve()}")
        return 1

    print(f"{len(tifs)} file(s) in {folder.resolve()}\n")
    failures = 0
    for src in tifs:
        try:
            print(f"  {src.name}\n    -> {convert(src, args.fmt, args.max_px, args.quality, args.overwrite)}")
        except Exception as exc:                      # keep going through a batch
            failures += 1
            print(f"  {src.name}\n    !! {type(exc).__name__}: {exc}")

    print(f"\ndone, {len(tifs) - failures} converted, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
