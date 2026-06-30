#!/usr/bin/env python3
"""Bake the DeepSeek whale logo (round screen, same pipeline as claude_logo).
Rasterizer uses rsvg-convert (resvg is not installed on this machine; for a flat-fill logo the two are equal in quality, and the old board's full asset set used it too)
rendering a transparent PNG -> official LVGLImage.py converts to RGB565A8 premultiply C.
Usage: python3 gen_deepseek_logo.py [px]   default 88
"""
import subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SVG = HERE / "deepseek_logo.svg"
LVGLIMAGE = HERE / "../../../managed_components/lvgl__lvgl/scripts/LVGLImage.py"
PX = int(sys.argv[1]) if len(sys.argv) > 1 else 88

def main():
    with tempfile.TemporaryDirectory() as d:
        png = Path(d) / "deepseek_logo.png"
        subprocess.run(["rsvg-convert", "-w", str(PX), "-h", str(PX),
                        str(SVG), "-o", str(png)], check=True)
        subprocess.run(["python3", str(LVGLIMAGE), "--ofmt", "C",
                        "--cf", "RGB565A8", "--premultiply", "--align", "16",
                        "-o", str(HERE), "--name", "deepseek_logo", str(png)], check=True)
    print(f"wrote deepseek_logo.c ({PX}x{PX} RGB565A8)")

if __name__ == "__main__":
    main()
