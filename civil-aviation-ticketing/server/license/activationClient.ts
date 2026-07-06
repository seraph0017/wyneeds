import type { LicenseEnvelope } from './types';

export type ActivationClientResult =
  | { ok: true; envelope: LicenseEnvelope; reused?: boolean }
  | { ok: false; code: string; message: string; status?: number };

export interface RemoteActivationRequest {
  inviteCode: string;
  deviceHash: string;
  appVersion?: string;
}

export interface RemoteCheckRequest {
  licenseId: string;
  deviceHash: string;
}

export interface RemoteCheckResult {
  ok: boolean;
  status?: 'active' | 'revoked' | 'unknown';
  message: string;
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorPayload = payload as { code?: string; message?: string };
      throw Object.assign(new Error(errorPayload.message || `授权服务返回 ${response.status}`), {
        status: response.status,
        code: errorPayload.code || 'REMOTE_ERROR',
      });
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function activateWithServer(serverUrl: string, request: RemoteActivationRequest, timeoutMs = 8000): Promise<ActivationClientResult> {
  const base = serverUrl.replace(/\/+$/, '');
  try {
    return await postJson<ActivationClientResult>(`${base}/v1/activate`, request, timeoutMs);
  } catch (error) {
    const err = error as { message?: string; status?: number; code?: string; name?: string };
    return {
      ok: false,
      code: err.name === 'AbortError' ? 'TIMEOUT' : err.code || 'NETWORK_ERROR',
      message: err.name === 'AbortError' ? '授权服务连接超时' : err.message || '授权服务不可用',
      status: err.status,
    };
  }
}

export async function checkWithServer(serverUrl: string, request: RemoteCheckRequest, timeoutMs = 5000): Promise<RemoteCheckResult> {
  const base = serverUrl.replace(/\/+$/, '');
  try {
    return await postJson<RemoteCheckResult>(`${base}/v1/check`, request, timeoutMs);
  } catch (error) {
    const err = error as { message?: string; name?: string };
    return { ok: false, message: err.name === 'AbortError' ? '授权复核连接超时' : err.message || '授权复核服务不可用' };
  }
}
