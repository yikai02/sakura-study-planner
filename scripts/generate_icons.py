import os
import math
from PIL import Image, ImageDraw, ImageFont

os.makedirs("icons", exist_ok=True)

# Generate SVG
svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFF0F3"/>
      <stop offset="100%" stop-color="#FCECEF"/>
    </linearGradient>
    <linearGradient id="petalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF9EAF"/>
      <stop offset="100%" stop-color="#DF768B"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#A64458" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="96" fill="none" stroke="#F7D6DD" stroke-width="6"/>
  <g transform="translate(256, 245)" filter="url(#shadow)">
    <!-- 5 Sakura Petals -->
    <path d="M 0 -130 C 35 -145, 60 -110, 35 -70 C 20 -40, 0 0, 0 0 C 0 0, -20 -40, -35 -70 C -60 -110, -35 -145, 0 -130 Z" fill="url(#petalGrad)"/>
    <path d="M 0 -130 C 35 -145, 60 -110, 35 -70 C 20 -40, 0 0, 0 0 C 0 0, -20 -40, -35 -70 C -60 -110, -35 -145, 0 -130 Z" fill="url(#petalGrad)" transform="rotate(72)"/>
    <path d="M 0 -130 C 35 -145, 60 -110, 35 -70 C 20 -40, 0 0, 0 0 C 0 0, -20 -40, -35 -70 C -60 -110, -35 -145, 0 -130 Z" fill="url(#petalGrad)" transform="rotate(144)"/>
    <path d="M 0 -130 C 35 -145, 60 -110, 35 -70 C 20 -40, 0 0, 0 0 C 0 0, -20 -40, -35 -70 C -60 -110, -35 -145, 0 -130 Z" fill="url(#petalGrad)" transform="rotate(216)"/>
    <path d="M 0 -130 C 35 -145, 60 -110, 35 -70 C 20 -40, 0 0, 0 0 C 0 0, -20 -40, -35 -70 C -60 -110, -35 -145, 0 -130 Z" fill="url(#petalGrad)" transform="rotate(288)"/>
    <!-- Blossom Center Pistil -->
    <circle cx="0" cy="0" r="28" fill="#FFF8F9"/>
    <circle cx="0" cy="0" r="16" fill="#FCECEF" stroke="#DF768B" stroke-width="3"/>
  </g>
  <text x="256" y="445" font-family="-apple-system, sans-serif" font-weight="bold" font-size="38" text-anchor="middle" fill="#A64458" letter-spacing="4">小櫻讀書</text>
</svg>"""

with open("icons/icon.svg", "w", encoding="utf-8") as f:
    f.write(svg_content)

def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Scale helper
    scale = size / 512.0
    
    # Background rounded rect
    bg_color = (252, 236, 239, 255)
    border_color = (247, 214, 221, 255)
    corner_radius = int(112 * scale)
    
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner_radius, fill=bg_color, outline=border_color, width=max(1, int(4 * scale)))
    
    # Center position
    cx, cy = size / 2.0, size * 0.47
    petal_len = 120.0 * scale
    
    # Draw 5 petals
    for i in range(5):
        angle = math.radians(i * 72 - 90)
        # Petal center line
        tip_x = cx + math.cos(angle) * petal_len
        tip_y = cy + math.sin(angle) * petal_len
        
        # Draw soft petal ellipse rotated
        petal_w = int(45 * scale)
        petal_h = int(75 * scale)
        
        # Center of petal blob
        p_cx = cx + math.cos(angle) * (petal_len * 0.58)
        p_cy = cy + math.sin(angle) * (petal_len * 0.58)
        
        draw.ellipse([p_cx - petal_w, p_cy - petal_h, p_cx + petal_w, p_cy + petal_h], fill=(223, 118, 139, 240))

    # Center circle
    core_r = int(24 * scale)
    draw.ellipse([cx - core_r, cy - core_r, cx + core_r, cy + core_r], fill=(255, 245, 247, 255), outline=(166, 68, 88, 255), width=max(1, int(3 * scale)))

    return img

draw_icon(512).save("icons/icon-512.png", "PNG")
draw_icon(192).save("icons/icon-192.png", "PNG")
draw_icon(180).save("icons/apple-touch-icon.png", "PNG")
print("Icons successfully created!")
