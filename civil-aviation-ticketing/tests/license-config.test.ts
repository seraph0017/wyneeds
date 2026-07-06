import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActivationServerUrl } from '../server/license/config';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanup.length = 0;
});

describe('license activation server config', () => {
  it('prefers env URL over config files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'license-config-'));
    cleanup.push(dir);
    await writeFile(path.join(dir, 'license-config.json'), JSON.stringify({ licenseServerUrl: 'https://file.example.com' }), 'utf8');

    const result = await resolveActivationServerUrl({
      envUrl: 'https://env.example.com',
      candidateDirs: [dir],
    });

    expect(result).toEqual({ url: 'https://env.example.com', source: 'env' });
  });

  it('reads license-config.json from candidate directories for double-click portable distribution', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'license-config-'));
    cleanup.push(dir);
    await writeFile(path.join(dir, 'license-config.json'), JSON.stringify({ licenseServerUrl: 'http://127.0.0.1:8787' }), 'utf8');

    const result = await resolveActivationServerUrl({ candidateDirs: [dir] });

    expect(result).toEqual({ url: 'http://127.0.0.1:8787', source: path.join(dir, 'license-config.json') });
  });

  it('ignores missing and malformed config files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'license-config-'));
    cleanup.push(dir);
    await writeFile(path.join(dir, 'license-config.json'), '{bad json', 'utf8');

    await expect(resolveActivationServerUrl({ candidateDirs: [dir] })).resolves.toEqual({ url: undefined, source: undefined });
  });

  it('rejects plain http for non-local authorization hosts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'license-config-'));
    cleanup.push(dir);
    await writeFile(path.join(dir, 'license-config.json'), JSON.stringify({ licenseServerUrl: 'http://license.example.com' }), 'utf8');

    await expect(resolveActivationServerUrl({ candidateDirs: [dir] })).resolves.toEqual({ url: undefined, source: undefined });
  });
});
