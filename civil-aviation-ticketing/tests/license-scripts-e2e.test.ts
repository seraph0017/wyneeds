import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { hashDeviceFingerprint } from '../server/license/device';
import { verifyLicenseEnvelope } from '../server/license/crypto';
import { LICENSE_APP_ID, LICENSE_PRODUCT } from '../server/license/types';

const cleanupDirs: string[] = [];
const cleanupProcesses: ChildProcess[] = [];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterEach(async () => {
  await Promise.all(cleanupProcesses.splice(0).map((child) => stopProcess(child)));
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') return reject(new Error('无法分配测试端口'));
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function runNpmScript(script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', script, '--', ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `脚本 ${script} 退出码 ${code}`).trim()));
    });
  });
}

function startLicenseServer(env: NodeJS.ProcessEnv): Promise<{ child: ChildProcess; output: () => string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', 'license:server'], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanupProcesses.push(child);
    let output = '';
    const timer = setTimeout(() => reject(new Error(`授权服务启动超时：${output}`)), 10_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('License server listening')) {
        clearTimeout(timer);
        resolve({ child, output: () => output });
      }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!output.includes('License server listening')) reject(new Error(`授权服务提前退出：${code}\n${output}`));
    });
  });
}

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) return resolve();
    child.once('close', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      resolve();
    }, 2000).unref();
  });
}

describe('license CLI and standalone service scripts', () => {
  it('rejects invalid invite CLI arguments before touching production defaults', async () => {
    const dir = await tempDir('license-cli-validation-');
    const dbPath = path.join(dir, 'invites.json');

    await expect(runNpmScript('license:invite', ['--db', dbPath, '--customer', '测试客户', '--max-devices', '0']))
      .rejects.toThrow('--max-devices 必须是正整数');
    await expect(runNpmScript('license:invite', ['--db', dbPath, '--customer', '测试客户', '--license-days', 'NaN']))
      .rejects.toThrow('--license-days 必须是正整数');
    await expect(runNpmScript('license:invite', ['--db', dbPath, '--customer', '测试客户', '--expires-at', '2026-02-31']))
      .rejects.toThrow('--expires-at 必须是 YYYY-MM-DD 格式');
  });

  it('generates keys, creates an invite, activates through the real license server script, and checks it', async () => {
    const dir = await tempDir('license-script-e2e-');
    const secretsDir = path.join(dir, 'secrets');
    const dbPath = path.join(dir, 'invites.json');
    const code = 'WY-2026-E2E1-E2E2';
    const deviceHash = hashDeviceFingerprint('script-e2e-device');

    await runNpmScript('license:keys', ['--out-dir', secretsDir]);
    await runNpmScript('license:invite', [
      '--db', dbPath,
      '--customer', '脚本联调客户',
      '--code', code,
      '--max-devices', '1',
      '--license-days', '365',
      '--expires-at', '2027-07-06',
    ]);

    const port = await freePort();
    await startLicenseServer({
      CA_LICENSE_DB_PATH: dbPath,
      CA_LICENSE_PRIVATE_KEY_PATH: path.join(secretsDir, 'license-private-key.pem'),
      CA_LICENSE_PORT: String(port),
      CA_LICENSE_PUBLIC_URL: `http://127.0.0.1:${port}`,
    });

    const activated = await fetch(`http://127.0.0.1:${port}/v1/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: code, deviceHash, appVersion: '1.1.0' }),
    });
    const activationBody = await activated.json();
    const publicKeyPem = await readFile(path.join(secretsDir, 'license-public-key.pem'), 'utf8');

    expect(activated.status).toBe(200);
    expect(activationBody).toMatchObject({ ok: true, reused: false });
    expect(activationBody.envelope.payload.licenseServerUrl).toBe(`http://127.0.0.1:${port}`);
    expect(verifyLicenseEnvelope(activationBody.envelope, {
      publicKeyPem,
      expectedDeviceHash: deviceHash,
      now: new Date('2026-07-07T00:00:00.000Z'),
      expectedAppId: LICENSE_APP_ID,
      expectedProduct: LICENSE_PRODUCT,
    })).toMatchObject({ valid: true });

    const check = await fetch(`http://127.0.0.1:${port}/v1/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseId: activationBody.envelope.payload.licenseId, deviceHash }),
    });

    expect(check.status).toBe(200);
    expect(await check.json()).toMatchObject({ ok: true, status: 'active', message: '授权有效', receipt: { algorithm: 'Ed25519' } });
  });
});
