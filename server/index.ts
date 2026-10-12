import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { SceneDoc, UploadResult } from '../src/types';
import { optimizeGlb } from './optimize';

const root = resolve(import.meta.dirname, '..');
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? (isProd ? 3000 : 5173));
const dataDir = resolve(root, process.env.DATA_DIR ?? 'data');
const modelsDir = join(dataDir, 'models');
const scenePath = join(dataDir, 'scene.json');
/** When set, saving and uploading require the `x-edit-token` header to match. */
const editToken = process.env.EDIT_TOKEN ?? '';

await mkdir(modelsDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
const httpServer = createHttpServer(app);

function requireEdit(req: Request, res: Response, next: NextFunction) {
  if (!editToken) return next();
  const given = Buffer.from(String(req.headers['x-edit-token'] ?? ''));
  const expected = Buffer.from(editToken);
  if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
  res.status(401).json({ error: '편집 비밀번호가 올바르지 않습니다.' });
}

async function readScene(): Promise<SceneDoc> {
  return JSON.parse(await readFile(scenePath, 'utf8')) as SceneDoc;
}

/** Write via a temp file + rename so a crash never leaves a half-written scene. */
async function writeAtomic(path: string, data: string | Uint8Array) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, editProtected: Boolean(editToken) });
});

app.get('/api/scene', async (_req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.json(await readScene());
});

/** Cheap change check for open pages: they reload the scene when this moves. */
app.get('/api/scene/meta', async (_req, res) => {
  res.setHeader('cache-control', 'no-store');
  const { updatedAt } = await readScene();
  res.json({ updatedAt });
});

app.put('/api/scene', requireEdit, express.json({ limit: '10mb' }), async (req, res) => {
  const doc = req.body as SceneDoc;
  if (!doc || doc.version !== 1 || !Array.isArray(doc.objects) || !Array.isArray(doc.lights) || !doc.settings) {
    res.status(400).json({ error: '장면 데이터 형식이 올바르지 않습니다.' });
    return;
  }
  // Optimistic concurrency: refuse to overwrite a newer save unless forced.
  const base = String(req.headers['x-base-updated-at'] ?? '');
  if (base) {
    const current = await readScene().catch(() => null);
    if (current && current.updatedAt !== base) {
      res.status(409).json({ error: '더 최근에 저장된 장면이 있습니다.', updatedAt: current.updatedAt });
      return;
    }
  }
  doc.updatedAt = new Date().toISOString();
  await writeAtomic(scenePath, JSON.stringify(doc, null, 2) + '\n');
  res.json({ updatedAt: doc.updatedAt });
});

app.post(
  '/api/models',
  requireEdit,
  express.raw({ type: () => true, limit: process.env.MAX_UPLOAD ?? '300mb' }),
  async (req, res) => {
    const input = req.body as Buffer;
    if (!Buffer.isBuffer(input) || input.length < 12 || input.toString('ascii', 0, 4) !== 'glTF') {
      res.status(400).json({ error: 'GLB(바이너리 glTF) 파일이 아닙니다.' });
      return;
    }
    const original = basename(String(req.query.name ?? 'model.glb'));
    const slug =
      original
        .replace(/\.glb$/i, '')
        .normalize('NFKD')
        .replace(/[^\w-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 40) || 'model';
    try {
      const started = Date.now();
      const { glb, originalTriangles, triangles } = await optimizeGlb(new Uint8Array(input));
      // Content-hashed name: identical uploads dedupe, and files can be cached forever.
      const hash = createHash('sha256').update(glb).digest('hex').slice(0, 10);
      const file = `${slug}-${hash}.glb`;
      await writeAtomic(join(modelsDir, file), glb);
      const result: UploadResult = {
        src: `/models/${file}`,
        name: original,
        bytes: glb.byteLength,
        originalBytes: input.length,
        triangles,
        originalTriangles,
      };
      console.log(
        `[models] ${original}: ${(input.length / 1e6).toFixed(1)}MB → ${(glb.byteLength / 1e6).toFixed(1)}MB, ` +
          `${originalTriangles} → ${triangles} tris (${Date.now() - started}ms)`,
      );
      res.json(result);
    } catch (err) {
      console.error('[models] optimisation failed', err);
      res.status(422).json({ error: `GLB 최적화 실패: ${(err as Error).message}` });
    }
  },
);

app.use(
  '/models',
  express.static(modelsDir, {
    immutable: true,
    maxAge: '365d',
    setHeaders: (res) => res.setHeader('content-type', 'model/gltf-binary'),
  }),
);
app.use('/mediapipe/wasm', express.static(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), { maxAge: '30d' }));

if (isProd) {
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('dist/ 가 없습니다. 먼저 `npm run build`를 실행하세요.');
    process.exit(1);
  }
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  // HMR shares the app's port instead of a fixed extra one.
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

httpServer.listen(port, () => {
  console.log(`OAP 1919 ${isProd ? 'production' : 'dev'} server → http://localhost:${port}`);
  console.log(`data: ${dataDir}${editToken ? ' (EDIT_TOKEN 보호)' : ' (편집 보호 없음: EDIT_TOKEN 미설정)'}`);
});
