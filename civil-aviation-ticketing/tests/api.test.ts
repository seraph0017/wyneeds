import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../server/server';
import type { PassengerInput } from '../src/domain/types';

let cleanup: Array<() => Promise<void>> = [];

async function testServer() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'ca-ticketing-'));
  const server = await startServer({ port: 0, dataDir, enableCors: true });
  cleanup.push(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.port}`;
}

function adultPassenger(): PassengerInput {
  return {
    id: 'A1',
    type: 'adult',
    name: '张三',
    gender: '男',
    birthDate: '1990-01-01',
    documentType: '身份证',
    documentNumber: '110101199001011234',
    documentExpiry: '2032-12-31',
    phone: '13800138000',
  };
}

afterEach(async () => {
  await Promise.all(cleanup.map((item) => item()));
  cleanup = [];
});

describe('civil aviation API hardening', () => {
  it('returns 422 for malformed order payload instead of 500', async () => {
    const baseUrl = await testServer();
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
    const body = await response.json() as { errors: string[] };
    expect(body.errors).toContain('航班不能为空');
  });

  it('derives order fare and route from server flight data instead of trusting client price', async () => {
    const baseUrl = await testServer();
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightId: 'FL-PEK-SHA-002',
        flightDate: '2026-08-01',
        cabinClass: 'economy',
        cabinRemainingSeats: 999,
        baseFare: 1,
        route: '篡改航线',
        passengers: [adultPassenger()],
        contact: { name: '订票老师', phone: '13900139000', email: 'teacher@example.com' },
      }),
    });

    expect(response.status).toBe(201);
    const order = await response.json() as { totalAmount: number; route: string; flightSnapshot: { flightNo: string } };
    expect(order.totalAmount).toBeGreaterThan(100);
    expect(order.route).toContain('北京');
    expect(order.route).toContain('上海');
    expect(order.route).not.toBe('篡改航线');
    expect(order.flightSnapshot.flightNo).toMatch(/^[A-Z]{2}\d+/);
  });



  it('reduces cabin remaining seats after an active order is created', async () => {
    const baseUrl = await testServer();
    const before = await (await fetch(`${baseUrl}/api/flights?fromCityCode=PEK&toCityCode=SHA&flightDate=2026-08-01&adults=1&children=0&infants=0`)).json() as Array<{ id: string; cabins: Array<{ class: string; remainingSeats: number }> }>;
    const target = before.find((flight) => flight.id === 'FL-PEK-SHA-002')!;
    const beforeSeats = target.cabins.find((cabin) => cabin.class === 'economy')!.remainingSeats;

    await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightId: 'FL-PEK-SHA-002',
        flightDate: '2026-08-01',
        cabinClass: 'economy',
        passengers: [adultPassenger()],
        contact: { name: '订票老师', phone: '13900139000' },
      }),
    });

    const after = await (await fetch(`${baseUrl}/api/flights?fromCityCode=PEK&toCityCode=SHA&flightDate=2026-08-01&adults=1&children=0&infants=0`)).json() as Array<{ id: string; cabins: Array<{ class: string; remainingSeats: number }> }>;
    const afterSeats = after.find((flight) => flight.id === 'FL-PEK-SHA-002')!.cabins.find((cabin) => cabin.class === 'economy')!.remainingSeats;
    expect(afterSeats).toBe(beforeSeats - 1);
  });

  it('only allows change simulation to another flight on the same route', async () => {
    const baseUrl = await testServer();
    const create = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightId: 'FL-PEK-CAN-005',
        flightDate: '2026-08-01',
        cabinClass: 'economy',
        passengers: [adultPassenger()],
        contact: { name: '订票老师', phone: '13900139000' },
      }),
    });
    const order = await create.json() as { id: string };

    const invalid = await fetch(`${baseUrl}/api/orders/${order.id}/change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetFlightId: 'FL-SHA-PEK-003', sameCabin: true }),
    });
    expect(invalid.status).toBe(422);

    const valid = await fetch(`${baseUrl}/api/orders/${order.id}/change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetFlightId: 'FL-PEK-CAN-006', sameCabin: true }),
    });
    expect(valid.status).toBe(200);
    const changed = await valid.json() as { flightId: string; status: string };
    expect(changed.flightId).toBe('FL-PEK-CAN-006');
    expect(changed.status).toBe('已改签');
  });

  it('allows Electron file origin through CORS when enabled', async () => {
    const baseUrl = await testServer();
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'null' } });
    expect(response.headers.get('access-control-allow-origin')).toBe('null');
  });
});
