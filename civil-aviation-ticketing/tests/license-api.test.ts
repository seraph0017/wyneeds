import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../server/server';
import { signLicensePayload } from '../server/license/crypto';
import { hashDeviceFingerprint } from '../server/license/device';
import { LICENSE_APP_ID, LICENSE_PRODUCT, type LicensePayload } from '../server/license/types';

let cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.map((item) => item()));
  cleanup = [];
});

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function payload(deviceHash: string): LicensePayload {
  return {
    schemaVersion: 1,
    appId: LICENSE_APP_ID,
    product: LICENSE_PRODUCT,
    licenseId: 'LIC-API-001',
    inviteCodeHash: 'INVITEHASH',
    customerName: '接口测试客户',
    deviceHash,
    maxDevices: 1,
    features: ['ticketing', 'training', 'desktop'],
    issuedAt: '2026-07-06T00:00:00.000Z',
    activatedAt: '2026-07-06T00:00:00.000Z',
    expiresAt: '2027-07-06',
    offlineGraceDays: 30,
  };
}

async function licensedServer(options: { publicKeyPem: string; deviceHash: string; activationServerUrl?: string }) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'license-api-'));
  const server = await startServer({
    port: 0,
    dataDir,
    enableCors: true,
    licenseRequired: true,
    licensePublicKeyPem: options.publicKeyPem,
    licenseDeviceHash: options.deviceHash,
    licenseActivationUrl: options.activationServerUrl,
  });
  cleanup.push(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.port}`;
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('license protected API', () => {
  it('keeps license endpoints open but blocks business APIs until a valid license is imported', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const deviceHash = hashDeviceFingerprint('api-device');
    const baseUrl = await licensedServer({ publicKeyPem, deviceHash });

    const statusBefore = await json(await fetch(`${baseUrl}/api/license/status`));
    const blocked = await fetch(`${baseUrl}/api/cities`);

    expect(statusBefore).toMatchObject({ licensed: false, activationRequired: true });
    expect(blocked.status).toBe(403);
    expect(await json(blocked)).toMatchObject({ code: 'LICENSE_REQUIRED' });

    const envelope = signLicensePayload(payload(deviceHash), privateKeyPem, 'test-key');
    const imported = await fetch(`${baseUrl}/api/license/offline-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope }),
    });
    expect(imported.status).toBe(200);
    expect(await json(imported)).toMatchObject({ licensed: true });

    const cities = await fetch(`${baseUrl}/api/cities`);
    expect(cities.status).toBe(200);
    expect(Array.isArray(await cities.json())).toBe(true);
  });

  it('activates through a configured remote license service and then works offline from the saved license', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const deviceHash = hashDeviceFingerprint('remote-api-device');
    let remoteServer: Server | undefined;
    const remote = await new Promise<string>((resolve) => {
      remoteServer = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { deviceHash: string };
        const envelope = signLicensePayload(payload(body.deviceHash), privateKeyPem, 'test-key');
        const response = JSON.stringify({ ok: true, envelope, reused: false });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(response);
      }).listen(0, '127.0.0.1', () => {
        const address = remoteServer!.address();
        if (address && typeof address === 'object') resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    cleanup.push(async () => new Promise<void>((resolve) => {
      if (!remoteServer) return resolve();
      return remoteServer.close(() => resolve());
    }));

    const baseUrl = await licensedServer({ publicKeyPem, deviceHash, activationServerUrl: remote });
    const activated = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: 'WY-2026-ABCD' }),
    });

    expect(activated.status).toBe(200);
    expect(await json(activated)).toMatchObject({ licensed: true, summary: { customerName: '接口测试客户' } });
    await new Promise<void>((resolve) => remoteServer!.close(() => resolve()));
    remoteServer = undefined;

    const statusAfterRemoteClosed = await json(await fetch(`${baseUrl}/api/license/status`));
    const cities = await fetch(`${baseUrl}/api/cities`);

    expect(statusAfterRemoteClosed).toMatchObject({ licensed: true, summary: { customerName: '接口测试客户' } });
    expect(cities.status).toBe(200);
  });

  it('preserves remote activation status codes for invite and device-limit errors', async () => {
    const { publicKeyPem } = keys();
    const deviceHash = hashDeviceFingerprint('remote-denied-device');
    let remoteServer: Server | undefined;
    const remote = await new Promise<string>((resolve) => {
      remoteServer = createServer((_req, res) => {
        const response = JSON.stringify({ ok: false, code: 'DEVICE_LIMIT_REACHED', message: '邀请码可绑定设备数已用完' });
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(response);
      }).listen(0, '127.0.0.1', () => {
        const address = remoteServer!.address();
        if (address && typeof address === 'object') resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    cleanup.push(async () => new Promise<void>((resolve) => {
      if (!remoteServer) return resolve();
      return remoteServer.close(() => resolve());
    }));

    const baseUrl = await licensedServer({ publicKeyPem, deviceHash, activationServerUrl: remote });
    const response = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: 'WY-2026-USED' }),
    });
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      licensed: false,
      remoteCode: 'DEVICE_LIMIT_REACHED',
      remoteStatus: 409,
      message: '邀请码可绑定设备数已用完',
    });
  });
});
