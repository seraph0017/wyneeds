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
const originalEnvPublicKey = process.env.CA_LICENSE_PUBLIC_KEY_PEM;

afterEach(async () => {
  if (originalEnvPublicKey === undefined) delete process.env.CA_LICENSE_PUBLIC_KEY_PEM;
  else process.env.CA_LICENSE_PUBLIC_KEY_PEM = originalEnvPublicKey;
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
    licenseId: 'LIC-ENV-BYPASS',
    inviteCodeHash: 'INVITEHASH',
    customerName: '自签客户',
    deviceHash,
    maxDevices: 1,
    features: ['ticketing', 'training', 'desktop'],
    issuedAt: '2026-07-06T00:00:00.000Z',
    activatedAt: '2026-07-06T00:00:00.000Z',
    expiresAt: '2027-07-06',
    offlineGraceDays: 30,
  };
}

async function server(options: Parameters<typeof startServer>[0] = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'license-security-'));
  const started = await startServer({ port: 0, dataDir, enableCors: true, ...options });
  cleanup.push(async () => {
    await started.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${started.port}`;
}

describe('license security boundaries', () => {
  it('does not let CA_LICENSE_PUBLIC_KEY_PEM replace the production trust root', async () => {
    const attackerKeys = keys();
    process.env.CA_LICENSE_PUBLIC_KEY_PEM = attackerKeys.publicKeyPem;
    const deviceHash = hashDeviceFingerprint('attacker-device');
    const baseUrl = await server({ licenseRequired: true, licenseDeviceHash: deviceHash });
    const attackerEnvelope = signLicensePayload(payload(deviceHash), attackerKeys.privateKeyPem, 'attacker-key');

    const imported = await fetch(`${baseUrl}/api/license/offline-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope: attackerEnvelope }),
    });
    const cities = await fetch(`${baseUrl}/api/cities`);

    expect(imported.status).toBe(422);
    expect(cities.status).toBe(403);
  });

  it('starts protected by default unless development explicitly disables licensing', async () => {
    const baseUrl = await server();
    const status = await (await fetch(`${baseUrl}/api/license/status`)).json() as { licensed: boolean; activationRequired: boolean };
    const cities = await fetch(`${baseUrl}/api/cities`);

    expect(status).toMatchObject({ licensed: false, activationRequired: true });
    expect(cities.status).toBe(403);
  });

  it('requires the per-launch local API token when configured', async () => {
    const baseUrl = await server({ licenseRequired: false, apiToken: 'session-token' });

    const blocked = await fetch(`${baseUrl}/api/cities`);
    const allowed = await fetch(`${baseUrl}/api/cities`, { headers: { 'X-CA-Session': 'session-token' } });

    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: 'SESSION_REQUIRED' });
    expect(allowed.status).toBe(200);
  });
});
