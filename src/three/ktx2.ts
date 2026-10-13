import type { RootState } from '@react-three/fiber';
import type { Texture } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/** One shared KTX2 (Basis) transcoder; it needs the renderer to pick the GPU block format. */
let loader: KTX2Loader | null = null;
export function ktx2Loader(gl: RootState['gl']): KTX2Loader {
  loader ??= new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(gl);
  return loader;
}

const textures = new Map<string, Promise<Texture>>();
/** Cached load of a standalone .ktx2 texture, for React `use()`. */
export function loadKtx2(gl: RootState['gl'], url: string): Promise<Texture> {
  let p = textures.get(url);
  if (!p) {
    p = ktx2Loader(gl).loadAsync(url);
    textures.set(url, p);
  }
  return p;
}
