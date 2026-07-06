import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LicenseEnvelope } from './types';

export class LicenseStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<LicenseEnvelope | undefined> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as LicenseEnvelope;
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      if (error instanceof SyntaxError) return undefined;
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

export function resolveLicenseFile(customDir?: string): string {
  const dataDir = customDir ?? process.env.CA_TICKETING_DATA_DIR ?? path.resolve(process.cwd(), '.local-data');
  return path.join(dataDir, 'license.json');
}
