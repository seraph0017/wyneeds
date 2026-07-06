import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ActivationServerConfigInput {
  envUrl?: string;
  candidateDirs?: Array<string | undefined>;
}

export interface ActivationServerConfigResult {
  url?: string;
  source?: string;
}

function isLocalHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function normalizeActivationServerUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.protocol === 'http:' && !isLocalHttpHost(url.hostname)) return undefined;
    return trimmed.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export async function resolveActivationServerUrl(input: ActivationServerConfigInput = {}): Promise<ActivationServerConfigResult> {
  const envUrl = normalizeActivationServerUrl(input.envUrl ?? process.env.CA_LICENSE_SERVER_URL);
  if (envUrl) return { url: envUrl, source: 'env' };

  const seen = new Set<string>();
  for (const dir of input.candidateDirs ?? []) {
    if (!dir) continue;
    const filePath = path.join(dir, 'license-config.json');
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as { licenseServerUrl?: unknown; serverUrl?: unknown };
      const fileUrl = normalizeActivationServerUrl(parsed.licenseServerUrl ?? parsed.serverUrl);
      if (fileUrl) return { url: fileUrl, source: filePath };
    } catch {
      // Missing or malformed config files are ignored; the UI will show unconfigured state.
    }
  }

  return { url: undefined, source: undefined };
}
