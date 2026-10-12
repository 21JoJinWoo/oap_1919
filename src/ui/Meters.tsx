import { useRef } from 'react';
import { useScene } from '../store/sceneStore';
import { useUi, type RenderStats } from '../store/uiStore';
import { formatBytes } from './fields';

const DEPTH_MIN = 0.1;
const DEPTH_MAX = 3;

/** Vertical slider for the parallax gain ("how deep the space feels"). */
export function DepthSlider() {
  const parallax = useScene((s) => s.doc?.settings.viewer.parallax ?? 1);
  const track = useRef<HTMLDivElement>(null);
  const t = (parallax - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN);

  const setFromPointer = (clientY: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (r.bottom - clientY) / r.height));
    const v = Math.round((DEPTH_MIN + f * (DEPTH_MAX - DEPTH_MIN)) * 20) / 20;
    useScene.getState().updateSettings((s) => void (s.viewer.parallax = v), '공간감(DEPTH)', 'depth');
  };

  return (
    <div className="meter" title="DEPTH: 머리 움직임에 대한 시차 배율 (1 = 물리적으로 정확)">
      <span className="vlabel" style={{ color: 'rgba(255,106,0,0.7)' }}>
        DEPTH
      </span>
      <div
        ref={track}
        className="depth-track"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons) setFromPointer(e.clientY);
        }}
        onDoubleClick={() => useScene.getState().updateSettings((s) => void (s.viewer.parallax = 1), '공간감 초기화')}
      >
        <div className="depth-fill" style={{ height: `${t * 100}%` }} />
        <div className="depth-knob" style={{ bottom: `calc(${t * 100}% - 7px)` }} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--accent)' }}>{parallax.toFixed(2)}</span>
    </div>
  );
}

const HOUR_MIN = 5;
const HOUR_MAX = 20;
const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** Vertical slider for the time of day (1919-03-01, local time). */
export function TimeSlider() {
  const tod = useScene((s) => s.doc?.settings.timeOfDay);
  const track = useRef<HTMLDivElement>(null);
  if (!tod) return null;
  const t = (tod.hour - HOUR_MIN) / (HOUR_MAX - HOUR_MIN);

  const setFromPointer = (clientY: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (r.bottom - clientY) / r.height));
    const hour = Math.round((HOUR_MIN + f * (HOUR_MAX - HOUR_MIN)) * 4) / 4;
    useScene.getState().updateSettings((s) => void (s.timeOfDay!.hour = hour), '시간대', 'time');
  };

  return (
    <div className="meter" title="TIME: 1919년 3월 1일 탑골공원의 시각 (더블클릭: 14:00)">
      <span className="vlabel" style={{ color: 'rgba(120,180,255,0.75)' }}>
        TIME
      </span>
      <div
        ref={track}
        className="depth-track time-track"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons) setFromPointer(e.clientY);
        }}
        onDoubleClick={() => useScene.getState().updateSettings((s) => void (s.timeOfDay!.hour = 14), '시간대 초기화')}
      >
        <div className="depth-fill" style={{ height: `${t * 100}%` }} />
        <div className="depth-knob" style={{ bottom: `calc(${t * 100}% - 7px)` }} />
      </div>
      <span style={{ fontSize: 10, color: 'rgb(120,180,255)' }}>{fmtHour(tod.hour)}</span>
    </div>
  );
}

const SEGMENTS = [
  { rgb: '50,210,80', label: '쾌적' },
  { rgb: '140,210,50', label: '양호' },
  { rgb: '230,185,40', label: '보통' },
  { rgb: '240,105,35', label: '높음' },
  { rgb: '235,45,45', label: '위험' },
];

/**
 * Rendering load score in [0,1]. Weighted like the reference site
 * (FPS 45%, draw calls 30%, triangles 15%, textures 10%); the per-metric
 * normalisation ceilings are this project's own heuristics.
 */
export function loadScore(s: RenderStats): number {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return (
    0.45 * c((60 - s.fps) / 45) +
    0.3 * c(s.calls / 400) +
    0.15 * c(s.triangles / 2_000_000) +
    0.1 * c(s.textures / 80)
  );
}

export function LoadMeter() {
  const stats = useUi((s) => s.stats);
  const score = loadScore(stats);
  const level = Math.min(SEGMENTS.length - 1, Math.floor(score * SEGMENTS.length));
  const color = SEGMENTS[level].rgb;
  const title =
    `▸ FPS: ${stats.fps}\n▸ 드로우콜: ${stats.calls}\n▸ 렌더 삼각형: ${(stats.triangles / 1000).toFixed(0)}K\n` +
    `▸ 텍스처: ${stats.textures}\n▸ 지오메트리: ${stats.geometries}\n─────────────\nFPS 45% + 드로우콜 30% + 삼각형 15% + 텍스처 10%`;
  return (
    <div className="meter" title={title}>
      <span className="vlabel" style={{ color: `rgba(${color},0.75)` }}>
        LOAD
      </span>
      <div className="load-bar">
        {SEGMENTS.map((seg, i) => {
          const fill = Math.min(1, Math.max(0, score * SEGMENTS.length - i));
          return (
            <div key={i} className="load-seg" style={{ background: `rgba(${seg.rgb},0.07)`, border: `1px solid rgba(${seg.rgb},0.22)` }}>
              <div style={{ height: `${fill * 100}%`, background: `rgba(${seg.rgb},0.87)`, boxShadow: `0 0 6px rgba(${seg.rgb},0.6)` }} />
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: 9, color: `rgba(${color},0.85)` }}>{stats.fps}fps</span>
      <span style={{ fontSize: 8, color: `rgba(${color},0.6)` }}>{SEGMENTS[level].label}</span>
    </div>
  );
}

/** Total size of the distinct GLB files in the scene and the heaviest one. */
export function DataMeter() {
  const objects = useScene((s) => s.doc?.objects ?? []);
  const files = new Map<string, { name: string; bytes: number; count: number }>();
  for (const o of objects) {
    if (o.kind !== 'glb' || !o.src) continue;
    const f = files.get(o.src);
    if (f) f.count++;
    else files.set(o.src, { name: o.name, bytes: o.bytes ?? 0, count: 1 });
  }
  const list = [...files.values()].sort((a, b) => b.bytes - a.bytes);
  const total = list.reduce((n, f) => n + f.bytes, 0);
  const title =
    `── 로드된 GLB 파일 (${list.length}개, 같은 파일 재사용은 1회만 다운로드) ──\n` +
    list.map((f) => `${f.name.slice(0, 24).padEnd(24)} ${formatBytes(f.bytes)}${f.count > 1 ? ` ×${f.count}` : ''}`).join('\n') +
    `\n──────────\nTOTAL ${formatBytes(total)}`;
  return (
    <div className="data-box" title={title}>
      <div>
        <span className="k">DATA</span>
        <span style={{ color: 'rgba(255,255,255,0.6)' }}>{formatBytes(total)}</span>
        <span className="k" style={{ marginLeft: 6 }}>FILES</span>
        <span style={{ color: 'rgba(255,255,255,0.6)' }}>{list.length}</span>
      </div>
      {list[0] && (
        <div style={{ color: 'rgba(255,160,40,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span className="k" style={{ color: 'rgba(255,160,40,0.65)' }}>
            ▲HVY
          </span>
          {list[0].name} {formatBytes(list[0].bytes)}
        </div>
      )}
    </div>
  );
}
