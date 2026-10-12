import type { RootState } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, loadScene, readDraft, saveScene, writeDraft, type Draft } from './lib/api';
import { useScene } from './store/sceneStore';
import { useUi } from './store/uiStore';
import { Stage } from './three/Stage';
import { FaceTracker } from './tracking/faceTracker';
import { neutralPose } from './tracking/headPose';
import { CameraPreview, TrackingToggle } from './ui/CameraDock';
import { DataMeter, DepthSlider, LoadMeter } from './ui/Meters';
import { AddPanel, HistoryPanel, Inspector, LayersPanel, SettingsPanel } from './ui/Panels';
import type { SceneDoc } from './types';

const sameScene = (a: SceneDoc, b: SceneDoc) =>
  JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' });

export function App() {
  const doc = useScene((s) => s.doc);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [remoteNewer, setRemoteNewer] = useState(false);
  /** Server version the user chose to ignore, so the banner doesn't reappear for it. */
  const dismissedAt = useRef<string | null>(null);
  const [tracker, setTracker] = useState<FaceTracker | null>(null);
  const glRef = useRef<RootState['gl'] | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  // ---------- load scene + detect unsaved local draft ----------
  useEffect(() => {
    loadScene()
      .then(({ doc, readOnly }) => {
        useScene.getState().load(doc, { readOnly, savedAt: doc.updatedAt });
        neutralPose(doc.settings.viewer.defaultDistanceCm / 100);
        const d = readDraft();
        if (d && !readOnly && !sameScene(d.doc, doc)) setDraft(d);
        else writeDraft(null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  // ---------- persist edits as a local draft until saved ----------
  useEffect(
    () =>
      useScene.subscribe((s, prev) => {
        if (s.doc !== prev.doc && s.dirty && !s.readOnly && s.doc) {
          writeDraft({ doc: s.doc, baseUpdatedAt: s.savedAt });
        }
      }),
    [],
  );

  // ---------- pick up scene changes made elsewhere (git sync, another tab) ----------
  useEffect(() => {
    const timer = setInterval(async () => {
      const s = useScene.getState();
      if (!s.doc || s.readOnly || useUi.getState().busy) return;
      try {
        const res = await fetch('/api/scene/meta', { cache: 'no-store' });
        if (!res.ok) return;
        const { updatedAt } = (await res.json()) as { updatedAt: string };
        if (updatedAt === s.savedAt) return;
        if (s.dirty) {
          if (dismissedAt.current !== updatedAt) setRemoteNewer(true);
          dismissedAt.current = updatedAt;
          return;
        }
        const { doc } = await loadScene();
        useScene.getState().load(doc, { readOnly: false, savedAt: doc.updatedAt });
        useUi.getState().notify('새 버전의 장면을 불러왔습니다.');
      } catch {
        /* server restarting: try again next tick */
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // ---------- face tracker lifecycle ----------
  useEffect(() => {
    const t = new FaceTracker({ webcamFovDeg: 60, screenHeightM: 0.2 }, (status, message) =>
      useUi.getState().set({ tracker: status, trackerMessage: message ?? null }),
    );
    setTracker(t);
    void t.start();
    return () => t.dispose();
  }, []);

  const viewer = doc?.settings.viewer;
  useEffect(() => {
    if (!tracker || !viewer) return;
    const update = () => {
      const screenW = viewer.screenWidthCm / 100;
      tracker.setConfig({ webcamFovDeg: viewer.webcamFovDeg, screenHeightM: screenW * (window.innerHeight / window.innerWidth) });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [tracker, viewer]);

  // ---------- save ----------
  const save = useCallback(async () => {
    const { doc, savedAt, readOnly, markSaved } = useScene.getState();
    const ui = useUi.getState();
    if (!doc || readOnly) return;
    ui.set({ busy: '저장 중…' });
    try {
      let updatedAt: string;
      try {
        updatedAt = await saveScene(doc, savedAt);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        if (!window.confirm('다른 곳에서 더 최근에 저장된 장면이 있습니다. 현재 내용으로 덮어쓸까요?')) return;
        updatedAt = await saveScene(doc, null);
      }
      markSaved(updatedAt);
      writeDraft(null);
      setDraft(null);
      setRemoteNewer(false);
      ui.notify('저장되었습니다.');
    } catch (err) {
      ui.notify(`저장 실패: ${(err as Error).message}`, 'error');
    } finally {
      ui.set({ busy: null });
    }
  }, []);

  // ---------- recording ----------
  const toggleRecording = useCallback(() => {
    const ui = useUi.getState();
    if (recorder.current) {
      recorder.current.stop();
      return;
    }
    const canvas = glRef.current?.domElement;
    if (!canvas || typeof MediaRecorder === 'undefined') {
      ui.notify('이 브라우저는 화면 녹화를 지원하지 않습니다.', 'error');
      return;
    }
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(canvas.captureStream(30), {
      mimeType: mime,
      videoBitsPerSecond: 12_000_000,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      recorder.current = null;
      ui.set({ recording: false });
      const blob = new Blob(chunks, { type: rec.mimeType });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `oap1919-${new Date().toISOString().replace(/[:.]/g, '-')}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    };
    rec.start(1000);
    recorder.current = rec;
    ui.set({ recording: true });
  }, []);

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useScene.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Save works everywhere, including while typing in a field.
      if (mod && key === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (s.readOnly) {
        return;
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        s.duplicateSelected();
      } else if (mod) {
        return;
      } else if (key === 'e') s.setTransformMode('translate');
      else if (key === 'r') s.setTransformMode('rotate');
      else if (key === 't') s.setTransformMode('scale');
      else if (key === 'delete' || key === 'backspace') s.removeSelected();
      else if (key === 'escape') s.select(null);
      else if (key === 'tab') {
        e.preventDefault();
        s.setMode(s.mode === 'spatial' ? 'edit' : 'spatial');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useScene.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  if (loadError) return <div className="splash">장면을 불러오지 못했습니다: {loadError}</div>;
  if (!doc) return <div className="splash">LOADING · 1919 탑골공원</div>;

  return (
    <div className="app-root">
      <div className="stage">
        <Stage onCreated={(s) => (glRef.current = s.gl)} />
      </div>
      <Hud tracker={tracker} onSave={save} onRecord={toggleRecording} />
      {remoteNewer && (
        <div className="banner" style={{ bottom: draft ? 240 : 196 }}>
          <span>↻ 서버에 새 버전의 장면이 있습니다</span>
          <button
            className="mini"
            onClick={async () => {
              const { doc } = await loadScene();
              useScene.getState().load(doc, { readOnly: false, savedAt: doc.updatedAt });
              writeDraft(null);
              setRemoteNewer(false);
            }}
          >
            새 버전 불러오기 (내 편집 버림)
          </button>
          <button className="mini" onClick={() => setRemoteNewer(false)}>
            닫기
          </button>
        </div>
      )}
      {draft && (
        <div className="banner">
          <span>↺ 저장하지 않은 로컬 편집 있음</span>
          <button
            className="mini"
            onClick={() => {
              useScene.getState().load(draft.doc, {
                readOnly: false,
                savedAt: useScene.getState().savedAt,
                dirty: true,
              });
              setDraft(null);
            }}
          >
            복원
          </button>
          <button
            className="mini"
            onClick={() => {
              writeDraft(null);
              setDraft(null);
            }}
          >
            버리기
          </button>
        </div>
      )}
    </div>
  );
}

function Hud({ tracker, onSave, onRecord }: { tracker: FaceTracker | null; onSave: () => void; onRecord: () => void }) {
  const mode = useScene((s) => s.mode);
  const setMode = useScene((s) => s.setMode);
  const dirty = useScene((s) => s.dirty);
  const readOnly = useScene((s) => s.readOnly);
  const panel = useUi((s) => s.panel);
  const busy = useUi((s) => s.busy);
  const toast = useUi((s) => s.toast);
  const recording = useUi((s) => s.recording);
  const togglePanel = (p: NonNullable<typeof panel>) => useUi.getState().set({ panel: panel === p ? null : p });

  return (
    <>
      <div className="toolbar-left">
        <button className={`icon-btn ${panel === 'layers' ? 'active' : ''}`} title="레이어 패널" onClick={() => togglePanel('layers')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="2" y="3" width="20" height="4" rx="1" />
            <rect x="2" y="10" width="20" height="4" rx="1" />
            <rect x="2" y="17" width="20" height="4" rx="1" />
          </svg>
        </button>
        <button className={`icon-btn ${panel === 'add' ? 'active' : ''}`} title="오브젝트 추가" onClick={() => togglePanel('add')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </button>
        <button className={`icon-btn ${panel === 'history' ? 'active' : ''}`} title="히스토리 패널 (Ctrl+Z/Y)" onClick={() => togglePanel('history')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-4.16" />
            <line x1="12" y1="7" x2="12" y2="12" />
            <polyline points="12 12 15 14" />
          </svg>
        </button>
        <button className={`icon-btn ${panel === 'settings' ? 'active' : ''}`} title="설정 (포탈 · 화면 보정 · 분위기)" onClick={() => togglePanel('settings')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>

      <div className="toolbar-right">
        {!readOnly && (
          <button className={`pill ${dirty ? 'warn' : ''}`} disabled={!dirty || !!busy} onClick={onSave} title="서버에 저장 (Ctrl+S)">
            {dirty ? '● 저장' : '저장됨'}
          </button>
        )}
        <button className={`pill ${recording ? 'warn' : ''}`} onClick={onRecord} title="화면 녹화">
          {recording ? '■ REC' : '● REC'}
        </button>
        <div className="seg">
          <button className={mode === 'spatial' ? 'on' : ''} title="오프-축 포탈 뷰 (페이스 트래킹)" onClick={() => setMode('spatial')}>
            spatial
          </button>
          <button className={mode === 'edit' ? 'on' : ''} title="3D 씬 자유 카메라 (드래그: 회전, 우클릭: 팬, 휠: 줌)" onClick={() => setMode('edit')}>
            edit
          </button>
        </div>
      </div>

      {panel === 'layers' && <LayersPanel />}
      {panel === 'add' && <AddPanel />}
      {panel === 'history' && <HistoryPanel />}
      {panel === 'settings' && <SettingsPanel />}
      <Inspector />

      <div className="meters">
        <DepthSlider />
        <LoadMeter />
        <DataMeter />
      </div>

      <div className="bottom-center">
        <TrackingToggle tracker={tracker} />
      </div>
      <CameraPreview tracker={tracker} onRecord={onRecord} />

      <div className="controls-hint">
        {mode === 'spatial' ? (
          <div>MOVE HEAD ← → — SHIFT PERSPECTIVE · TAB: EDIT MODE</div>
        ) : (
          <div>DRAG: ORBIT · RIGHT-DRAG: PAN · WHEEL: ZOOM · TAB: SPATIAL MODE</div>
        )}
        {!readOnly && <div>CLICK MODEL → SELECT | E MOVE · R ROTATE · T SCALE · DEL DELETE · CTRL+S SAVE</div>}
      </div>

      {busy && <div className="toast">{busy}</div>}
      {!busy && toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </>
  );
}
