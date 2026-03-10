import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'extension', 'icons');
mkdirSync(outDir, { recursive: true });

function lerp(a, b, t) { return a + (b - a) * t; }

function generateIcon(size) {
  const png = new PNG({ width: size, height: size });
  const r = size * 0.18;
  const c1 = [124, 58, 237], c2 = [76, 29, 149], white = [255, 255, 255];

  function inRoundedRect(x, y) {
    return x >= 0 && x < size && y >= 0 && y < size &&
      !((x < r && y < r && Math.hypot(x - r, y - r) > r) ||
        (x > size - r && y < r && Math.hypot(x - (size - r), y - r) > r) ||
        (x < r && y > size - r && Math.hypot(x - r, y - (size - r)) > r) ||
        (x > size - r && y > size - r && Math.hypot(x - (size - r), y - (size - r)) > r));
  }

  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  const cx = size / 2, cy = size / 2, s = size * 0.28;
  const lw = Math.max(1, size * 0.05);
  const wx1 = cx - s * 0.8, wy1 = cy + s * 0.8, wx2 = cx + s * 0.3, wy2 = cy - s * 0.3;
  const tx = cx + s * 0.5, ty = cy - s * 0.5, sp = size * 0.16;
  const sw = Math.max(1, size * 0.035);
  const sparkles = [
    [tx, ty - sp, tx, ty + sp], [tx - sp, ty, tx + sp, ty],
    [tx - sp * 0.6, ty - sp * 0.6, tx + sp * 0.6, ty + sp * 0.6],
    [tx + sp * 0.6, ty - sp * 0.6, tx - sp * 0.6, ty + sp * 0.6],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (!inRoundedRect(x, y)) { png.data[idx] = png.data[idx+1] = png.data[idx+2] = png.data[idx+3] = 0; continue; }
      const t = (x + y) / (2 * size);
      let pr = lerp(c1[0], c2[0], t), pg = lerp(c1[1], c2[1], t), pb = lerp(c1[2], c2[2], t);
      const wd = distToSeg(x, y, wx1, wy1, wx2, wy2);
      if (wd < lw) { const a = 1 - wd / lw; pr = lerp(pr, 255, a); pg = lerp(pg, 255, a); pb = lerp(pb, 255, a); }
      for (const [sx1, sy1, sx2, sy2] of sparkles) {
        const d = distToSeg(x, y, sx1, sy1, sx2, sy2);
        if (d < sw) { const a = 1 - d / sw; pr = lerp(pr, 255, a); pg = lerp(pg, 255, a); pb = lerp(pb, 255, a); }
      }
      png.data[idx] = Math.round(pr); png.data[idx+1] = Math.round(pg); png.data[idx+2] = Math.round(pb); png.data[idx+3] = 255;
    }
  }
  writeFileSync(join(outDir, `${size}.png`), PNG.sync.write(png));
  console.log(`  ✓ ${size}x${size}`);
}

console.log('Generating icons...');
[16, 48, 128].forEach(generateIcon);
console.log('Done.');
