#!/usr/bin/env node
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const APP_ID = 'cn.training.civil-aviation-ticketing';
const PRODUCT = '民航客票销售订座系统';
const SCHEMA_VERSION = 1;
const DEFAULT_DB = path.resolve(process.cwd(), '.license-server', 'invites.json');
const DEFAULT_PRIVATE_KEY = path.resolve(process.cwd(), 'secrets', 'license', 'license-private-key.pem');
const PORT = Number(process.env.CA_LICENSE_PORT || 8787);
const DB_PATH = path.resolve(process.env.CA_LICENSE_DB_PATH || DEFAULT_DB);
const PRIVATE_KEY_PATH = path.resolve(process.env.CA_LICENSE_PRIVATE_KEY_PATH || DEFAULT_PRIVATE_KEY);
const KEY_ID = process.env.CA_LICENSE_KEY_ID || 'wyneeds-license-key-2026-07';

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeInviteCode(code) {
  return String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function hashInviteCode(code) {
  return sha256Hex(`wyneeds-invite-v1:${normalizeInviteCode(code)}`);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).filter((key) => value[key] !== undefined).sort().reduce((out, key) => {
      out[key] = canonical(value[key]);
      return out;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function shortHash(value) {
  return value.replace(/[^a-fA-F0-9]/g, '').toUpperCase().slice(0, 16).padEnd(16, '0');
}

function createLicenseId(codeHash, deviceHash) {
  return `LIC-${shortHash(hashInviteCode(`${codeHash}:${deviceHash}`))}`;
}

function parseDateEndOfDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return undefined;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function loadDb() {
  try {
    const raw = await readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { schemaVersion: 1, invites: Array.isArray(parsed.invites) ? parsed.invites : [], revokedLicenseIds: Array.isArray(parsed.revokedLicenseIds) ? parsed.revokedLicenseIds : [] };
  } catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: 1, invites: [], revokedLicenseIds: [] };
    throw error;
  }
}

async function saveDb(db) {
  await mkdir(path.dirname(DB_PATH), { recursive: true });
  const temp = `${DB_PATH}.tmp`;
  await writeFile(temp, JSON.stringify({ ...db, schemaVersion: 1 }, null, 2), 'utf8');
  await rename(temp, DB_PATH);
}

let privateKeyPem;
async function readPrivateKey() {
  if (!privateKeyPem) privateKeyPem = await readFile(PRIVATE_KEY_PATH, 'utf8');
  return privateKeyPem;
}

async function signPayload(payload) {
  const privateKey = createPrivateKey(await readPrivateKey());
  const signature = sign(null, Buffer.from(canonicalJson(payload), 'utf8'), privateKey).toString('base64');
  return { algorithm: 'Ed25519', keyId: KEY_ID, payload, signature };
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100 * 1024) throw Object.assign(new Error('请求体过大'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(raw),
    'Cache-Control': 'no-store',
  });
  res.end(raw);
}

async function activate(body) {
  const inviteCode = String(body.inviteCode || '').trim();
  const deviceHash = String(body.deviceHash || '').trim();
  if (!inviteCode || !deviceHash) return { status: 422, body: { ok: false, code: 'INVALID_REQUEST', message: '邀请码和设备信息不能为空' } };

  const db = await loadDb();
  const codeHash = hashInviteCode(inviteCode);
  const invite = db.invites.find((item) => item.codeHash === codeHash);
  if (!invite) return { status: 404, body: { ok: false, code: 'INVITE_NOT_FOUND', message: '邀请码不存在或已失效' } };
  if (invite.status !== 'active') return { status: 403, body: { ok: false, code: 'INVITE_REVOKED', message: '邀请码已被停用' } };
  const expires = parseDateEndOfDay(invite.expiresAt);
  if (!expires || Date.now() > expires.getTime()) return { status: 403, body: { ok: false, code: 'INVITE_EXPIRED', message: '邀请码已过期' } };

  let activation = invite.activations.find((item) => item.deviceHash === deviceHash);
  let reused = true;
  if (!activation) {
    if (invite.activations.length >= invite.maxDevices) return { status: 409, body: { ok: false, code: 'DEVICE_LIMIT_REACHED', message: '邀请码可绑定设备数已用完' } };
    reused = false;
    activation = { licenseId: createLicenseId(invite.codeHash, deviceHash), deviceHash, activatedAt: new Date().toISOString(), appVersion: body.appVersion };
    invite.activations.push(activation);
    await saveDb(db);
  }

  const now = new Date().toISOString();
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    appId: APP_ID,
    product: PRODUCT,
    licenseId: activation.licenseId,
    inviteCodeHash: invite.codeHash,
    customerName: invite.customerName,
    deviceHash: activation.deviceHash,
    maxDevices: invite.maxDevices,
    features: invite.features || ['ticketing', 'training', 'desktop'],
    issuedAt: now,
    activatedAt: activation.activatedAt,
    expiresAt: invite.expiresAt,
    offlineGraceDays: 30,
  };
  return { status: 200, body: { ok: true, envelope: await signPayload(payload), reused } };
}

async function check(body) {
  const licenseId = String(body.licenseId || '').trim();
  const deviceHash = String(body.deviceHash || '').trim();
  if (!licenseId || !deviceHash) return { status: 422, body: { ok: false, code: 'INVALID_REQUEST', message: '授权编号和设备信息不能为空' } };
  const db = await loadDb();
  if ((db.revokedLicenseIds || []).includes(licenseId)) return { status: 200, body: { ok: true, status: 'revoked', message: '授权已被停用' } };
  const found = db.invites.flatMap((invite) => invite.activations || []).find((item) => item.licenseId === licenseId && item.deviceHash === deviceHash);
  return { status: 200, body: found ? { ok: true, status: 'active', message: '授权有效' } : { ok: true, status: 'unknown', message: '授权记录不存在' } };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'wyneeds-license-server' });
    if (req.method === 'POST' && url.pathname === '/v1/activate') {
      const result = await activate(await readJsonBody(req));
      return send(res, result.status, result.body);
    }
    if (req.method === 'POST' && url.pathname === '/v1/check') {
      const result = await check(await readJsonBody(req));
      return send(res, result.status, result.body);
    }
    return send(res, 404, { ok: false, code: 'NOT_FOUND', message: '接口不存在' });
  } catch (error) {
    const status = error?.status || 500;
    return send(res, status, { ok: false, code: error?.code || 'SERVER_ERROR', message: error instanceof Error ? error.message : '授权服务异常' });
  }
});

server.listen(PORT, () => {
  console.log(`License server listening on http://127.0.0.1:${PORT}`);
  console.log(`Invite DB: ${DB_PATH}`);
  console.log(`Private key: ${PRIVATE_KEY_PATH}`);
});
