import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const root = import.meta.dirname;
const mediapipeWasm = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dataDir = resolve(root, process.env.DATA_DIR ?? 'data');

/**
 * Serves the MediaPipe WASM runtime from node_modules at /mediapipe/wasm in
 * dev, and copies it plus the scene data into dist on build so the output also
 * works on static hosting (read-only).
 */
function localAssets(): Plugin {
  return {
    name: 'oap-local-assets',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const file = join(mediapipeWasm, (req.url ?? '').split('?')[0]);
        if (!file.startsWith(mediapipeWasm) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = resolve(root, 'dist');
      if (!existsSync(out)) return;
      cpSync(mediapipeWasm, join(out, 'mediapipe/wasm'), { recursive: true });
      cpSync(join(dataDir, 'scene.json'), join(out, 'scene.json'));
      const models = join(dataDir, 'models');
      if (existsSync(models) && readdirSync(models).some((f) => f.endsWith('.glb'))) {
        cpSync(models, join(out, 'models'), { recursive: true, filter: (f) => !f.endsWith('.gitkeep') });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localAssets()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('@mediapipe')) return 'mediapipe';
          if (id.includes('@react-three') || id.includes('three-stdlib')) return 'r3f';
        },
      },
    },
  },
});
