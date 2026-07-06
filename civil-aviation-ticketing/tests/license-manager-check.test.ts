import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signLicenseCheckReceipt, signLicensePayload } from '../server/license/crypto';
import { hashDeviceFingerprint } from '../server/license/device';
import { LicenseManager } from '../server/license/manager';
import { LicenseStateStore } from '../server/license/store';
import { LICENSE_APP_ID, LICENSE_PRODUCT, type LicensePayload } from '../server/license/types';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.map((item) => item()));
  cleanup.length = 0;
});

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function payload(deviceHash: string, offlineGraceDays = 1, licenseServerUrl?: string): LicensePayload {
  return {
    schemaVersion: 1,
    appId: LICENSE_APP_ID,
    product: LICENSE_PRODUCT,
    licenseId: 'LIC-CHECK-001',
    inviteCodeHash: 'INVITEHASH',
    customerName: '复核客户',
    deviceHash,
    maxDevices: 1,
    features: ['ticketing', 'training', 'desktop'],
    issuedAt: '2026-07-01T00:00:00.000Z',
    activatedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2027-07-06',
    offlineGraceDays,
    licenseServerUrl,
  };
}

async function tempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'license-manager-'));
  cleanup.push(async () => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function mockCheckServer(status: 'active' | 'revoked' | 'unknown', privateKeyPem: string, checkedAt = '2026-07-05T00:00:00.000Z') {
  let requests = 0;
  let server: Server | undefined;
  const url = await new Promise<string>((resolve) => {
    server = createServer(async (req, res) => {
      requests += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { licenseId: string; deviceHash: string };
      const message = status === 'active' ? '授权有效' : status === 'unknown' ? '授权记录不存在' : '授权已被停用';
      const receipt = signLicenseCheckReceipt({
        schemaVersion: 1,
        appId: LICENSE_APP_ID,
        licenseId: body.licenseId,
        deviceHash: body.deviceHash,
        status,
        message,
        checkedAt,
      }, privateKeyPem, 'test-key');
      const response = JSON.stringify({ ok: true, status, message, receipt });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(response);
    }).listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address && typeof address === 'object') resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  cleanup.push(async () => new Promise<void>((resolve) => server?.close(() => resolve())));
  return { url, requests: () => requests };
}

describe('license manager online recheck', () => {
  it('reports malformed instead of missing when the local license file is corrupted', async () => {
    const { publicKeyPem } = keys();
    const dir = await tempDir();
    await writeFile(path.join(dir, 'license.json'), '{bad json', 'utf8');

    const manager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash: hashDeviceFingerprint('device-a') });
    const status = await manager.status();

    expect(status).toMatchObject({ licensed: false, reason: 'MALFORMED' });
  });

  it('locks a license when online recheck says it was revoked after the offline grace window', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const deviceHash = hashDeviceFingerprint('device-a');
    const dir = await tempDir();
    const remote = await mockCheckServer('revoked', privateKeyPem);
    const importManager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, now: () => new Date('2026-07-01T00:00:00.000Z') });
    await importManager.importOffline(signLicensePayload(payload(deviceHash, 1), privateKeyPem, 'test-key'));
    const manager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, activationServerUrl: remote.url, now: () => new Date('2026-07-05T00:00:00.000Z') });
    await new LicenseStateStore(path.join(dir, 'license-state.json')).write({ schemaVersion: 1, licenseId: 'LIC-CHECK-001', lastOnlineCheckAt: '2026-07-01T00:00:00.000Z', lastCheckStatus: 'active' });

    const status = await manager.status();

    expect(status).toMatchObject({ licensed: false, reason: 'REVOKED' });
    expect(remote.requests()).toBe(1);
  });

  it('refreshes lastOnlineCheckAt when online recheck is active', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const deviceHash = hashDeviceFingerprint('device-a');
    const dir = await tempDir();
    const remote = await mockCheckServer('active', privateKeyPem);
    const importManager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, now: () => new Date('2026-07-01T00:00:00.000Z') });
    await importManager.importOffline(signLicensePayload(payload(deviceHash, 1), privateKeyPem, 'test-key'));
    const manager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, activationServerUrl: remote.url, now: () => new Date('2026-07-05T00:00:00.000Z') });
    const stateStore = new LicenseStateStore(path.join(dir, 'license-state.json'));
    await stateStore.write({ schemaVersion: 1, licenseId: 'LIC-CHECK-001', lastOnlineCheckAt: '2026-07-01T00:00:00.000Z', lastCheckStatus: 'active' });

    const status = await manager.status();
    const state = await stateStore.read();

    expect(status.licensed).toBe(true);
    expect(state?.lastOnlineCheckAt).toBe('2026-07-05T00:00:00.000Z');
  });

  it('does not reset the online grace window when importing an offline license again', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const deviceHash = hashDeviceFingerprint('device-a');
    const dir = await tempDir();
    const manager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, now: () => new Date('2026-07-05T00:00:00.000Z') });
    const envelope = signLicensePayload(payload(deviceHash, 1), privateKeyPem, 'test-key');

    await manager.importOffline(envelope);
    await manager.importOffline(envelope);
    const status = await manager.status();
    const state = await new LicenseStateStore(path.join(dir, 'license-state.json')).read();

    expect(status).toMatchObject({ licensed: false, reason: 'ONLINE_CHECK_REQUIRED' });
    expect(state).toBeUndefined();
  });

  it('rejects unsigned fake online check responses and future local state timestamps', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const deviceHash = hashDeviceFingerprint('device-a');
    const dir = await tempDir();
    let server: Server | undefined;
    const url = await new Promise<string>((resolve) => {
      server = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'active', message: '授权有效' }));
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        if (address && typeof address === 'object') resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    cleanup.push(async () => new Promise<void>((resolve) => server?.close(() => resolve())));
    const manager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, activationServerUrl: url, now: () => new Date('2026-07-05T00:00:00.000Z') });
    const importManager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, now: () => new Date('2026-07-01T00:00:00.000Z') });
    await importManager.importOffline(signLicensePayload(payload(deviceHash, 1), privateKeyPem, 'test-key'));
    await new LicenseStateStore(path.join(dir, 'license-state.json')).write({ schemaVersion: 1, licenseId: 'LIC-CHECK-001', lastOnlineCheckAt: '2099-01-01T00:00:00.000Z', lastCheckStatus: 'active' });

    const status = await manager.status();

    expect(status).toMatchObject({ licensed: false, reason: 'ONLINE_CHECK_REQUIRED' });
    expect(status.message).toContain('回执');
  });

  it('uses the signed license server URL for rechecks even if local config points elsewhere', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const deviceHash = hashDeviceFingerprint('device-a');
    const dir = await tempDir();
    const trusted = await mockCheckServer('active', privateKeyPem);
    let fakeServer: Server | undefined;
    const fakeUrl = await new Promise<string>((resolve) => {
      fakeServer = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'active', message: '伪造有效' }));
      }).listen(0, '127.0.0.1', () => {
        const address = fakeServer!.address();
        if (address && typeof address === 'object') resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    cleanup.push(async () => new Promise<void>((resolve) => fakeServer?.close(() => resolve())));
    const manager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, activationServerUrl: fakeUrl, now: () => new Date('2026-07-05T00:00:00.000Z') });
    const importManager = new LicenseManager({ dataDir: dir, publicKeyPem, deviceHash, now: () => new Date('2026-07-01T00:00:00.000Z') });
    await importManager.importOffline(signLicensePayload(payload(deviceHash, 1, trusted.url), privateKeyPem, 'test-key'));
    await new LicenseStateStore(path.join(dir, 'license-state.json')).write({ schemaVersion: 1, licenseId: 'LIC-CHECK-001', lastOnlineCheckAt: '2026-07-01T00:00:00.000Z', lastCheckStatus: 'active' });

    const status = await manager.status();

    expect(status.licensed).toBe(true);
    expect(trusted.requests()).toBe(1);
  });
});
