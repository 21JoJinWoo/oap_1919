import { type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, instance, meshopt, prune, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { ktx2 } from 'ktx2-encoder/gltf-transform';

export interface OptimizeOptions {
  /** Longest texture edge after resizing. */
  maxTextureSize: number;
  /** Meshes above this many triangles (per file) are simplified towards it. */
  maxTriangles: number;
  /**
   * 'webp': small downloads, but textures sit uncompressed in GPU memory (4 bytes / texel).
   * 'ktx2': Basis UASTC, transcoded to a GPU block format (1 byte / texel), so 4K maps stay affordable.
   */
  textureFormat?: 'webp' | 'ktx2';
}

export const DEFAULT_OPTIONS: OptimizeOptions = {
  maxTextureSize: Number(process.env.MAX_TEXTURE_SIZE ?? 2048),
  maxTriangles: Number(process.env.MAX_TRIANGLES ?? 150_000),
  textureFormat: process.env.TEXTURE_FORMAT === 'ktx2' ? 'ktx2' : 'webp',
};

/** Raw RGBA decode for the Basis encoder. */
async function decodeImage(buffer: Uint8Array) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

/** UASTC with rate-distortion tuning and Zstandard; colour maps in sRGB, data maps linear. */
function ktx2Textures() {
  const common = { isUASTC: true, generateMipmap: true, needSupercompression: true, enableRDO: true, imageDecoder: decodeImage };
  return [
    ktx2({ ...common, slots: /^(baseColorTexture|emissiveTexture)$/, isSetKTX2SRGBTransferFunc: true, isPerceptual: true, rdoQualityLevel: 1 }),
    ktx2({ ...common, slots: /^normalTexture$/, isNormalMap: true, isSetKTX2SRGBTransferFunc: false, isPerceptual: false, rdoQualityLevel: 0.5 }),
    ktx2({ ...common, isSetKTX2SRGBTransferFunc: false, isPerceptual: false, rdoQualityLevel: 1 }),
  ];
}

let ioPromise: Promise<NodeIO> | null = null;
function getIO(): Promise<NodeIO> {
  ioPromise ??= (async () => {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
  })();
  return ioPromise;
}

export function countTriangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // TRIANGLES
      const idx = prim.getIndices();
      n += Math.floor((idx ? idx.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0)) / 3);
    }
  }
  return n;
}

/**
 * Web-delivery pipeline for generated GLBs (e.g. Tripo AI output):
 * dedup → instance → weld → simplify (only above the triangle budget) → prune
 * → resample → textures capped at `maxTextureSize` (WebP or KTX2) → Meshopt compression.
 * The result loads with three.js GLTFLoader + MeshoptDecoder (+ KTX2Loader).
 */
export async function optimizeGlb(
  input: Uint8Array,
  opts: OptimizeOptions = DEFAULT_OPTIONS,
): Promise<{ glb: Uint8Array; originalTriangles: number; triangles: number }> {
  const io = await getIO();
  const doc = await io.readBinary(input);
  const originalTriangles = countTriangles(doc);

  await doc.transform(dedup(), instance({ min: 2 }), weld());
  if (originalTriangles > opts.maxTriangles) {
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: opts.maxTriangles / originalTriangles, error: 0.001 }),
    );
  }
  const useKtx2 = opts.textureFormat === 'ktx2';
  await doc.transform(
    prune(),
    resample(),
    useKtx2
      ? textureCompress({ encoder: sharp, targetFormat: 'png', resize: [opts.maxTextureSize, opts.maxTextureSize] })
      : textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [opts.maxTextureSize, opts.maxTextureSize], quality: 85 }),
    ...(useKtx2 ? ktx2Textures() : []),
    // 14-bit texture coordinates keep 4K maps texel-accurate (the default 12 bits is one texel at 4096).
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeTexcoord: 14 }),
  );

  return { glb: await io.writeBinary(doc), originalTriangles, triangles: countTriangles(doc) };
}
