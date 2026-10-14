import { useEffect, useRef } from 'react';
import type { FaceTracker } from '../tracking/faceTracker';
import { useUi } from '../store/uiStore';

const STATUS_TEXT: Record<string, string> = {
  idle: '카메라 꺼짐 · 마우스 모드',
  loading: '카메라 연결 중…',
  running: '카메라 연결됨 · Face Tracking',
  denied: '카메라 권한 거부됨 · 마우스 모드',
  unavailable: '카메라 사용 불가 · 마우스 모드',
  error: '얼굴 인식 초기화 실패 · 마우스 모드',
};

/** Tracking status button: toggles between webcam face tracking and mouse control. */
export function TrackingToggle({ tracker }: { tracker: FaceTracker | null }) {
  const status = useUi((s) => s.tracker);
  const mouseMode = useUi((s) => s.mouseMode);
  const message = useUi((s) => s.trackerMessage);
  const active = status === 'running' && !mouseMode;

  const onClick = () => {
    if (!tracker) return;
    if (active) {
      tracker.stop();
      useUi.getState().set({ mouseMode: true, tracker: 'idle' });
    } else {
      useUi.getState().set({ mouseMode: false });
      void tracker.start();
    }
  };

  return (
    <button
      className={`cam-status ${active ? 'ok' : ''}`}
      title={active ? '클릭하면 마우스 모드로 전환' : (message ?? '클릭하면 카메라 얼굴 추적 시작')}
      onClick={onClick}
    >
      <span className="dot" />
      {mouseMode && status === 'idle' ? '마우스 모드 · 클릭하여 카메라 사용' : STATUS_TEXT[status]}
    </button>
  );
}

/** Mirrored webcam preview with the detected face box, plus the record button. */
export function CameraPreview({ tracker, onRecord, hidden = false }: { tracker: FaceTracker | null; onRecord: () => void; hidden?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = useUi((s) => s.tracker);
  const recording = useUi((s) => s.recording);

  useEffect(() => {
    const host = box.current;
    if (!tracker || !host) return;
    host.prepend(tracker.video);
    return () => tracker.video.remove();
  }, [tracker]);

  useEffect(() => {
    if (!tracker || status !== 'running') return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const o = tracker.overlay;
      if (!o) return;
      ctx.strokeStyle = 'rgba(80,255,140,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(o.box[0] * c.width, o.box[1] * c.height, o.box[2] * c.width, o.box[3] * c.height);
      ctx.fillStyle = '#ff6a00';
      for (const [x, y] of o.eyes) {
        ctx.beginPath();
        ctx.arc(x * c.width, y * c.height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [tracker, status]);

  return (
    // Hidden (exhibition): the webcam video must stay attached and rendered — a detached video
    // element pauses — so it shrinks to an invisible speck instead of unmounting.
    <div
      ref={box}
      className={`camera-preview ${hidden ? 'camera-preview-hidden' : ''}`}
      style={{ display: hidden || status === 'running' ? 'block' : 'none' }}
    >
      <canvas ref={canvas} width={160} height={120} />
      <button
        className={`rec-btn ${recording ? 'on' : ''}`}
        title={recording ? '녹화 중지 (파일 저장)' : '화면 녹화 시작'}
        onClick={onRecord}
      >
        <span />
      </button>
    </div>
  );
}
