import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { signLicenseCheckReceipt, signLicensePayload, verifyLicenseCheckReceipt, verifyLicenseEnvelope } from '../server/license/crypto';
import { createDeviceDisplayCode, hashDeviceFingerprint } from '../server/license/device';
import { LicenseStore } from '../server/license/store';
import { LICENSE_APP_ID, LICENSE_PRODUCT, type LicensePayload } from '../server/license/types';

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

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    schemaVersion: 1,
    appId: LICENSE_APP_ID,
    product: LICENSE_PRODUCT,
    licenseId: 'LIC-TEST-001',
    inviteCodeHash: 'INVITEHASH',
    customerName: '测试培训学校',
    deviceHash: hashDeviceFingerprint('machine-guid-1'),
    maxDevices: 1,
    features: ['ticketing', 'training', 'desktop'],
    issuedAt: '2026-07-06T00:00:00.000Z',
    activatedAt: '2026-07-06T00:00:00.000Z',
    expiresAt: '2027-07-06',
    offlineGraceDays: 30,
    ...overrides,
  };
}

describe('license core', () => {
  it('accepts a valid signed license for the current device', () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const signed = signLicensePayload(payload(), privateKeyPem, 'test-key');

    const result = verifyLicenseEnvelope(signed, {
      publicKeyPem,
      expectedDeviceHash: payload().deviceHash,
      now: new Date('2026-08-01T00:00:00.000Z'),
      expectedAppId: LICENSE_APP_ID,
      expectedProduct: LICENSE_PRODUCT,
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.message);
    expect(result.summary.customerName).toBe('测试培训学校');
  });

  it('rejects a license when any signed payload field is tampered', () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const signed = signLicensePayload(payload(), privateKeyPem, 'test-key');
    const tampered = { ...signed, payload: { ...signed.payload, customerName: '被篡改客户' } };

    const result = verifyLicenseEnvelope(tampered, {
      publicKeyPem,
      expectedDeviceHash: payload().deviceHash,
      now: new Date('2026-08-01T00:00:00.000Z'),
      expectedAppId: LICENSE_APP_ID,
      expectedProduct: LICENSE_PRODUCT,
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('tampered license unexpectedly passed');
    expect(result.reason).toBe('SIGNATURE_INVALID');
  });

  it('rejects expired and other-device licenses', () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const expired = signLicensePayload(payload({ expiresAt: '2026-07-01' }), privateKeyPem, 'test-key');
    const otherDevice = signLicensePayload(payload({ deviceHash: hashDeviceFingerprint('other-machine') }), privateKeyPem, 'test-key');

    expect(verifyLicenseEnvelope(expired, {
      publicKeyPem,
      expectedDeviceHash: payload().deviceHash,
      now: new Date('2026-08-01T00:00:00.000Z'),
      expectedAppId: LICENSE_APP_ID,
      expectedProduct: LICENSE_PRODUCT,
    })).toMatchObject({ valid: false, reason: 'EXPIRED' });

    expect(verifyLicenseEnvelope(otherDevice, {
      publicKeyPem,
      expectedDeviceHash: payload().deviceHash,
      now: new Date('2026-08-01T00:00:00.000Z'),
      expectedAppId: LICENSE_APP_ID,
      expectedProduct: LICENSE_PRODUCT,
    })).toMatchObject({ valid: false, reason: 'DEVICE_MISMATCH' });
  });

  it('stores licenses atomically and produces a safe display code for support', async () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const dir = await mkdtemp(path.join(tmpdir(), 'license-core-'));
    cleanup.push(dir);
    const store = new LicenseStore(path.join(dir, 'license.json'));
    const signed = signLicensePayload(payload(), privateKeyPem, 'test-key');

    await store.write(signed);
    const savedRaw = await readFile(path.join(dir, 'license.json'), 'utf-8');
    const loaded = await store.read();

    expect(JSON.parse(savedRaw).payload.licenseId).toBe('LIC-TEST-001');
    expect(loaded?.payload.customerName).toBe('测试培训学校');
    expect(createDeviceDisplayCode(payload().deviceHash)).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(verifyLicenseEnvelope(loaded!, {
      publicKeyPem,
      expectedDeviceHash: payload().deviceHash,
      now: new Date('2026-08-01T00:00:00.000Z'),
      expectedAppId: LICENSE_APP_ID,
      expectedProduct: LICENSE_PRODUCT,
    }).valid).toBe(true);
  });

  it('accepts only fresh signed online check receipts for the expected license and device', () => {
    const { publicKeyPem, privateKeyPem } = keys();
    const receipt = signLicenseCheckReceipt({
      schemaVersion: 1,
      appId: LICENSE_APP_ID,
      licenseId: 'LIC-TEST-001',
      deviceHash: payload().deviceHash,
      status: 'active',
      message: '授权有效',
      checkedAt: '2026-07-06T00:00:00.000Z',
    }, privateKeyPem, 'test-key');

    expect(verifyLicenseCheckReceipt(receipt, {
      publicKeyPem,
      expectedLicenseId: 'LIC-TEST-001',
      expectedDeviceHash: payload().deviceHash,
      now: new Date('2026-07-06T00:05:00.000Z'),
    })).toMatchObject({ valid: true, status: 'active' });
    expect(verifyLicenseCheckReceipt({ ...receipt, payload: { ...receipt.payload, status: 'revoked' } }, {
      publicKeyPem,
      expectedLicenseId: 'LIC-TEST-001',
      expectedDeviceHash: payload().deviceHash,
      now: new Date('2026-07-06T00:05:00.000Z'),
    })).toMatchObject({ valid: false });
    expect(verifyLicenseCheckReceipt(receipt, {
      publicKeyPem,
      expectedLicenseId: 'LIC-TEST-001',
      expectedDeviceHash: payload().deviceHash,
      now: new Date('2026-07-06T00:30:00.000Z'),
    })).toMatchObject({ valid: false, message: '授权复核回执已过期' });
  });
});
