#!/usr/bin/env python3
"""Bake the Codex/OpenAI logo (round screen, same size as claude_logo).
rsvg-convert renders codex_logo.svg to a transparent PNG -> official LVGLImage.py converts to RGB565A8 premultiply C.
Usage: python3 gen_codex_logo.py [px]   default 88
"""
import subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SVG = HERE / "codex_logo.svg"
LVGLIMAGE = HERE / "../../../managed_components/lvgl__lvgl/scripts/LVGLImage.py"
PX = int(sys.argv[1]) if len(sys.argv) > 1 else 88

def main():
    with tempfile.TemporaryDirectory() as d:
        png = Path(d) / "codex_logo.png"
        subprocess.run(["rsvg-convert", "-w", str(PX), "-h", str(PX),
                        str(SVG), "-o", str(png)], check=True)
        subprocess.run(["python3", str(LVGLIMAGE), "--ofmt", "C",
                        "--cf", "RGB565A8", "--premultiply", "--align", "16",
                        "-o", str(HERE), "--name", "codex_logo", str(png)], check=True)
    print(f"wrote codex_logo.c ({PX}x{PX} RGB565A8)")

if __name__ == "__main__":
    main()
