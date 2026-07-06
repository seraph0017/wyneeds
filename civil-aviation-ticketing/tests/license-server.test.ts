import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createInviteRecord, saveInviteDatabase, activateInvite, checkLicense, loadInviteDatabase } from '../server/license/issuer';
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

  it('validates invite limits and date-only values before saving', () => {
    const base = {
      code: 'WY-2026-ABCD',
      customerName: '参数校验客户',
      now: new Date('2026-07-06T00:00:00.000Z'),
    };

    expect(() => createInviteRecord({ ...base, maxDevices: 0 })).toThrow('可绑定设备数必须是正整数');
    expect(() => createInviteRecord({ ...base, licenseDays: Number.NaN })).toThrow('授权天数必须是正整数');
    expect(() => createInviteRecord({ ...base, expiresAt: '2026-02-31' })).toThrow('授权到期日必须是 YYYY-MM-DD 格式');
  });

  it('rejects malformed invite databases instead of signing unsafe records', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'license-server-bad-db-'));
    cleanup.push(dir);
    const dbPath = path.join(dir, 'invites.json');
    await writeFile(dbPath, JSON.stringify({
      schemaVersion: 1,
      invites: [{
        codeHash: 'bad',
        customerName: '坏数据客户',
        maxDevices: 0,
        licenseDays: 365,
        expiresAt: '2027-07-06',
        status: 'active',
        createdAt: '2026-07-06T00:00:00.000Z',
        features: ['ticketing'],
        activations: [],
      }],
    }), 'utf8');

    await expect(loadInviteDatabase(dbPath)).rejects.toThrow('可绑定设备数必须是正整数');
    await expect(activateInvite(dbPath, { inviteCode: 'WY-2026-ABCD', deviceHash: hashDeviceFingerprint('device-a') }, {
      privateKeyPem: keys().privateKeyPem,
    })).rejects.toThrow('可绑定设备数必须是正整数');
  });

  it('reports active, expired, and unknown licenses during online check', async () => {
    const { privateKeyPem } = keys();
    const activeDbPath = await dbPathWithInvite();
    const expiredDbPath = await dbPathWithInvite();
    const deviceHash = hashDeviceFingerprint('device-a');
    const active = await activateInvite(activeDbPath, { inviteCode: 'WY-2026-ABCD', deviceHash }, { privateKeyPem, keyId: 'test-key', now: new Date('2026-07-06T00:00:00.000Z') });
    if (!active.ok) throw new Error(active.message);
    const expired = await activateInvite(expiredDbPath, { inviteCode: 'WY-2026-ABCD', deviceHash }, { privateKeyPem, keyId: 'test-key', now: new Date('2026-07-06T00:00:00.000Z') });
    if (!expired.ok) throw new Error(expired.message);

    expect(await checkLicense(activeDbPath, { licenseId: active.envelope.payload.licenseId, deviceHash }, new Date('2026-07-07T00:00:00.000Z')))
      .toEqual({ ok: true, status: 'active', message: '授权有效' });
    expect(await checkLicense(expiredDbPath, { licenseId: expired.envelope.payload.licenseId, deviceHash }, new Date('2028-01-01T00:00:00.000Z')))
      .toEqual({ ok: true, status: 'expired', message: '授权已过期' });
    expect(await checkLicense(activeDbPath, { licenseId: 'LIC-NOT-FOUND', deviceHash }, new Date('2026-07-07T00:00:00.000Z')))
      .toEqual({ ok: true, status: 'unknown', message: '授权记录不存在' });
  });
});
