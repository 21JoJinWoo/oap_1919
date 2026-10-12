import { useRef } from 'react';
import { uploadGlb } from '../lib/api';
import { newId, selectedLight, selectedObject, useScene } from '../store/sceneStore';
import { useUi } from '../store/uiStore';
import type { LightKind, PrimitiveKind, SceneObject, Vec3 } from '../types';
import { CheckField, ColorField, Field, NumberInput, RangeField, VecField, formatBytes } from './fields';

/** Where new objects appear: on the ground, 10 units behind the portal window. */
function spawnPoint(): Vec3 {
  const c = useScene.getState().doc?.settings.portal.center ?? [0, 1.6, 9];
  return [c[0], 0, c[2] - 10];
}

export function LayersPanel() {
  const objects = useScene((s) => s.doc?.objects ?? []);
  const lights = useScene((s) => s.doc?.lights ?? []);
  const selection = useScene((s) => s.selection);
  const { select, updateObject, updateLight } = useScene.getState();

  return (
    <div className="panel">
      <h3>조명 · {lights.length}</h3>
      {lights.map((l) => (
        <div
          key={l.id}
          className={`row click ${selection?.id === l.id ? 'sel' : ''} ${l.visible ? '' : 'dim'}`}
          onClick={() => select({ type: 'light', id: l.id })}
        >
          <span className="grow">{l.name}</span>
          <span className="tag">{l.kind}</span>
          <button
            className="mini"
            title="표시/숨김"
            onClick={(e) => {
              e.stopPropagation();
              updateLight(l.id, { visible: !l.visible });
            }}
          >
            {l.visible ? '◉' : '○'}
          </button>
        </div>
      ))}
      <h3>오브젝트 · {objects.length}</h3>
      {objects.map((o) => (
        <div
          key={o.id}
          className={`row click ${selection?.id === o.id ? 'sel' : ''} ${o.visible ? '' : 'dim'}`}
          onClick={() => select({ type: 'object', id: o.id })}
        >
          <span className="grow">{o.name}</span>
          <span className="tag">{o.kind === 'glb' ? (o.bytes ? formatBytes(o.bytes) : 'glb') : o.primitive}</span>
          <button
            className="mini"
            title="표시/숨김"
            onClick={(e) => {
              e.stopPropagation();
              updateObject(o.id, { visible: !o.visible });
            }}
          >
            {o.visible ? '◉' : '○'}
          </button>
        </div>
      ))}
    </div>
  );
}

const PRIMITIVES: { kind: PrimitiveKind; label: string; segments?: number }[] = [
  { kind: 'box', label: '상자' },
  { kind: 'cylinder', label: '원기둥' },
  { kind: 'cylinder', label: '팔각기둥', segments: 8 },
  { kind: 'cone', label: '원뿔' },
  { kind: 'sphere', label: '구' },
  { kind: 'capsule', label: '사람(캡슐)' },
];

const LIGHTS: { kind: LightKind; label: string }[] = [
  { kind: 'directional', label: '태양광' },
  { kind: 'point', label: '점광원' },
  { kind: 'hemisphere', label: '하늘광' },
  { kind: 'ambient', label: '환경광' },
];

export function AddPanel() {
  const fileInput = useRef<HTMLInputElement>(null);
  const readOnly = useScene((s) => s.readOnly);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const ui = useUi.getState();
    for (const file of Array.from(files)) {
      ui.set({ busy: `${file.name} 업로드 · 최적화 중…` });
      try {
        const r = await uploadGlb(file);
        const obj: SceneObject = {
          id: newId('obj'),
          name: file.name.replace(/\.glb$/i, ''),
          kind: 'glb',
          src: r.src,
          bytes: r.bytes,
          triangles: r.triangles,
          position: spawnPoint(),
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          visible: true,
          castShadow: true,
          receiveShadow: true,
        };
        useScene.getState().addObject(obj);
        ui.notify(
          `${obj.name}: ${formatBytes(r.originalBytes)} → ${formatBytes(r.bytes)}, ` +
            `삼각형 ${r.originalTriangles.toLocaleString()} → ${r.triangles.toLocaleString()}`,
        );
      } catch (err) {
        ui.notify(`${file.name} 업로드 실패: ${(err as Error).message}`, 'error');
      }
    }
    ui.set({ busy: null });
    if (fileInput.current) fileInput.current.value = '';
  };

  const addPrimitive = (p: (typeof PRIMITIVES)[number]) => {
    const pos = spawnPoint();
    const isPerson = p.kind === 'capsule';
    useScene.getState().addObject({
      id: newId('obj'),
      name: p.label,
      kind: 'primitive',
      primitive: p.kind,
      segments: p.segments,
      color: isPerson ? '#ece8df' : '#b0aaa0',
      position: [pos[0], isPerson ? 0.85 : 0.5, pos[2]],
      rotation: [0, 0, 0],
      scale: isPerson ? [0.45, 0.85, 0.45] : [1, 1, 1],
      visible: true,
      castShadow: true,
      receiveShadow: true,
    });
  };

  const addLight = (kind: LightKind, label: string) => {
    const pos = spawnPoint();
    useScene.getState().addLight({
      id: newId('light'),
      name: label,
      kind,
      color: '#ffffff',
      groundColor: kind === 'hemisphere' ? '#555544' : undefined,
      intensity: kind === 'point' ? 30 : 1,
      position: [pos[0], 6, pos[2]],
      castShadow: kind === 'directional',
      visible: true,
    });
  };

  if (readOnly) {
    return (
      <div className="panel">
        <p className="note">읽기 전용 배포입니다. 편집하려면 서버(npm run dev / npm start)로 실행하세요.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>3D 모델 (GLB)</h3>
      <button className="wide-btn" onClick={() => fileInput.current?.click()}>
        + GLB 파일 업로드
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".glb,model/gltf-binary"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => onFiles(e.target.files)}
      />
      <p className="note">
        업로드 시 서버가 자동 최적화합니다: 중복 제거, 메시 단순화(상한 초과 시), 텍스처 WebP 변환·축소, Meshopt 압축.
      </p>
      <h3>기본 도형 (임시 배치용)</h3>
      <div className="add-grid">
        {PRIMITIVES.map((p) => (
          <button key={p.label} onClick={() => addPrimitive(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <h3>조명</h3>
      <div className="add-grid">
        {LIGHTS.map((l) => (
          <button key={l.kind} onClick={() => addLight(l.kind, l.label)}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const past = useScene((s) => s.past);
  const future = useScene((s) => s.future);
  const { undo, redo, jumpTo } = useScene.getState();
  return (
    <div className="panel">
      <h3>히스토리</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button className="mini" disabled={!past.length} onClick={undo}>
          ↶ 실행 취소 (Ctrl+Z)
        </button>
        <button className="mini" disabled={!future.length} onClick={redo}>
          ↷ 다시 실행 (Ctrl+Y)
        </button>
      </div>
      <div className="row click" onClick={() => jumpTo(0)}>
        <span className="grow">● 불러온 상태</span>
      </div>
      {past.map((h, i) => (
        <div key={i} className="row click" onClick={() => jumpTo(i + 1)}>
          <span className="grow">
            {i + 1}. {h.label}
          </span>
        </div>
      ))}
      {future.map((h, i) => (
        <div key={`f${i}`} className="row dim">
          <span className="grow">↷ {h.label}</span>
        </div>
      ))}
    </div>
  );
}

export function SettingsPanel() {
  const settings = useScene((s) => s.doc?.settings);
  const readOnly = useScene((s) => s.readOnly);
  if (!settings) return null;
  const upd = useScene.getState().updateSettings;
  const { portal, viewer, fog } = settings;

  return (
    <div className="panel" style={readOnly ? { pointerEvents: 'none', opacity: 0.6 } : undefined}>
      <h3>포탈 창 (가상 창문)</h3>
      <VecField label="중심 위치" value={portal.center} onChange={(v) => upd((s) => void (s.portal.center = v), '포탈 위치', 'portal.center')} />
      <Field label="창 너비 m">
        <NumberInput value={portal.width} step={0.5} min={0.5} onChange={(v) => upd((s) => void (s.portal.width = v), '포탈 너비', 'portal.width')} />
      </Field>
      <Field label="방향 °">
        <NumberInput value={portal.yawDeg} step={5} onChange={(v) => upd((s) => void (s.portal.yawDeg = v), '포탈 방향', 'portal.yaw')} />
      </Field>
      <Field label="광각 배율">
        <NumberInput value={portal.fovScale ?? 1} step={0.1} min={0.3} max={4} onChange={(v) => upd((s) => void (s.portal.fovScale = v), '광각 배율', 'portal.fov')} />
      </Field>
      <Field label="시선 높이">
        <NumberInput value={portal.eyeOffsetY ?? 0} step={0.01} onChange={(v) => upd((s) => void (s.portal.eyeOffsetY = v), '시선 높이', 'portal.eyeY')} />
      </Field>
      <p className="note">광각 배율 1 = 실제 창문과 같은 화각. 값을 키우면 화각이 넓어집니다. 시선 높이를 음수로 하면 시선이 창 중심보다 낮아져 위쪽이 더 보입니다.</p>

      <h3>화면 · 웹캠 보정</h3>
      <Field label="화면 너비 cm">
        <NumberInput value={viewer.screenWidthCm} step={0.5} min={5} onChange={(v) => upd((s) => void (s.viewer.screenWidthCm = v), '화면 너비', 'viewer.w')} />
      </Field>
      <Field label="웹캠 화각 °">
        <NumberInput value={viewer.webcamFovDeg} step={1} min={30} max={120} onChange={(v) => upd((s) => void (s.viewer.webcamFovDeg = v), '웹캠 화각', 'viewer.fov')} />
      </Field>
      <Field label="기본 거리 cm">
        <NumberInput value={viewer.defaultDistanceCm} step={5} min={20} onChange={(v) => upd((s) => void (s.viewer.defaultDistanceCm = v), '기본 거리', 'viewer.dist')} />
      </Field>
      <p className="note">
        화면 너비: 화면 표시 영역의 실제 가로 길이(자로 측정). 13인치 노트북 약 29cm, 15인치 약 34cm, 24인치 모니터 약 53cm.
        웹캠 화각은 기기마다 달라 기본값 60°는 근사치입니다.
      </p>

      <h3>분위기</h3>
      <ColorField label="배경" value={settings.background} onChange={(v) => upd((s) => void (s.background = v), '배경색', 'bg')} />
      <CheckField label="안개" value={fog.enabled} onChange={(v) => upd((s) => void (s.fog.enabled = v), '안개')} />
      <ColorField label="안개 색" value={fog.color} onChange={(v) => upd((s) => void (s.fog.color = v), '안개 색', 'fog.c')} />
      <RangeField label="안개 시작" value={fog.near} min={0} max={200} step={1} onChange={(v) => upd((s) => void (s.fog.near = v), '안개 범위', 'fog.n')} />
      <RangeField label="안개 끝" value={fog.far} min={1} max={400} step={1} onChange={(v) => upd((s) => void (s.fog.far = v), '안개 범위', 'fog.f')} />
      <CheckField label="그림자" value={settings.shadows} onChange={(v) => upd((s) => void (s.shadows = v), '그림자')} />
    </div>
  );
}

export function Inspector() {
  const obj = useScene(selectedObject);
  const light = useScene(selectedLight);
  const readOnly = useScene((s) => s.readOnly);
  const transformMode = useScene((s) => s.transformMode);
  const { updateObject, updateLight, removeSelected, duplicateSelected, setTransformMode } = useScene.getState();
  if ((!obj && !light) || readOnly) return null;

  if (light) {
    const key = (f: string) => `${light.id}.${f}`;
    return (
      <div className="panel right">
        <h3>조명</h3>
        <Field label="이름">
          <input type="text" value={light.name} onChange={(e) => updateLight(light.id, { name: e.target.value }, key('name'))} />
        </Field>
        <ColorField label="색" value={light.color} onChange={(v) => updateLight(light.id, { color: v }, key('color'))} />
        {light.kind === 'hemisphere' && (
          <ColorField label="지면 색" value={light.groundColor ?? '#444444'} onChange={(v) => updateLight(light.id, { groundColor: v }, key('ground'))} />
        )}
        <Field label="세기">
          <NumberInput value={light.intensity} step={0.1} min={0} onChange={(v) => updateLight(light.id, { intensity: v }, key('int'))} />
        </Field>
        <VecField label="위치" value={light.position} onChange={(v) => updateLight(light.id, { position: v }, key('pos'))} />
        {(light.kind === 'directional' || light.kind === 'point') && (
          <CheckField label="그림자" value={light.castShadow} onChange={(v) => updateLight(light.id, { castShadow: v })} />
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button className="mini" onClick={duplicateSelected}>복제</button>
          <button className="mini" onClick={removeSelected}>삭제</button>
        </div>
      </div>
    );
  }

  const o = obj!;
  const key = (f: string) => `${o.id}.${f}`;
  return (
    <div className="panel right">
      <h3>오브젝트</h3>
      <Field label="이름">
        <input type="text" value={o.name} onChange={(e) => updateObject(o.id, { name: e.target.value }, key('name'))} />
      </Field>
      <div className="seg" style={{ margin: '8px 0' }}>
        {(
          [
            ['translate', '이동 E'],
            ['rotate', '회전 R'],
            ['scale', '크기 T'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={transformMode === m ? 'on' : ''} onClick={() => setTransformMode(m)}>
            {label}
          </button>
        ))}
      </div>
      <VecField label="위치 m" value={o.position} onChange={(v) => updateObject(o.id, { position: v }, key('pos'))} />
      <VecField label="회전 °" step={5} value={o.rotation} onChange={(v) => updateObject(o.id, { rotation: v }, key('rot'))} />
      <VecField label="크기" value={o.scale} onChange={(v) => updateObject(o.id, { scale: v }, key('scale'))} />
      <Field label="균등 크기">
        <NumberInput
          value={o.scale[0]}
          step={0.1}
          min={0.001}
          onChange={(v) => updateObject(o.id, { scale: [v, v, v] }, key('scale'))}
        />
      </Field>
      {o.kind === 'primitive' && (
        <ColorField label="색" value={o.color ?? '#cccccc'} onChange={(v) => updateObject(o.id, { color: v }, key('color'))} />
      )}
      <CheckField label="그림자 생성" value={o.castShadow} onChange={(v) => updateObject(o.id, { castShadow: v })} />
      <CheckField label="그림자 받음" value={o.receiveShadow} onChange={(v) => updateObject(o.id, { receiveShadow: v })} />
      {o.kind === 'glb' && (
        <p className="note">
          {o.src}
          <br />
          {o.bytes ? formatBytes(o.bytes) : ''} {o.triangles ? `· 삼각형 ${o.triangles.toLocaleString()}` : ''}
        </p>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button className="mini" onClick={duplicateSelected}>
          복제 (Ctrl+D)
        </button>
        <button className="mini" onClick={removeSelected}>
          삭제 (Del)
        </button>
      </div>
    </div>
  );
}
