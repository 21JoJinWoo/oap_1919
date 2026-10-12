// Cuts the end caps off a repeatable model so copies can be butted together
// without visible seams, then runs the normal web optimisation.
//
//   npx tsx scripts/trim-glb.ts <in.glb> <keep half-length, model units> [out-name]
//
// Triangles lying entirely beyond ±keep on the model's X axis (the end caps) are
// removed; long faces that span the whole length are kept, but their end
// vertices are lowered to the body's height so upturned ends (e.g. a curling
// roof ridge) don't poke up at every joint. Expects untransformed mesh nodes.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive } from '@gltf-transform/functions';
import { DEFAULT_OPTIONS, optimizeGlb } from '../server/optimize';

const [input, keepArg, outName] = process.argv.slice(2);
const keep = Number(keepArg);
if (!input || !(keep > 0)) {
  console.error('usage: npx tsx scripts/trim-glb.ts <in.glb> <keep half-length> [out-name]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const isIdentity = (m: number[]) => m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6);
if (!doc.getRoot().listNodes().every((n) => !n.getMesh() || isIdentity(n.getWorldMatrix() as number[]))) {
  console.error('trim-glb: mesh nodes must have no transform');
  process.exit(1);
}

// Height of the body, measured away from the ends.
let bodyTop = -Infinity;
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')!;
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      if (Math.abs(v[0]) <= keep) bodyTop = Math.max(bodyTop, v[1]);
    }
  }

let removed = 0;
let lowered = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')!;
    const idx = prim.getIndices();
    const count = idx ? idx.getCount() : pos.getCount();
    const v = [0, 0, 0];
    const worldX = (i: number) => {
      pos.getElement(i, v);
      return m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
    };
    const kept: number[] = [];
    for (let t = 0; t < count; t += 3) {
      const tri = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
      const xs = tri.map(worldX);
      if (xs.some((x) => Math.abs(x) <= keep) || Math.sign(xs[0]) !== Math.sign(xs[1]) || Math.sign(xs[0]) !== Math.sign(xs[2])) kept.push(...tri);
      else removed++;
    }
    const indices = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept)).setBuffer(pos.getBuffer());
    prim.setIndices(indices);
    compactPrimitive(prim);
    const p = prim.getAttribute('POSITION')!;
    for (let i = 0; i < p.getCount(); i++) {
      p.getElement(i, v);
      if (Math.abs(v[0]) > keep && v[1] > bodyTop) {
        p.setElement(i, [v[0], bodyTop, v[2]]);
        lowered++;
      }
    }
  }
}

const { glb, triangles } = await optimizeGlb(await io.writeBinary(doc), DEFAULT_OPTIONS);
const name = outName ?? `${basename(input, extname(input))}-trim`;
const file = `${name}-${createHash('sha256').update(glb).digest('hex').slice(0, 10)}.glb`;
writeFileSync(join(resolve(import.meta.dirname, '..', process.env.DATA_DIR ?? 'data'), 'models', file), glb);
console.log(`${input}: removed ${removed} end triangles, lowered ${lowered} end vertices to y=${bodyTop.toFixed(3)} → ${triangles} tris, ${(glb.byteLength / 1e6).toFixed(2)}MB → /models/${file}`);
