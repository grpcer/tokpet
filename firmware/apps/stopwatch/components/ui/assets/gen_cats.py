#!/usr/bin/env python3
"""Bake the cat's three mood sprites (round screen, board-optimal).
Base cat taken from stopwatch-halo-cat-demo.html; FACE (eyes/mouth/sweat drop) is swapped per mood.
Each mood: resvg renders a transparent PNG -> official LVGLImage.py -> RGB565A8 premultiply C (runtime rotation paired with antialias).
Usage: python3 gen_cats.py [px]   default 128
"""
import subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LVGLIMAGE = HERE / "../../../managed_components/lvgl__lvgl/scripts/LVGLImage.py"
PX = int(sys.argv[1]) if len(sys.argv) > 1 else 128

# Fixed body (tail/torso/feet/head/ears/blush/nose/whiskers), without eyes, mouth or sweat drop. pivot at the feet ~(50,92).
BODY = '''
  <path d="M74 80 q18 -2 14 -20 q-2 -10 -10 -10" fill="none" stroke="#f0e4cf" stroke-width="9" stroke-linecap="round"/>
  <ellipse cx="50" cy="80" rx="27" ry="17" fill="#f6ecda"/>
  <ellipse cx="40" cy="92" rx="7" ry="5" fill="#f6ecda"/><ellipse cx="60" cy="92" rx="7" ry="5" fill="#f6ecda"/>
  <ellipse cx="50" cy="42" rx="30" ry="27" fill="#f6ecda"/>
  <path d="M24 30 L28 8 L46 26 Z" fill="#f6ecda"/><path d="M76 30 L72 8 L54 26 Z" fill="#f6ecda"/>
  <path d="M30 25 L32.5 13 L41 24 Z" fill="#e89aa0"/><path d="M70 25 L67.5 13 L59 24 Z" fill="#e89aa0"/>
  <ellipse cx="30" cy="50" rx="5" ry="3" fill="#f3b0ad" opacity=".7"/><ellipse cx="70" cy="50" rx="5" ry="3" fill="#f3b0ad" opacity=".7"/>
  <path d="M47.5 49 l2.5 2 l2.5 -2 z" fill="#d98c8c"/>
  <g stroke="#ddccb0" stroke-width="1" opacity=".45" stroke-linecap="round"><path d="M20 41 H10"/><path d="M20 46 H11"/><path d="M80 41 H90"/><path d="M80 46 H89"/></g>
'''

# Three mood expressions (eyes+mouth+sweat drop). chill=demo round-eyed double-highlight good cat; uneasy=worried eyes+sweat drop; panic=wide eyes, open mouth.
FACE = {
  "chill": '''
    <circle cx="38" cy="42" r="6.5" fill="#2c2c30"/><circle cx="62" cy="42" r="6.5" fill="#2c2c30"/>
    <circle cx="40" cy="39.5" r="2.4" fill="#fff"/><circle cx="64" cy="39.5" r="2.4" fill="#fff"/>
    <circle cx="36" cy="44" r="1" fill="#fff" opacity=".75"/><circle cx="60" cy="44" r="1" fill="#fff" opacity=".75"/>
    <path d="M50 51.5 q-3 3 -6 1 M50 51.5 q3 3 6 1" stroke="#c9a98f" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  ''',
  "uneasy": '''
    <path d="M31 40 Q38 36 45 40" stroke="#2c2c30" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M55 40 Q62 36 69 40" stroke="#2c2c30" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <circle cx="38" cy="44" r="4.5" fill="#2c2c30"/><circle cx="62" cy="44" r="4.5" fill="#2c2c30"/>
    <circle cx="39.5" cy="42.5" r="1.5" fill="#fff"/><circle cx="63.5" cy="42.5" r="1.5" fill="#fff"/>
    <path d="M46 53 q4 -2 8 0" stroke="#c9a98f" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M80 30 q3 6 0 9 q-3 -3 0 -9 Z" fill="#7ec8e3" opacity=".9"/>
  ''',
  "panic": '''
    <circle cx="38" cy="43" r="7.5" fill="#fff" stroke="#2c2c30" stroke-width="1.5"/>
    <circle cx="62" cy="43" r="7.5" fill="#fff" stroke="#2c2c30" stroke-width="1.5"/>
    <circle cx="38" cy="44" r="3.5" fill="#2c2c30"/><circle cx="62" cy="44" r="3.5" fill="#2c2c30"/>
    <ellipse cx="50" cy="55" rx="4" ry="5" fill="#5b2b2b"/>
    <path d="M82 29 q3 7 0 10 q-3 -3 0 -10 Z" fill="#7ec8e3" opacity=".95"/>
  ''',
}

def build_svg(mood):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            + BODY + FACE[mood] + '</svg>')

def main():
    for mood in FACE:
        with tempfile.TemporaryDirectory() as d:
            svg = Path(d) / f"cat_{mood}.svg"; png = Path(d) / f"cat_{mood}.png"
            svg.write_text(build_svg(mood), encoding="utf-8")
            subprocess.run(["resvg", "--width", str(PX), "--height", str(PX),
                            str(svg), str(png)], check=True)
            subprocess.run(["python3", str(LVGLIMAGE), "--ofmt", "C",
                            "--cf", "RGB565A8", "--premultiply", "--align", "16",
                            "-o", str(HERE), "--name", f"cat_{mood}", str(png)], check=True)
        print(f"wrote cat_{mood}.c ({PX}x{PX} RGB565A8)")

if __name__ == "__main__":
    main()
