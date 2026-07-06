#!/usr/bin/env node
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DB = path.resolve(process.cwd(), '.license-server', 'invites.json');

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeInviteCode(code) {
  return String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function hashInviteCode(code) {
  return sha256Hex(`wyneeds-invite-v1:${normalizeInviteCode(code)}`);
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `WY-${new Date().getUTCFullYear()}-${part()}-${part()}`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      i += 1;
    }
  }
  return { command, options };
}

async function loadDb(dbPath) {
  try {
    const raw = await readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { schemaVersion: 1, invites: Array.isArray(parsed.invites) ? parsed.invites : [], revokedLicenseIds: Array.isArray(parsed.revokedLicenseIds) ? parsed.revokedLicenseIds : [] };
  } catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: 1, invites: [], revokedLicenseIds: [] };
    throw error;
  }
}

async function saveDb(dbPath, db) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const temp = `${dbPath}.tmp`;
  await writeFile(temp, JSON.stringify({ ...db, schemaVersion: 1 }, null, 2), 'utf8');
  await rename(temp, dbPath);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Number(days));
  return next;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

async function generateKeys(options) {
  const outDir = path.resolve(String(options['out-dir'] || 'secrets/license'));
  await mkdir(outDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await writeFile(path.join(outDir, 'license-private-key.pem'), privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  await writeFile(path.join(outDir, 'license-public-key.pem'), publicKeyPem, 'utf8');
  console.log(JSON.stringify({ privateKey: path.join(outDir, 'license-private-key.pem'), publicKey: path.join(outDir, 'license-public-key.pem') }, null, 2));
}

async function createInvite(options) {
  const dbPath = path.resolve(String(options.db || DEFAULT_DB));
  const customerName = String(options.customer || '').trim();
  if (!customerName) throw new Error('缺少 --customer "客户名称"');
  const code = normalizeInviteCode(String(options.code || randomCode()));
  const maxDevices = Number(options['max-devices'] || 1);
  const licenseDays = Number(options['license-days'] || 365);
  const expiresAt = String(options['expires-at'] || dateOnly(addDays(new Date(), licenseDays)));
  const db = await loadDb(dbPath);
  const codeHash = hashInviteCode(code);
  if (db.invites.some((invite) => invite.codeHash === codeHash)) throw new Error('邀请码已存在');
  db.invites.push({
    codeHash,
    customerName,
    maxDevices,
    licenseDays,
    expiresAt,
    status: 'active',
    createdAt: new Date().toISOString(),
    features: ['ticketing', 'training', 'desktop'],
    activations: [],
  });
  await saveDb(dbPath, db);
  console.log(JSON.stringify({ code, customerName, maxDevices, expiresAt, dbPath }, null, 2));
}

async function listInvites(options) {
  const dbPath = path.resolve(String(options.db || DEFAULT_DB));
  const db = await loadDb(dbPath);
  console.log(JSON.stringify(db.invites.map((invite) => ({
    customerName: invite.customerName,
    status: invite.status,
    maxDevices: invite.maxDevices,
    usedDevices: invite.activations.length,
    expiresAt: invite.expiresAt,
    licenseIds: invite.activations.map((activation) => activation.licenseId),
  })), null, 2));
}

async function revokeInvite(options) {
  const dbPath = path.resolve(String(options.db || DEFAULT_DB));
  const code = String(options.code || '');
  if (!code) throw new Error('缺少 --code');
  const db = await loadDb(dbPath);
  const invite = db.invites.find((item) => item.codeHash === hashInviteCode(code));
  if (!invite) throw new Error('邀请码不存在');
  invite.status = 'revoked';
  await saveDb(dbPath, db);
  console.log(JSON.stringify({ revoked: true, code: normalizeInviteCode(code) }, null, 2));
}

async function revokeLicense(options) {
  const dbPath = path.resolve(String(options.db || DEFAULT_DB));
  const licenseId = String(options['license-id'] || '').trim();
  if (!licenseId) throw new Error('缺少 --license-id');
  const db = await loadDb(dbPath);
  db.revokedLicenseIds = Array.from(new Set([...(db.revokedLicenseIds || []), licenseId]));
  await saveDb(dbPath, db);
  console.log(JSON.stringify({ revoked: true, licenseId }, null, 2));
}

function usage() {
  console.log(`Usage:
  node scripts/license-admin.mjs generate-keys --out-dir secrets/license
  node scripts/license-admin.mjs create-invite --customer "某某学校" [--db .license-server/invites.json] [--max-devices 1] [--license-days 365] [--expires-at 2027-07-06]
  node scripts/license-admin.mjs list [--db .license-server/invites.json]
  node scripts/license-admin.mjs revoke-invite --code WY-2026-XXXX-YYYY [--db .license-server/invites.json]
  node scripts/license-admin.mjs revoke-license --license-id LIC-XXXXXXXX [--db .license-server/invites.json]`);
}

const { command, options } = parseArgs(process.argv.slice(2));
try {
  if (command === 'generate-keys') await generateKeys(options);
  else if (command === 'create-invite') await createInvite(options);
  else if (command === 'list') await listInvites(options);
  else if (command === 'revoke-invite') await revokeInvite(options);
  else if (command === 'revoke-license') await revokeLicense(options);
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
