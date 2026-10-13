// Converts a photo-scanned PBR texture set (e.g. Poly Haven, ambientCG) into GPU-compressed
// KTX2 maps for a tiled surface (scene object `surface`).
//
//   npx tsx scripts/prepare-surface.ts <name> <diffuse> <normal-gl> [<ao> <roughness>]
//
// Writes data/env/<name>-color.ktx2 (sRGB), -normal.ktx2 (OpenGL convention) and, with AO and
// roughness, -orm.ktx2 (occlusion in R, roughness in G, as glTF packs them). UASTC + Zstandard,
// with mipmaps. A 4096 px map takes roughly 10–20 minutes to encode.

import { encodeToKTX2 } from 'ktx2-encoder';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const [name, diffuse, normal, ao, rough] = process.argv.slice(2);
if (!name || !diffuse || !normal || (ao && !rough)) {
  console.error('usage: npx tsx scripts/prepare-surface.ts <name> <diffuse> <normal-gl> [<ao> <roughness>]');
  process.exit(1);
}
const outDir = resolve(import.meta.dirname, '..', process.env.DATA_DIR ?? 'data', 'env');

const decode = async (b: Uint8Array) => {
  const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

async function encode(kind: string, png: Buffer, opts: Record<string, unknown>) {
  const t = Date.now();
  const ktx = await encodeToKTX2(new Uint8Array(png), {
    isUASTC: true,
    generateMipmap: true,
    needSupercompression: true,
    enableRDO: true,
    imageDecoder: decode,
    ...opts,
  } as Parameters<typeof encodeToKTX2>[1]);
  const file = join(outDir, `${name}-${kind}.ktx2`);
  writeFileSync(file, ktx);
  console.log(`${file}: ${(ktx.byteLength / 1e6).toFixed(1)}MB, ${Math.round((Date.now() - t) / 1000)}s`);
}

async function orm(): Promise<Buffer> {
  const a = await sharp(ao).greyscale().raw().toBuffer({ resolveWithObject: true });
  const r = await sharp(rough).greyscale().resize(a.info.width, a.info.height).raw().toBuffer();
  const rgb = Buffer.alloc(a.data.length * 3);
  for (let i = 0; i < a.data.length; i++) {
    rgb[i * 3] = a.data[i];
    rgb[i * 3 + 1] = r[i];
  }
  return sharp(rgb, { raw: { width: a.info.width, height: a.info.height, channels: 3 } }).png().toBuffer();
}

await Promise.all([
  encode('color', await sharp(diffuse).png().toBuffer(), { isSetKTX2SRGBTransferFunc: true, isPerceptual: true, rdoQualityLevel: 1 }),
  encode('normal', await sharp(normal).png().toBuffer(), { isNormalMap: true, isSetKTX2SRGBTransferFunc: false, isPerceptual: false, rdoQualityLevel: 0.5 }),
  ...(ao ? [encode('orm', await orm(), { isSetKTX2SRGBTransferFunc: false, isPerceptual: false, rdoQualityLevel: 1 })] : []),
]);
