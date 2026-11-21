// Generates src/assets/og/specks.png (DESIGN.md section 8.2, OG version): a transparent 470 x 263
// PNG of paper-coloured (#F6F7F4) specks, laid over the stamp in the OG image because Satori has no
// SVG filters. Same density rules as the canvas card (w x h / 260 dots, radius 0.6–2.2 scaled by
// w/691, alpha 0.35–1, plus 24 edge-wear voids). Fixed seed. Run: node src/assets/og/make-specks.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const W = 470;
const H = 263;
const PAPER = [0xf6, 0xf7, 0xf4];
const k = W / 691;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5eed);
const alpha = new Float32Array(W * H);

function dot(cx, cy, r, a) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cover = Math.max(0, Math.min(1, r + 0.5 - d)); // 1px anti-aliased edge
      if (cover <= 0) continue;
      const i = y * W + x;
      alpha[i] = 1 - (1 - alpha[i]) * (1 - cover * a);
    }
  }
}

const count = Math.round((W * H) / 260);
for (let i = 0; i < count; i++) dot(rand() * W, rand() * H, (0.6 + rand() * 1.6) * k, 0.35 + rand() * 0.65);

// Edge wear: 24 voids within 0.06w of the border.
const band = 0.06 * W;
const per = 2 * (W + H);
for (let i = 0; i < 24; i++) {
  let d = rand() * per;
  const inward = rand() * band;
  const r = (2 + rand() * 3) * k;
  let x;
  let y;
  if (d < W) [x, y] = [d, inward];
  else if ((d -= W) < H) [x, y] = [W - inward, d];
  else if ((d -= H) < W) [x, y] = [W - d, H - inward];
  else [x, y] = [inward, H - (d - W)];
  dot(x, y, r, 1);
}

// RGBA scanlines, filter type 0.
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  const row = y * (W * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < W; x++) {
    const o = row + 1 + x * 4;
    raw[o] = PAPER[0];
    raw[o + 1] = PAPER[1];
    raw[o + 2] = PAPER[2];
    raw[o + 3] = Math.round(alpha[y * W + x] * 255);
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "specks.png");
writeFileSync(out, png);
process.stdout.write(`${out} ${png.length} bytes\n`);
