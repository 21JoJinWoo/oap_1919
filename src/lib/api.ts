import type { SceneDoc, UploadResult } from '../types';

const TOKEN_KEY = 'oap1919:edit-token';
const DRAFT_KEY = 'oap1919:draft';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Sends an authenticated request, asking for the edit password once on 401. */
async function authFetch(url: string, init: RequestInit): Promise<Response> {
  const attempt = () =>
    fetch(url, { ...init, headers: { ...(init.headers ?? {}), 'x-edit-token': token() ?? '' } });
  let res = await attempt();
  if (res.status === 401) {
    const entered = window.prompt('편집 비밀번호를 입력하세요 (서버의 EDIT_TOKEN)');
    if (!entered) throw new ApiError('편집 권한이 없습니다.', 401);
    try {
      localStorage.setItem(TOKEN_KEY, entered);
    } catch {
      /* storage unavailable: token lives for this request only */
    }
    res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), 'x-edit-token': entered } });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(body.error ?? `요청 실패 (${res.status})`, res.status);
  }
  return res;
}

/**
 * Loads the scene from the API server, falling back to the static
 * `scene.json` emitted by `vite build` (read-only hosting).
 */
export async function loadScene(): Promise<{ doc: SceneDoc; readOnly: boolean }> {
  try {
    const res = await fetch('/api/scene', { cache: 'no-store' });
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      return { doc: (await res.json()) as SceneDoc, readOnly: false };
    }
  } catch {
    /* fall through to static file */
  }
  const res = await fetch(`${import.meta.env.BASE_URL}scene.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error('장면 데이터를 불러오지 못했습니다.');
  return { doc: (await res.json()) as SceneDoc, readOnly: true };
}

export async function saveScene(doc: SceneDoc, baseUpdatedAt: string | null): Promise<string> {
  const res = await authFetch('/api/scene', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-base-updated-at': baseUpdatedAt ?? '' },
    body: JSON.stringify(doc),
  });
  const body = (await res.json()) as { updatedAt: string };
  return body.updatedAt;
}

export async function uploadGlb(file: File): Promise<UploadResult> {
  const res = await authFetch(`/api/models?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'model/gltf-binary' },
    body: file,
  });
  return (await res.json()) as UploadResult;
}

export interface Draft {
  doc: SceneDoc;
  baseUpdatedAt: string | null;
}

export function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function writeDraft(draft: Draft | null): void {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* quota exceeded or storage disabled: drafts are a convenience only */
  }
}
