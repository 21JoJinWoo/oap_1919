// Scene document shared by the client and the server.

export type Vec3 = [number, number, number];

export type PrimitiveKind = 'box' | 'cylinder' | 'cone' | 'sphere' | 'plane' | 'capsule' | 'ring';

export interface SceneObject {
  id: string;
  name: string;
  kind: 'glb' | 'primitive' | 'trail' | 'fx';
  /** GLB url (kind === 'glb'). */
  src?: string;
  /** GLB file size in bytes, recorded at upload time. */
  bytes?: number;
  /** Triangle count after optimisation, recorded at upload time. */
  triangles?: number;
  primitive?: PrimitiveKind;
  /** Radial segments for cylinder / cone (8 = octagon). */
  segments?: number;
  /**
   * Flat ring / disc / sector (primitive 'ring', unit diameter, lies in XY):
   * [inner radius as a fraction of the outer, start angle °, sweep °].
   */
  arc?: [number, number, number];
  /**
   * Frozen bullet shock-wave trail (kind 'trail'): mirror-like bulges from
   * `from` (muzzle) to `to` (bullet), largest at the bullet, in the object's frame.
   */
  trail?: {
    from: Vec3;
    to: Vec3;
    count: number;
    radius: number;
    /** Beads stream from the bullet back to the muzzle, cycles per second (0 = frozen). */
    flow?: number;
    /** Number of faint speed streaks racing along the trail. */
    streaks?: number;
  };
  /** Continuous spin about a local axis (e.g. a bullet's rifling spin), revolutions per second. */
  spin?: { axis: Vec3; rps: number };
  /**
   * Frozen-moment effect (kind 'fx'); the object's box (scale) is the effect's volume.
   * smoke: billow along local +Z from the origin (muzzle); flash: muzzle flash along +Z;
   * leaflets: curled paper sheets; dust: specks in the light; groundDust: dirt kicked up at ground level. `size` in metres (sprite / sheet width / speck size).
   */
  fx?: {
    type: 'smoke' | 'leaflets' | 'dust' | 'flash' | 'groundDust';
    count: number;
    size: number;
    seed: number;
    opacity?: number;
    /**
     * World points (faces, the muzzle) that leaflets keep `clear` metres away from — measured to the
     * sight line from `eye` when given, so no sheet hides them from the viewer.
     */
    avoid?: Vec3[];
    clear?: number;
    eye?: Vec3;
    /** flash: seconds between shots (the flash, sparks and light fire on this loop). */
    period?: number;
    /** dust: how far (m) each speck sways around its home position in the breeze (0 = still). */
    drift?: number;
    /** dust: frustum-shaped volume narrowing to this fraction at the local +Z (viewer) end. */
    taper?: number;
    /** groundDust: world points (behind runners' feet, hooves) where kicked-up dirt clusters. */
    sources?: Vec3[];
  };
  /**
   * Tiled PBR surface for a primitive plane (KTX2 maps under /env): colour (sRGB), tangent-space
   * normal (OpenGL convention) and occlusion-roughness packed in R/G. `tile` = metres per repeat.
   */
  surface?: { color: string; normal?: string; orm?: string; tile: number; normalScale?: number };
  color?: string;
  position: Vec3;
  /** Euler XYZ in degrees. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
}

export type LightKind = 'ambient' | 'hemisphere' | 'directional' | 'point';

export interface SceneLight {
  id: string;
  name: string;
  kind: LightKind;
  color: string;
  /** Hemisphere ground colour. */
  groundColor?: string;
  intensity: number;
  position: Vec3;
  castShadow: boolean;
  visible: boolean;
  /** Directional light placed and tinted by the time-of-day sun. */
  followSun?: boolean;
}

export interface SceneSettings {
  background: string;
  /** Image-based lighting and sky backdrop, produced by scripts/prepare-hdri.ts. */
  environment?: {
    /** Small Radiance HDR used for lighting. */
    hdr: string;
    /** Tone-mapped equirectangular sky image shown as the background. */
    sky: string;
    /** Renderer exposure; the sky image is baked at this exposure. */
    exposure: number;
    /** Strength of the image-based lighting. */
    intensity: number;
    /** Compass azimuth of the sun in the prepared HDRI; lets the sky turn with the time-of-day sun. */
    sunAzimuth?: number;
  };
  /** Post-processing "film look": ambient occlusion, bloom, tone mapping + grading, soft shadows. */
  cinematic?: {
    enabled: boolean;
    /** Screen-space ambient occlusion (N8AO): radius in metres. */
    ao: { radius: number; intensity: number; falloff: number };
    /** Glow above a scene-linear luminance threshold. */
    bloom: { intensity: number; threshold: number };
    grade: {
      saturation: number;
      /** 0–1 blend towards an S-curve. */
      contrast: number;
      shadowTint: string;
      highlightTint: string;
      tintAmount: number;
      vignette: number;
      grain: number;
    };
    /** PCSS light size for soft sun shadows (0 = off). */
    softShadows: number;
  };
  /** Time of day: drives the sun light, sky / ambient brightness and fog tint. */
  timeOfDay?: {
    /** Local clock hour, e.g. 14.5 = 14:30. */
    hour: number;
    date: [number, number, number];
    lat: number;
    lon: number;
    /** UTC offset of the clock, hours. */
    tz: number;
  };
  /** `color` is the daytime horizon colour; with timeOfDay it is darkened / warmed automatically. */
  fog: { enabled: boolean; color: string; near: number; far: number };
  shadows: boolean;
  /**
   * The virtual window. The physical screen is mapped onto a rectangle of
   * `width` world units centred at `center`, looking down -Z rotated by `yawDeg`.
   */
  portal: {
    center: Vec3;
    width: number;
    yawDeg: number;
    /** Widens the view by bringing the virtual eye closer to the window (1 = physically exact). */
    fovScale?: number;
    /** Neutral eye height relative to the window centre, world units (negative = view tilts up). */
    eyeOffsetY?: number;
  };
  /** Physical viewing setup used to convert the tracked face into metres. */
  viewer: {
    /** Visible screen width in centimetres. */
    screenWidthCm: number;
    /** Horizontal field of view of the webcam in degrees. */
    webcamFovDeg: number;
    /** Extra gain applied to sideways / vertical head motion (1 = physically correct). */
    parallax: number;
    /** Move the virtual eye opposite to the tracked head sideways. */
    invertX?: boolean;
    /** Move the virtual eye opposite to the tracked head vertically. */
    invertY?: boolean;
    /** Viewing distance used when no face is tracked, in centimetres. */
    defaultDistanceCm: number;
  };
}

export interface SceneDoc {
  version: 1;
  updatedAt: string;
  settings: SceneSettings;
  lights: SceneLight[];
  objects: SceneObject[];
}

export interface UploadResult {
  src: string;
  name: string;
  bytes: number;
  originalBytes: number;
  triangles: number;
  originalTriangles: number;
}
