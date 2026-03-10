from PIL import Image, ImageDraw
import os

out_dir = os.path.join(os.path.dirname(__file__), 'extension', 'icons')
os.makedirs(out_dir, exist_ok=True)

sizes = [16, 48, 128]

for size in sizes:
    # Work at 4x for antialiasing, then downscale
    ss = size * 4
    img = Image.new('RGBA', (ss, ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    r = int(ss * 0.18)  # corner radius

    # Background — rounded rect with gradient approximation
    # Use a solid violet-900 to indigo-950 blend
    draw.rounded_rectangle([0, 0, ss - 1, ss - 1], radius=r, fill=(30, 27, 75))  # indigo-950

    # Overlay gradient effect with semi-transparent layer
    overlay = Image.new('RGBA', (ss, ss), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([0, 0, ss - 1, ss - 1], radius=r, fill=(76, 29, 149, 120))  # violet-900 semi
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    # Wand — diagonal line from bottom-left to top-right
    lw = max(4, int(ss * 0.06))
    x1, y1 = int(ss * 0.28), int(ss * 0.72)
    x2, y2 = int(ss * 0.72), int(ss * 0.28)
    draw.line([(x1, y1), (x2, y2)], fill=(167, 139, 250), width=lw)  # violet-400

    # Sparkle at wand tip
    cx, cy = x2, y2
    sp = max(6, int(ss * 0.12))
    slw = max(2, int(ss * 0.04))
    sparkle_color = (233, 213, 255)  # violet-200

    # Cross sparkle
    draw.line([(cx, cy - sp), (cx, cy + sp)], fill=sparkle_color, width=slw)
    draw.line([(cx - sp, cy), (cx + sp, cy)], fill=sparkle_color, width=slw)

    # Diagonal sparkle
    ds = int(sp * 0.7)
    draw.line([(cx - ds, cy - ds), (cx + ds, cy + ds)], fill=sparkle_color, width=slw)
    draw.line([(cx + ds, cy - ds), (cx - ds, cy + ds)], fill=sparkle_color, width=slw)

    # Small mid-shaft sparkle for larger sizes
    if size >= 48:
        mx, my = int(ss * 0.45), int(ss * 0.55)
        ms = int(sp * 0.5)
        mslw = max(2, int(ss * 0.03))
        mid_color = (196, 181, 253)  # violet-300
        draw.line([(mx, my - ms), (mx, my + ms)], fill=mid_color, width=mslw)
        draw.line([(mx - ms, my), (mx + ms, my)], fill=mid_color, width=mslw)

    # Downscale with antialiasing
    final = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(out_dir, f'{size}.png')
    final.save(path)
    print(f'✓ {size}x{size} → {path}')

print('Icons generated.')
