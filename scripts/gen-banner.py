#!/usr/bin/env python3
"""Generate assets/vault-banner.gif — the README banner.

Self-contained dark "card" banner that reads on both light and dark README
backgrounds. Hero split: the headline "Your notes are your AI's memory." on the
left, a compact flow diagram on the right (sources -> VAULT -> AIs). Brand
texture: soft purple/cyan glows, faint grid, wire-trace lines. Each frame is a
static SVG (animation state computed per frame) so the loop is seamless and
needs no browser.

Deps:  pip install cairosvg Pillow
Run:   python scripts/gen-banner.py
"""
import io, os
import cairosvg
from PIL import Image

W, H = 1200, 340
N = 40            # frames
D = 2.0           # loop seconds
FPS_MS = int(1000 * D / N)

BG_TOP = "#0e1422"
BG_BOT = "#1a2438"
GRID   = "#9fb2d0"
CYAN   = "#3ad4e0"
PURPLE = "#b495f7"
NODE_S = "#6b7c9c"
NODE_F = "#141d2e"
TXT    = "#eef3fb"
SUB    = "#a6b4ce"
MUTED  = "#8497b6"

# --- diagram anchors (right half) ---
OBS = (650, 138)
WEB = (650, 222)
VAULT = (865, 180)
AI_X = 1098
CLAUDE  = (AI_X, 126)
CURSOR  = (AI_X, 180)
CHATGPT = (AI_X, 234)

DASH = 12  # "6 6" pattern period


def wire(p1, p2, color, phase, frame):
    off = -DASH * (frame / N) - phase
    return (f'<line x1="{p1[0]}" y1="{p1[1]}" x2="{p2[0]}" y2="{p2[1]}" '
            f'stroke="{color}" stroke-width="2" stroke-opacity="0.9" '
            f'stroke-dasharray="6 6" stroke-dashoffset="{off:.2f}" stroke-linecap="round"/>')


def source_node(cx, cy, label):
    w, h = 112, 40
    x, y = cx - w / 2, cy - h / 2
    return f'''<g>
      <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{NODE_F}" stroke="{PURPLE}" stroke-width="1.4" stroke-opacity="0.8"/>
      <circle cx="{x+19}" cy="{cy}" r="5" fill="none" stroke="{PURPLE}" stroke-width="1.8"/>
      <text x="{x+36}" y="{cy+4}" font-family="monospace" font-size="12" font-weight="bold" fill="{TXT}">{label}</text>
    </g>'''


def ai_node(cx, cy, label):
    r = 27
    return f'''<g>
      <circle cx="{cx}" cy="{cy}" r="{r}" fill="{NODE_F}" stroke="{CYAN}" stroke-width="1.4" stroke-opacity="0.85"/>
      <text x="{cx}" y="{cy+3}" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="{TXT}">{label}</text>
    </g>'''


def vault(cx, cy, frame):
    bw, bh = 80, 104
    x, y = cx - bw / 2, cy - bh / 2
    cards = ""
    for i, op in ((2, 0.4), (1, 0.65)):
        cards += (f'<rect x="{x - i*5 + 5}" y="{y - i*5 + 5}" width="{bw}" height="{bh}" rx="7" '
                  f'fill="{NODE_F}" stroke="{CYAN}" stroke-width="1" stroke-opacity="{op}"/>')
    body = f'''
      {cards}
      <rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="7" fill="{NODE_F}" stroke="{CYAN}" stroke-width="1.8"/>
      <text x="{x+12}" y="{y+22}" font-family="monospace" font-size="13" font-weight="bold" fill="{CYAN}">#</text>
      <line x1="{x+26}" y1="{y+18}" x2="{x+bw-12}" y2="{y+18}" stroke="{MUTED}" stroke-width="1.1" stroke-opacity="0.5"/>
      <line x1="{x+12}" y1="{y+36}" x2="{x+bw-12}" y2="{y+36}" stroke="{MUTED}" stroke-width="1.1" stroke-opacity="0.38"/>
      <line x1="{x+12}" y1="{y+48}" x2="{x+bw-20}" y2="{y+48}" stroke="{MUTED}" stroke-width="1.1" stroke-opacity="0.38"/>
      <line x1="{x+12}" y1="{y+60}" x2="{x+bw-14}" y2="{y+60}" stroke="{MUTED}" stroke-width="1.1" stroke-opacity="0.38"/>
      <text x="{cx}" y="{y+bh-12}" text-anchor="middle" font-family="monospace" font-size="11.5" font-weight="bold" fill="{CYAN}" letter-spacing="1.5">VAULT</text>'''
    ripples = ""
    for k in range(3):
        local = ((frame / N) + k / 3) % 1.0
        rr = 56 + 40 * local
        op = 0.45 * (1 - local)
        ripples += (f'<circle cx="{cx}" cy="{cy}" r="{rr:.1f}" fill="none" '
                    f'stroke="{CYAN}" stroke-width="1.3" stroke-opacity="{op:.3f}"/>')
    return f'<g>{ripples}{body}</g>'


def build_svg(frame):
    # input wires: sources -> vault (purple)
    wa = wire((OBS[0] + 56, OBS[1]), (VAULT[0] - 46, 168), PURPLE, 0, frame)
    wb = wire((WEB[0] + 56, WEB[1]), (VAULT[0] - 46, 192), PURPLE, 6, frame)
    # output wires: vault -> AIs (cyan)
    wc = wire((VAULT[0] + 46, 172), (CLAUDE[0] - 27, CLAUDE[1]),  CYAN, 3, frame)
    wd = wire((VAULT[0] + 46, 180), (CURSOR[0] - 27, CURSOR[1]),  CYAN, 9, frame)
    we = wire((VAULT[0] + 46, 188), (CHATGPT[0] - 27, CHATGPT[1]),CYAN, 1, frame)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="{W}" y2="{H}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{BG_TOP}"/>
      <stop offset="100%" stop-color="{BG_BOT}"/>
    </linearGradient>
    <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M30 0 L0 0 0 30" fill="none" stroke="{GRID}" stroke-width="1" stroke-opacity="0.04"/>
    </pattern>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#bg)"/>
  <rect width="{W}" height="{H}" fill="url(#grid)"/>

  <text x="60" y="112" font-family="monospace" font-size="14" font-weight="bold" fill="{CYAN}" letter-spacing="4">AI MEMORY LAYER</text>
  <text x="58" y="170" font-family="sans-serif" font-size="46" font-weight="bold" fill="{TXT}">Your notes are</text>
  <text x="58" y="222" font-family="sans-serif" font-size="46" font-weight="bold" fill="{TXT}">your AI's <tspan fill="{CYAN}">memory.</tspan></text>
  <text x="60" y="268" font-family="sans-serif" font-size="16.5" fill="{SUB}">Both you and your AI can read and edit</text>
  <text x="60" y="291" font-family="sans-serif" font-size="16.5" fill="{SUB}">your notes &#8212; from anywhere.</text>

  {wa}{wb}{wc}{wd}{we}
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
