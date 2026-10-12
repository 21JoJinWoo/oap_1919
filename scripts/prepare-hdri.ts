// Prepares an equirectangular Radiance .hdr for the scene:
//   - rotates it so the sun sits at the requested compass azimuth,
//   - writes a small HDR for image-based lighting (data/env/<name>-env.hdr),
//   - writes a tone-mapped sky backdrop (data/env/<name>-sky.webp),
//   - prints the sun direction, sun colour and horizon colour as JSON.
//
//   npx tsx scripts/prepare-hdri.ts <in.hdr> [--azimuth 205.1] [--env-width 1024]
//
// World convention: -Z is north, +X is east, azimuth is clockwise from north.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
if (!input) {
  console.error('usage: npx tsx scripts/prepare-hdri.ts <in.hdr> [--azimuth deg] [--env-width px]');
  process.exit(1);
}
const targetAzimuth = opt('azimuth', 205.1);
const envWidth = opt('env-width', 1024);

// ---------- Radiance RGBE decode (flat or new-style RLE scanlines) ----------
function readHdr(buf: Buffer): { w: number; h: number; data: Float32Array } {
  let pos = 0;
  const line = () => {
    const start = pos;
    while (buf[pos] !== 0x0a) pos++;
    return buf.toString('ascii', start, pos++);
  };
  if (!line().startsWith('#?')) throw new Error('not a Radiance HDR file');
  for (let l = line(); l !== ''; l = line()) {
    if (l.startsWith('FORMAT=') && l !== 'FORMAT=32-bit_rle_rgbe') throw new Error(`unsupported ${l}`);
  }
  const m = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!m) throw new Error('unsupported HDR orientation');
  const h = Number(m[1]), w = Number(m[2]);
  const data = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (w >= 8 && w < 0x8000 && buf[pos] === 2 && buf[pos + 1] === 2 && (buf[pos + 2] & 0x80) === 0) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = buf[pos++];
          if (n > 128) {
            n -= 128;
            const v = buf[pos++];
            while (n--) scan[(x++) * 4 + c] = v;
          } else {
            while (n--) scan[(x++) * 4 + c] = buf[pos++];
          }
        }
      }
    } else {
      for (let x = 0; x < w * 4; x++) scan[x] = buf[pos++];
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0;
      const o = (y * w + x) * 3;
      data[o] = scan[x * 4] * f;
      data[o + 1] = scan[x * 4 + 1] * f;
      data[o + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { w, h, data };
}

function writeHdr(w: number, h: number, data: Float32Array): Buffer {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii');
  const body = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const v = Math.max(r, g, b);
    if (v < 1e-32) continue;
    const e = Math.ceil(Math.log2(v) + 1e-9);
    const s = 256 / Math.pow(2, e);
    body[i * 4] = Math.min(255, Math.floor(r * s));
    body[i * 4 + 1] = Math.min(255, Math.floor(g * s));
    body[i * 4 + 2] = Math.min(255, Math.floor(b * s));
    body[i * 4 + 3] = e + 128;
  }
  return Buffer.concat([header, body]);
}

const lum = (d: Float32Array, i: number) => 0.2126 * d[i * 3] + 0.7152 * d[i * 3 + 1] + 0.0722 * d[i * 3 + 2];

const src = readHdr(readFileSync(input));
const { w, h } = src;

// ---------- find the sun: brightest pixel of a 1/8 downsample ----------
const ds = 8;
let best = -1, sunX = 0, sunY = 0;
for (let by = 0; by < h / ds; by++)
  for (let bx = 0; bx < w / ds; bx++) {
    let s = 0;
    for (let y = 0; y < ds; y++) for (let x = 0; x < ds; x++) s += lum(src.data, (by * ds + y) * w + bx * ds + x);
    if (s > best) [best, sunX, sunY] = [s, bx * ds + ds / 2, by * ds + ds / 2];
  }

// Equirect u -> three.js direction angle phi = atan2(z, x); azimuth A (cw from north, -Z) has phi = atan2(-cos A, sin A).
const rad = Math.PI / 180;
const phiTarget = Math.atan2(-Math.cos(targetAzimuth * rad), Math.sin(targetAzimuth * rad));
const targetX = Math.round(((phiTarget / (2 * Math.PI) + 0.5) % 1) * w);
const shift = (((targetX - sunX) % w) + w) % w;
const rot = new Float32Array(src.data.length);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const d = (y * w + ((x + shift) % w)) * 3, s = (y * w + x) * 3;
    rot[d] = src.data[s];
    rot[d + 1] = src.data[s + 1];
    rot[d + 2] = src.data[s + 2];
  }
const elevation = (0.5 - sunY / h) * 180;

// Sun colour: mean of the brightest 3x3 block around the sun, normalised.
let sr = 0, sg = 0, sb = 0;
for (let y = -ds; y <= ds; y++)
  for (let x = -ds; x <= ds; x++) {
    const i = ((sunY + y) * w + ((targetX + x + w) % w)) * 3;
    sr += rot[i];
    sg += rot[i + 1];
    sb += rot[i + 2];
  }
const sm = Math.max(sr, sg, sb);

// ---------- exposure: put the median sky (upper hemisphere, sun excluded) at 0.5 ----------
const skyL: number[] = [];
for (let y = 0; y < h / 2; y += 4) for (let x = 0; x < w; x += 4) skyL.push(lum(rot, y * w + x));
skyL.sort((a, b) => a - b);
const exposure = 0.5 / skyL[Math.floor(skyL.length / 2)];

// ---------- tone-mapped sky backdrop (ACES fit, Narkowicz 2015) ----------
const aces = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
const srgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const ldr = Buffer.alloc(w * h * 3);
for (let i = 0; i < w * h * 3; i++) ldr[i] = Math.round(srgb(aces(rot[i] * exposure)) * 255);

// Horizon colour (rows just above the horizon), as the fog colour.
let hr = 0, hg = 0, hb = 0, hn = 0;
for (let y = Math.floor(h * 0.44); y < Math.floor(h * 0.49); y++)
  for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 3;
    hr += ldr[i];
    hg += ldr[i + 1];
    hb += ldr[i + 2];
    hn++;
  }
const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// ---------- small HDR for lighting (box downsample) ----------
const f = Math.max(1, Math.round(w / envWidth));
const ew = Math.floor(w / f), eh = Math.floor(h / f);
const env = new Float32Array(ew * eh * 3);
for (let y = 0; y < eh; y++)
  for (let x = 0; x < ew; x++)
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) s += rot[((y * f + yy) * w + x * f + xx) * 3 + c];
      env[(y * ew + x) * 3 + c] = s / (f * f);
    }

const outDir = resolve(import.meta.dirname, '..', process.env.DATA_DIR ?? 'data', 'env');
mkdirSync(outDir, { recursive: true });
const name = basename(input, extname(input)).replace(/[^\w-]+/g, '-');
writeFileSync(join(outDir, `${name}-env.hdr`), writeHdr(ew, eh, env));
await sharp(ldr, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 88 }).toFile(join(outDir, `${name}-sky.webp`));

// Sun direction in world space (for the directional light).
const el = elevation * rad, az = targetAzimuth * rad;
console.log(
  JSON.stringify(
    {
      hdr: `/env/${name}-env.hdr`,
      sky: `/env/${name}-sky.webp`,
      sunElevationDeg: +elevation.toFixed(1),
      sunAzimuthDeg: targetAzimuth,
      sunDirection: [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)].map((v) => +v.toFixed(4)),
      sunColor: hex((sr / sm) * 255, (sg / sm) * 255, (sb / sm) * 255),
      horizonColor: hex(hr / hn, hg / hn, hb / hn),
      exposure: +exposure.toFixed(4),
    },
    null,
    2,
  ),
);
