#!/usr/bin/env python3
"""Generate assets/vault-banner.gif — the README banner.

Self-contained dark "card" banner that reads on both light and dark README
backgrounds. Horizontal flow: sources (Obsidian/Web) -> VAULT -> AIs
(Claude/Cursor/ChatGPT). Each frame is rendered as a static SVG (the animation
state is computed per frame) so the loop is seamless and needs no browser.

Deps:  pip install cairosvg Pillow
Run:   python scripts/gen-banner.py
"""
import io, os
import cairosvg
from PIL import Image

W, H = 1200, 300
N = 40            # frames
D = 2.0           # loop seconds
FPS_MS = int(1000 * D / N)

BG_TOP = "#0e1422"
BG_BOT = "#1a2438"
GRID   = "#9fb2d0"
CYAN   = "#3ad4e0"
PURPLE = "#ab8df6"
NODE_S = "#6b7c9c"
NODE_F = "#141d2e"
TXT    = "#cdd8ea"
MUTED  = "#8497b6"

SRC_X = 215
OBS = (SRC_X, 110)
WEB = (SRC_X, 196)
VAULT = (600, 150)
AI_X = 1000
CLAUDE  = (AI_X, 84)
CURSOR  = (AI_X, 150)
CHATGPT = (AI_X, 216)

DASH = 12  # "6 6" pattern period


def wire(p1, p2, phase, frame):
    off = -DASH * (frame / N) - phase
    return (f'<line x1="{p1[0]}" y1="{p1[1]}" x2="{p2[0]}" y2="{p2[1]}" '
            f'stroke="{CYAN}" stroke-width="2" stroke-opacity="0.85" '
            f'stroke-dasharray="6 6" stroke-dashoffset="{off:.2f}" stroke-linecap="round"/>')


def source_node(cx, cy, label):
    w, h = 128, 46
    x, y = cx - w / 2, cy - h / 2
    return f'''<g>
      <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{NODE_F}" stroke="{NODE_S}" stroke-width="1.4"/>
      <circle cx="{x+22}" cy="{cy}" r="6" fill="none" stroke="{PURPLE}" stroke-width="1.8"/>
      <text x="{x+44}" y="{cy+4}" font-family="monospace" font-size="14" font-weight="bold" fill="{TXT}">{label}</text>
    </g>'''


def ai_node(cx, cy, label):
    r = 31
    return f'''<g>
      <circle cx="{cx}" cy="{cy}" r="{r}" fill="{NODE_F}" stroke="{NODE_S}" stroke-width="1.4"/>
      <text x="{cx}" y="{cy+3}" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="{TXT}">{label}</text>
    </g>'''


def vault(cx, cy, frame):
    bw, bh = 96, 118
    x, y = cx - bw / 2, cy - bh / 2
    cards = ""
    for i, op in ((2, 0.45), (1, 0.7)):
        cards += (f'<rect x="{x - i*5 + 6}" y="{y - i*5 + 6}" width="{bw}" height="{bh}" rx="8" '
                  f'fill="{NODE_F}" stroke="{CYAN}" stroke-width="1" stroke-opacity="{op}"/>')
    body = f'''
      {cards}
      <rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="8" fill="{NODE_F}" stroke="{CYAN}" stroke-width="1.8"/>
      <text x="{x+14}" y="{y+24}" font-family="monospace" font-size="14" font-weight="bold" fill="{CYAN}">#</text>
      <line x1="{x+30}" y1="{y+20}" x2="{x+bw-14}" y2="{y+20}" stroke="{MUTED}" stroke-width="1.2" stroke-opacity="0.55"/>
      <line x1="{x+14}" y1="{y+40}" x2="{x+bw-14}" y2="{y+40}" stroke="{MUTED}" stroke-width="1.2" stroke-opacity="0.4"/>
      <line x1="{x+14}" y1="{y+54}" x2="{x+bw-22}" y2="{y+54}" stroke="{MUTED}" stroke-width="1.2" stroke-opacity="0.4"/>
      <line x1="{x+14}" y1="{y+68}" x2="{x+bw-16}" y2="{y+68}" stroke="{MUTED}" stroke-width="1.2" stroke-opacity="0.4"/>
      <text x="{cx}" y="{y+bh-14}" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="{CYAN}" letter-spacing="2">VAULT</text>'''
    ripples = ""
    for k in range(3):
        local = ((frame / N) + k / 3) % 1.0
        rr = 64 + 46 * local
        op = 0.5 * (1 - local)
        ripples += (f'<circle cx="{cx}" cy="{cy}" r="{rr:.1f}" fill="none" '
                    f'stroke="{CYAN}" stroke-width="1.4" stroke-opacity="{op:.3f}"/>')
    return f'<g>{ripples}{body}</g>'


def build_svg(frame):
    w1 = wire((OBS[0] + 64, OBS[1]), (552, 138), 0, frame)
    w2 = wire((WEB[0] + 64, WEB[1]), (552, 162), 6, frame)
    w3 = wire((648, 142), (CLAUDE[0] - 31, CLAUDE[1]), 3, frame)
    w4 = wire((648, 150), (CURSOR[0] - 31, CURSOR[1]), 9, frame)
    w5 = wire((648, 158), (CHATGPT[0] - 31, CHATGPT[1]), 1, frame)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="{H}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{BG_TOP}"/>
      <stop offset="100%" stop-color="{BG_BOT}"/>
    </linearGradient>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M28 0 L0 0 0 28" fill="none" stroke="{GRID}" stroke-width="1" stroke-opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#bg)"/>
  <rect width="{W}" height="{H}" fill="url(#grid)"/>
  <text x="{W/2}" y="40" text-anchor="middle" font-family="monospace" font-size="13" fill="{MUTED}" letter-spacing="5">ONE VAULT &#183; EDITED FROM ANYWHERE</text>
  {w1}{w2}{w3}{w4}{w5}
  {source_node(*OBS, "OBSIDIAN")}
  {source_node(*WEB, "WEB")}
  {vault(*VAULT, frame)}
  {ai_node(*CLAUDE, "CLAUDE")}
  {ai_node(*CURSOR, "CURSOR")}
  {ai_node(*CHATGPT, "CHATGPT")}
</svg>'''


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(repo_root, "assets", "vault-banner.gif")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    frames = []
    for frame in range(N):
        png = cairosvg.svg2png(bytestring=build_svg(frame).encode(),
                               output_width=W, output_height=H)
        frames.append(Image.open(io.BytesIO(png)).convert("RGB"))

    pal = frames[0].convert("P", palette=Image.ADAPTIVE, colors=128)
    qframes = [f.quantize(palette=pal, dither=Image.FLOYDSTEINBERG) for f in frames]
    qframes[0].save(out, save_all=True, append_images=qframes[1:], loop=0,
                    duration=FPS_MS, disposal=1, optimize=True)
    print("wrote", out, "frames", N, "ms/frame", FPS_MS)


if __name__ == "__main__":
    main()
