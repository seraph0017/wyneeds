import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createInviteRecord, saveInviteDatabase, activateInvite, checkLicense } from '../server/license/issuer';
import { verifyLicenseEnvelope } from '../server/license/crypto';
import { hashDeviceFingerprint } from '../server/license/device';
import { LICENSE_APP_ID, LICENSE_PRODUCT } from '../server/license/types';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanup.length = 0;
});

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

async function dbPathWithInvite(maxDevices = 1) {
  const dir = await mkdtemp(path.join(tmpdir(), 'license-server-'));
  cleanup.push(dir);
  const dbPath = path.join(dir, 'invites.json');
  await saveInviteDatabase(dbPath, {
    schemaVersion: 1,
    invites: [createInviteRecord({
      code: 'WY-2026-ABCD',
      customerName: '华东航空实训中心',
      maxDevices,
      licenseDays: 365,
      expiresAt: '2027-07-06',
      now: new Date('2026-07-06T00:00:00.000Z'),
    })],
  });
  return dbPath;
}

describe('license issuer and activation protocol', () => {
  it('activates an invite and signs a device-bound license', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const dbPath = await dbPathWithInvite();
    const deviceHash = hashDeviceFingerprint('device-a');

    const result = await activateInvite(dbPath, {
      inviteCode: 'wy-2026-abcd',
      deviceHash,
      appVersion: '1.1.0',
    }, { privateKeyPem, keyId: 'test-key', now: new Date('2026-07-06T00:00:00.000Z') });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.envelope.payload.customerName).toBe('华东航空实训中心');
    expect(result.envelope.payload.deviceHash).toBe(deviceHash);
    expect(verifyLicenseEnvelope(result.envelope, {
      publicKeyPem,
      expectedDeviceHash: deviceHash,
      now: new Date('2026-07-07T00:00:00.000Z'),
      expectedAppId: LICENSE_APP_ID,
      expectedProduct: LICENSE_PRODUCT,
    }).valid).toBe(true);
  });

  it('is idempotent for the same invite and device but rejects extra devices over the limit', async () => {
    const { privateKeyPem } = keys();
    const dbPath = await dbPathWithInvite(1);
    const deviceA = hashDeviceFingerprint('device-a');
    const deviceB = hashDeviceFingerprint('device-b');

    const first = await activateInvite(dbPath, { inviteCode: 'WY-2026-ABCD', deviceHash: deviceA }, { privateKeyPem, keyId: 'test-key', now: new Date('2026-07-06T00:00:00.000Z') });
    const second = await activateInvite(dbPath, { inviteCode: 'WY-2026-ABCD', deviceHash: deviceA }, { privateKeyPem, keyId: 'test-key', now: new Date('2026-07-07T00:00:00.000Z') });
    const denied = await activateInvite(dbPath, { inviteCode: 'WY-2026-ABCD', deviceHash: deviceB }, { privateKeyPem, keyId: 'test-key', now: new Date('2026-07-07T00:00:00.000Z') });
    const db = JSON.parse(await readFile(dbPath, 'utf8')) as { invites: Array<{ activations: unknown[] }> };

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.ok && second.ok ? second.envelope.payload.licenseId : '').toBe(first.ok ? first.envelope.payload.licenseId : '');
    expect(denied).toMatchObject({ ok: false, code: 'DEVICE_LIMIT_REACHED' });
    expect(db.invites[0].activations).toHaveLength(1);
  });

  it('rejects revoked invites and reports revoked licenses during online check', async () => {
    const { privateKeyPem } = keys();
    const dbPath = await dbPathWithInvite();
    const deviceHash = hashDeviceFingerprint('device-a');
    const activated = await activateInvite(dbPath, { inviteCode: 'WY-2026-ABCD', deviceHash }, { privateKeyPem, keyId: 'test-key', now: new Date('2026-07-06T00:00:00.000Z') });
    if (!activated.ok) throw new Error(activated.message);

    const db = JSON.parse(await readFile(dbPath, 'utf8'));
    db.invites[0].status = 'revoked';
    db.revokedLicenseIds = [activated.envelope.payload.licenseId];
    await saveInviteDatabase(dbPath, db);

    const denied = await activateInvite(dbPath, { inviteCode: 'WY-2026-ABCD', deviceHash }, { privateKeyPem, keyId: 'test-key', now: new Date('2026-07-07T00:00:00.000Z') });
    const check = await checkLicense(dbPath, { licenseId: activated.envelope.payload.licenseId, deviceHash });

    expect(denied).toMatchObject({ ok: false, code: 'INVITE_REVOKED' });
    expect(check).toEqual({ ok: true, status: 'revoked', message: '授权已被停用' });
  });
});
