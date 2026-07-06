import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LicenseEnvelope } from './types';

export class LicenseFileMalformedError extends Error {
  constructor(readonly filePath: string) {
    super('授权文件格式不正确');
  }
}

export interface LicenseRuntimeState {
  schemaVersion: 1;
  licenseId: string;
  lastOnlineCheckAt?: string;
  lastCheckStatus?: 'active' | 'revoked' | 'expired' | 'unknown';
}

export class LicenseStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<LicenseEnvelope | undefined> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as LicenseEnvelope;
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      if (error instanceof SyntaxError) throw new LicenseFileMalformedError(this.filePath);
      throw error;
    }
  }

  async write(envelope: LicenseEnvelope): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(envelope, null, 2), 'utf8');
    await rename(tempPath, this.filePath);
  }
}

export class LicenseStateStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<LicenseRuntimeState | undefined> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LicenseRuntimeState>;
      if (parsed.schemaVersion !== 1 || typeof parsed.licenseId !== 'string') return undefined;
      return {
        schemaVersion: 1,
        licenseId: parsed.licenseId,
        lastOnlineCheckAt: typeof parsed.lastOnlineCheckAt === 'string' ? parsed.lastOnlineCheckAt : undefined,
        lastCheckStatus: parsed.lastCheckStatus,
      };
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'ENOENT' || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async write(state: LicenseRuntimeState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(tempPath, this.filePath);
  }
}

export function resolveLicenseFile(customDir?: string): string {
  const dataDir = customDir ?? process.env.CA_TICKETING_DATA_DIR ?? path.resolve(process.cwd(), '.local-data');
  return path.join(dataDir, 'license.json');
}

export function resolveLicenseStateFile(customDir?: string): string {
  const dataDir = customDir ?? process.env.CA_TICKETING_DATA_DIR ?? path.resolve(process.cwd(), '.local-data');
  return path.join(dataDir, 'license-state.json');
}
