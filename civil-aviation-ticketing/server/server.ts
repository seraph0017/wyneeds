import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { cities, findCity } from '../src/data/cities';
import { findFlight, searchFlights } from '../src/data/flights';
import { rules } from '../src/data/rules';
import { validateFlightSearch, validateOrderRequest } from '../src/domain/validation';
import type { BookingRequest, CabinClass, ContactInput, DocumentType, Flight, Gender, OrderRecord, PassengerInput, PassengerType } from '../src/domain/types';
import { calculatePassengerFare } from '../src/domain/pricing';
import { OrderStore, resolveDataFile } from './orderStore';
import { LicenseManager } from './license/manager';
import type { LicenseEnvelope } from './license/types';
import { DEFAULT_LICENSE_PUBLIC_KEY_PEM } from './license/publicKey';

export interface ServerOptions {
  port?: number;
  dataDir?: string;
  enableCors?: boolean;
  licenseRequired?: boolean;
  licensePublicKeyPem?: string;
  licenseDeviceHash?: string;
  licenseActivationUrl?: string;
  licenseAppVersion?: string;
}

const cabinClasses: CabinClass[] = ['first', 'business', 'economy'];
const passengerTypes: PassengerType[] = ['adult', 'child', 'infant', 'um'];
const genders: Gender[] = ['男', '女'];
const documentTypes: DocumentType[] = ['身份证', '护照', '港澳通行证', '台胞证', '户口簿'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function optionalString(value: unknown): string | undefined {
  const text = stringValue(value);
  return text ? text : undefined;
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}
function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}


function isActiveOrder(order: OrderRecord): boolean {
  return order.status !== '已取消' && order.status !== '已退票';
}

function bookedSeatCount(orders: OrderRecord[], flightId: string, cabinClass: CabinClass, flightDate: string): number {
  return orders
    .filter((order) => isActiveOrder(order) && order.flightId === flightId && order.cabinClass === cabinClass && order.flightDate === flightDate)
    .reduce((sum, order) => sum + order.passengers.length, 0);
}

function applyInventory(flights: Flight[], orders: OrderRecord[], flightDate: string): Flight[] {
  return flights.map((flight) => ({
    ...flight,
    cabins: flight.cabins.map((cabin) => ({
      ...cabin,
      remainingSeats: Math.max(0, cabin.remainingSeats - bookedSeatCount(orders, flight.id, cabin.class, flightDate)),
    })),
  }));
}

function parsePassenger(value: unknown, index: number, errors: string[]): PassengerInput | undefined {
  if (!isRecord(value)) {
    errors.push(`第${index + 1}名乘机人格式不正确`);
    return undefined;
  }
  const type = enumValue(stringValue(value.type), passengerTypes, 'adult');
  if (!passengerTypes.includes(value.type as PassengerType)) errors.push(`第${index + 1}名乘机人类型不正确`);
  const gender = enumValue(stringValue(value.gender), genders, '男');
  if (value.gender && !genders.includes(value.gender as Gender)) errors.push(`第${index + 1}名乘机人性别不正确`);
  const documentType = enumValue(stringValue(value.documentType), documentTypes, type === 'adult' ? '身份证' : '户口簿');
  if (value.documentType && !documentTypes.includes(value.documentType as DocumentType)) errors.push(`第${index + 1}名乘机人证件类型不正确`);
  const sender = isRecord(value.sender) ? {
    name: stringValue(value.sender.name),
    phone: stringValue(value.sender.phone),
    documentNumber: optionalString(value.sender.documentNumber),
    relationship: optionalString(value.sender.relationship),
  } : undefined;
  const receiver = isRecord(value.receiver) ? {
    name: stringValue(value.receiver.name),
    phone: stringValue(value.receiver.phone),
    documentNumber: optionalString(value.receiver.documentNumber),
    relationship: optionalString(value.receiver.relationship),
  } : undefined;
  return {
    id: stringValue(value.id) || `P${index + 1}`,
    type,
    name: stringValue(value.name),
    gender,
    birthDate: stringValue(value.birthDate),
    documentType,
    documentNumber: stringValue(value.documentNumber),
    documentExpiry: optionalString(value.documentExpiry),
    phone: stringValue(value.phone),
    email: optionalString(value.email),
    linkedAdultId: optionalString(value.linkedAdultId),
    sender,
    receiver,
    note: optionalString(value.note),
  };
}

function deriveBookingRequest(body: unknown, orders: OrderRecord[]): { request?: BookingRequest; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(body)) return { errors: ['请求体格式不正确'] };

  const flightId = stringValue(body.flightId);
  const flightDate = stringValue(body.flightDate);
  const cabinClass = enumValue(stringValue(body.cabinClass), cabinClasses, 'economy');
  if (!flightId) errors.push('航班不能为空');
  if (!flightDate || !isValidDate(flightDate)) errors.push('航班日期不能为空');
  if (body.cabinClass && !cabinClasses.includes(body.cabinClass as CabinClass)) errors.push('舱位等级不正确');

  const flight = flightId ? findFlight(flightId) : undefined;
  if (flightId && !flight) errors.push('航班不存在');
  const cabin = flight?.cabins.find((item) => item.class === cabinClass);
  if (flight && !cabin) errors.push('舱位不存在');

  const rawPassengers = Array.isArray(body.passengers) ? body.passengers : [];
  if (!Array.isArray(body.passengers) || rawPassengers.length === 0) errors.push('请填写乘机人信息');
  if (rawPassengers.length > 9) errors.push('单个订单最多支持9名旅客');
  const passengers = rawPassengers.map((item, index) => parsePassenger(item, index, errors)).filter(Boolean) as PassengerInput[];

  const contactRaw = isRecord(body.contact) ? body.contact : {};
  if (!isRecord(body.contact)) errors.push('联系人信息格式不正确');
  const contact: ContactInput = {
    name: stringValue(contactRaw.name),
    phone: stringValue(contactRaw.phone),
    email: optionalString(contactRaw.email),
  };

  if (!flight || !cabin) return { errors };
  const from = findCity(flight.fromCityCode);
  const to = findCity(flight.toCityCode);
  const remainingSeats = Math.max(0, cabin.remainingSeats - bookedSeatCount(orders, flight.id, cabinClass, flightDate));
  const request: BookingRequest = {
    flightId: flight.id,
    flightDate,
    cabinClass,
    cabinRemainingSeats: remainingSeats,
    baseFare: cabin.fare,
    route: `${from?.name ?? flight.fromCityCode} · ${flight.fromAirport} → ${to?.name ?? flight.toCityCode} · ${flight.toAirport}`,
    flightSnapshot: {
      flightNo: flight.flightNo,
      airline: flight.airline,
      aircraft: flight.aircraft,
      fromAirport: flight.fromAirport,
      toAirport: flight.toAirport,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      arrivalNextDay: flight.arrivalNextDay,
      durationMinutes: flight.durationMinutes,
    },
    passengers,
    contact,
  };
  return { request, errors: [...errors, ...validateOrderRequest(request)] };
}

export function createApp(options: ServerOptions = {}) {
  const app = express();
  const store = new OrderStore(resolveDataFile(options.dataDir));
  const licenseRequired = options.licenseRequired ?? process.env.CA_LICENSE_REQUIRED === 'true';
  const licenseManager = licenseRequired ? new LicenseManager({
    dataDir: options.dataDir,
    publicKeyPem: options.licensePublicKeyPem ?? process.env.CA_LICENSE_PUBLIC_KEY_PEM ?? DEFAULT_LICENSE_PUBLIC_KEY_PEM,
    deviceHash: options.licenseDeviceHash,
    activationServerUrl: options.licenseActivationUrl ?? process.env.CA_LICENSE_SERVER_URL,
    appVersion: options.licenseAppVersion ?? process.env.npm_package_version,
  }) : undefined;

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  if (options.enableCors ?? true) {
    app.use(cors({
      origin: (origin, callback) => {
        if (!origin || origin === 'null' || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
    }));
  }
  app.use(express.json({ limit: '200kb' }));
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'civil-aviation-ticketing' }));
  app.get('/api/license/status', async (_req, res, next) => {
    try {
      if (!licenseManager) {
        return res.json({
          licensed: true,
          activationRequired: false,
          activationServerConfigured: false,
          deviceHash: '',
          deviceDisplayCode: 'DEV-MODE',
          summary: {
            licenseId: 'DEV-MODE',
            customerName: '开发模式',
            expiresAt: '2099-12-31',
            features: ['ticketing', 'training', 'desktop'],
            deviceHash: '',
            deviceDisplayCode: 'DEV-MODE',
            offlineGraceDays: 0,
          },
        });
      }
      return res.json(await licenseManager.status());
    } catch (error) { return next(error); }
  });
  app.post('/api/license/activate', async (req, res, next) => {
    try {
      if (!licenseManager) return res.status(409).json({ code: 'LICENSE_DISABLED', message: '当前未启用授权校验' });
      const inviteCode = stringValue(req.body?.inviteCode);
      if (!inviteCode) return res.status(422).json({ code: 'INVALID_REQUEST', message: '请输入邀请码' });
      const result = await licenseManager.activate(inviteCode);
      return res.status(result.licensed ? 200 : 422).json(result);
    } catch (error) { return next(error); }
  });
  app.post('/api/license/offline-import', async (req, res, next) => {
    try {
      if (!licenseManager) return res.status(409).json({ code: 'LICENSE_DISABLED', message: '当前未启用授权校验' });
      const envelope = isRecord(req.body) && isRecord(req.body.envelope) ? req.body.envelope as unknown as LicenseEnvelope : undefined;
      if (!envelope) return res.status(422).json({ code: 'INVALID_REQUEST', message: '授权文件格式不正确' });
      const result = await licenseManager.importOffline(envelope);
      return res.status(result.licensed ? 200 : 422).json(result);
    } catch (error) { return next(error); }
  });

  if (licenseManager) {
    app.use('/api', async (req, res, next) => {
      if (req.path === '/health' || req.path.startsWith('/license/')) return next();
      try {
        const status = await licenseManager.status();
        if (!status.licensed) {
          return res.status(403).json({
            code: 'LICENSE_REQUIRED',
            errors: ['软件未授权，请先输入邀请码完成激活'],
            license: status,
          });
        }
        return next();
      } catch (error) { return next(error); }
    });
  }

  app.get('/api/cities', (_req, res) => res.json(cities));
  app.get('/api/rules', (_req, res) => res.json(rules));

  app.get('/api/flights', async (req, res, next) => {
    const input = {
      fromCityCode: String(req.query.fromCityCode ?? ''),
      toCityCode: String(req.query.toCityCode ?? ''),
      flightDate: String(req.query.flightDate ?? ''),
      adults: Number(req.query.adults ?? 1),
      children: Number(req.query.children ?? 0),
      infants: Number(req.query.infants ?? 0),
    };
    const errors = validateFlightSearch(input);
    if (errors.length) return res.status(422).json({ errors });
    try {
      const orders = await store.list();
      return res.json(applyInventory(searchFlights(input.fromCityCode, input.toCityCode), orders, input.flightDate));
    } catch (error) { next(error); }
  });

  app.get('/api/flights/:id', (req, res) => {
    const flight = findFlight(req.params.id);
    if (!flight) return res.status(404).json({ errors: ['航班不存在'] });
    return res.json(flight);
  });

  app.get('/api/orders', async (_req, res, next) => {
    try { res.json(await store.list()); } catch (error) { next(error); }
  });

  app.get('/api/orders/:id', async (req, res, next) => {
    try {
      const order = await store.get(req.params.id);
      if (!order) return res.status(404).json({ errors: ['订单不存在'] });
      return res.json(order);
    } catch (error) { next(error); }
  });

  app.post('/api/orders', async (req, res, next) => {
    try {
      const { request, errors } = deriveBookingRequest(req.body, await store.list());
      if (errors.length || !request) return res.status(422).json({ errors: Array.from(new Set(errors)) });
      const order = await store.create(request);
      return res.status(201).json(order);
    } catch (error) { next(error); }
  });

  app.post('/api/orders/:id/cancel', async (req, res, next) => {
    try {
      const current = await store.get(req.params.id);
      if (!current) return res.status(404).json({ errors: ['订单不存在'] });
      const today = new Date().toISOString().slice(0, 10);
      if (current.flightDate < today) return res.status(422).json({ errors: ['航班起飞后不允许取消订单，请走退票流程'] });
      if (!isActiveOrder(current)) return res.status(422).json({ errors: ['当前订单状态不允许取消'] });
      const order = await store.cancel(req.params.id);
      return res.json(order);
    } catch (error) { next(error); }
  });

  app.post('/api/orders/:id/refund', async (req, res, next) => {
    try {
      const order = await store.refund(req.params.id, Boolean(req.body?.afterDeparture));
      if (!order) return res.status(404).json({ errors: ['订单不存在'] });
      return res.json(order);
    } catch (error) { next(error); }
  });

  app.post('/api/orders/:id/change', async (req, res, next) => {
    try {
      const targetFlightId = String(req.body?.targetFlightId ?? '');
      if (!targetFlightId) return res.status(422).json({ errors: ['请选择改签目标航班'] });
      const current = await store.get(req.params.id);
      if (!current) return res.status(404).json({ errors: ['订单不存在'] });
      if (!isActiveOrder(current)) return res.status(422).json({ errors: ['当前订单状态不允许改签'] });
      const currentFlight = findFlight(current.flightId);
      const targetFlight = findFlight(targetFlightId);
      if (!currentFlight || !targetFlight) return res.status(422).json({ errors: ['改签航班不存在'] });
      if (currentFlight.fromCityCode !== targetFlight.fromCityCode || currentFlight.toCityCode !== targetFlight.toCityCode) {
        return res.status(422).json({ errors: ['改签仅支持同航线其他航班'] });
      }
      if (currentFlight.id === targetFlight.id) return res.status(422).json({ errors: ['请选择其他航班进行改签'] });
      const targetCabin = targetFlight.cabins.find((cabin) => cabin.class === current.cabinClass);
      if (!targetCabin) return res.status(422).json({ errors: ['目标航班无同舱位'] });
      const orders = await store.list();
      const remainingSeats = targetCabin.remainingSeats - bookedSeatCount(orders, targetFlight.id, current.cabinClass, current.flightDate);
      if (remainingSeats < current.passengers.length) return res.status(422).json({ errors: ['目标航班余票不足'] });
      const newTotal = current.passengers.reduce((sum, passenger) => sum + calculatePassengerFare(targetCabin.fare, passenger.type), 0);
      const fareDifference = newTotal - current.totalAmount;
      const order = await store.change(req.params.id, targetFlightId, fareDifference, true);
      return res.json(order);
    } catch (error) { next(error); }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ errors: ['系统处理失败，请稍后再试'] });
  });

  return app;
}

export async function startServer(options: ServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 4176);
  const app = createApp(options);
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({ port: resolvedPort, close: () => new Promise((done) => server.close(() => done())) });
    });
    server.on('error', reject);
  });
}
