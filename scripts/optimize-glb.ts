// Batch-optimises GLB files into data/models and optionally adds them to the scene.
//
//   npm run optimize -- path/to/a.glb path/to/folder [--add]
//
// --add appends each model to data/scene.json, spaced along X behind the portal.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { optimizeGlb } from '../server/optimize';
import type { SceneDoc, SceneObject } from '../src/types';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(root, process.env.DATA_DIR ?? 'data');
const args = process.argv.slice(2);
const add = args.includes('--add');
const inputs = args
  .filter((a) => !a.startsWith('--'))
  .flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p)
          .filter((f) => extname(f).toLowerCase() === '.glb')
          .map((f) => join(p, f))
      : [p],
  );

if (!inputs.length) {
  console.error('usage: npm run optimize -- <file.glb|folder>... [--add]');
  process.exit(1);
}

const scenePath = join(dataDir, 'scene.json');
const scene = JSON.parse(readFileSync(scenePath, 'utf8')) as SceneDoc;
const center = scene.settings.portal.center;
let added = 0;

for (const file of inputs) {
  const input = readFileSync(file);
  const { glb, originalTriangles, triangles } = await optimizeGlb(new Uint8Array(input));
  const name = basename(file, extname(file));
  const slug =
    name
      .normalize('NFKD')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'model';
  const out = `${slug}-${createHash('sha256').update(glb).digest('hex').slice(0, 10)}.glb`;
  writeFileSync(join(dataDir, 'models', out), glb);
  console.log(
    `${basename(file)}: ${(input.length / 1e6).toFixed(2)}MB → ${(glb.byteLength / 1e6).toFixed(2)}MB, ` +
      `${originalTriangles.toLocaleString()} → ${triangles.toLocaleString()} tris → /models/${out}`,
  );
  if (add) {
    const obj: SceneObject = {
      id: `obj-${slug}-${Date.now().toString(36)}`,
      name,
      kind: 'glb',
      src: `/models/${out}`,
      bytes: glb.byteLength,
      triangles,
      position: [center[0] + (added - (inputs.length - 1) / 2) * 3, 0, center[2] - 10],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      castShadow: true,
      receiveShadow: true,
    };
    scene.objects.push(obj);
    added++;
  }
}

if (add) {
  scene.updatedAt = new Date().toISOString();
  writeFileSync(scenePath, JSON.stringify(scene, null, 2) + '\n');
  console.log(`scene.json: ${added}개 오브젝트 추가`);
}
