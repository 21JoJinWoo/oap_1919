/** Root-relative asset paths ("/models/x.glb") resolve against the app base, so builds served from a sub-path work. */
export const assetUrl = (src: string) => (src.startsWith('/') ? `${import.meta.env.BASE_URL}${src.slice(1)}` : src);
