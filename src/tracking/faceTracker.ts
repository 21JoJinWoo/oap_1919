import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { faceToEye } from '../lib/offAxis';
import { OneEuroFilter } from '../lib/oneEuro';
import { headPose } from './headPose';

export type TrackerStatus = 'idle' | 'loading' | 'running' | 'denied' | 'unavailable' | 'error';

export interface TrackerConfig {
  webcamFovDeg: number;
  screenHeightM: number;
}

const WASM_BASE = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_URL = `${import.meta.env.BASE_URL}mediapipe/blaze_face_short_range.tflite`;

/**
 * Webcam face tracker. Runs MediaPipe's BlazeFace short-range detector on each
 * new video frame, converts the eye keypoints to a metric eye position and
 * writes the filtered result into `headPose`.
 */
export class FaceTracker {
  readonly video: HTMLVideoElement;
  private detector: FaceDetector | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private frameHandle = 0;
  private lastVideoTime = -1;
  private readonly fx = new OneEuroFilter(1.0, 4.0);
  private readonly fy = new OneEuroFilter(1.0, 4.0);
  private readonly fz = new OneEuroFilter(0.6, 1.5);
  /** Latest raw detection for the preview overlay (normalised coordinates). */
  overlay: { box: [number, number, number, number]; eyes: [number, number][] } | null = null;

  constructor(
    private config: TrackerConfig,
    private onStatus: (s: TrackerStatus, message?: string) => void,
  ) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
  }

  setConfig(config: TrackerConfig): void {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.onStatus('unavailable', '이 브라우저는 카메라를 지원하지 않습니다 (HTTPS 필요).');
      return;
    }
    this.onStatus('loading');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (err) {
      const name = (err as DOMException).name;
      this.onStatus(name === 'NotAllowedError' ? 'denied' : 'unavailable', String(err));
      return;
    }
    try {
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!this.detector) {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        this.detector = await createDetector(fileset);
      }
    } catch (err) {
      this.stop();
      this.onStatus('error', String(err));
      return;
    }
    this.running = true;
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
    this.onStatus('running');
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) {
      if ('cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.frameHandle);
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.overlay = null;
    headPose.faceVisible = false;
  }

  dispose(): void {
    this.stop();
    this.detector?.close();
    this.detector = null;
  }

  private schedule(): void {
    if (!this.running) return;
    if ('requestVideoFrameCallback' in this.video) {
      this.frameHandle = this.video.requestVideoFrameCallback(() => this.tick());
    } else {
      this.frameHandle = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (!this.running || !this.detector) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      const result = this.detector.detectForVideo(v, now);
      const face = result.detections[0];
      const kp = face?.keypoints;
      // BlazeFace keypoints: 0 = right eye, 1 = left eye (subject's perspective).
      if (face && kp && kp.length >= 2) {
        const [re, le] = kp;
        const eye = faceToEye(
          {
            u: (re.x + le.x) / 2,
            v: (re.y + le.y) / 2,
            eyeDistX: le.x - re.x,
            eyeDistY: le.y - re.y,
          },
          { width: v.videoWidth, height: v.videoHeight },
          this.config.webcamFovDeg,
          this.config.screenHeightM,
        );
        if (eye.z > 0.15 && eye.z < 3) {
          const t = now / 1000;
          headPose.x = this.fx.filter(eye.x, t);
          headPose.y = this.fy.filter(eye.y, t);
          headPose.z = this.fz.filter(eye.z, t);
          headPose.faceVisible = true;
          headPose.lastSeen = now;
        }
        const b = face.boundingBox;
        this.overlay = {
          box: b
            ? [b.originX / v.videoWidth, b.originY / v.videoHeight, b.width / v.videoWidth, b.height / v.videoHeight]
            : [0, 0, 0, 0],
          eyes: [
            [re.x, re.y],
            [le.x, le.y],
          ],
        };
      } else {
        headPose.faceVisible = false;
        this.overlay = null;
      }
    }
    this.schedule();
  }
}

async function createDetector(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO' as const,
    minDetectionConfidence: 0.5,
  });
  try {
    return await FaceDetector.createFromOptions(fileset, options('GPU'));
  } catch {
    return await FaceDetector.createFromOptions(fileset, options('CPU'));
  }
}
