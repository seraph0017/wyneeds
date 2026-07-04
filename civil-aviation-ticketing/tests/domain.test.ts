import { describe, expect, it } from 'vitest';
import type { BookingRequest, CabinClass, PassengerInput } from '../src/domain/types';
import {
  calculateAgeOnDate,
  validateFlightSearch,
  validateOrderRequest,
  validatePassenger,
} from '../src/domain/validation';
import { calculatePassengerFare, calculateRefund } from '../src/domain/pricing';
import { createOrder } from '../src/domain/ticketing';

const flightDate = '2026-08-01';

function passenger(overrides: Partial<PassengerInput>): PassengerInput {
  return {
    id: overrides.id ?? 'P1',
    type: overrides.type ?? 'adult',
    name: overrides.name ?? '张三',
    gender: overrides.gender ?? '男',
    birthDate: overrides.birthDate ?? '1992-05-08',
    documentType: overrides.documentType ?? '身份证',
    documentNumber: overrides.documentNumber ?? '110101199205086666',
    documentExpiry: overrides.documentExpiry ?? '2030-01-01',
    phone: overrides.phone ?? '13800138000',
    email: overrides.email,
    linkedAdultId: overrides.linkedAdultId,
    um: overrides.um,
    sender: overrides.sender,
    receiver: overrides.receiver,
    note: overrides.note,
  };
}

function booking(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    flightId: 'FL-PEK-SHA-001',
    flightDate,
    cabinClass: 'economy',
    cabinRemainingSeats: 3,
    baseFare: 980,
    route: '北京首都 → 上海虹桥',
    passengers: [passenger({ id: 'A1' })],
    contact: {
      name: '订票老师',
      phone: '13900139000',
      email: 'teacher@example.com',
    },
    ...overrides,
  };
}

describe('civil aviation domain rules', () => {
  it('rejects a flight search when departure and arrival city are the same', () => {
    const errors = validateFlightSearch({ fromCityCode: 'PEK', toCityCode: 'PEK', flightDate, adults: 1, children: 0, infants: 0 });
    expect(errors).toContain('出发城市与到达城市不能相同');
  });

  it('calculates age on the flight date', () => {
    expect(calculateAgeOnDate('2008-08-01', '2026-08-01')).toBe(18);
    expect(calculateAgeOnDate('2008-08-02', '2026-08-01')).toBe(17);
  });

  it('validates adult age, phone, document expiry and document number', () => {
    const valid = validatePassenger(passenger({ id: 'A1', birthDate: '1988-03-01' }), [passenger({ id: 'A1' })], flightDate);
    expect(valid).toEqual([]);

    const invalid = validatePassenger(passenger({ id: 'A2', birthDate: '2010-03-01', documentExpiry: '2026-07-01', phone: '123' }), [], flightDate);
    expect(invalid).toEqual(expect.arrayContaining(['成人旅客年龄需在18-70周岁范围内', '证件有效期不得早于航班出发日期', '联系电话格式不正确']));
  });

  it('requires child passengers to be 2-12 years old and linked to an adult', () => {
    const errors = validatePassenger(passenger({ id: 'C1', type: 'child', birthDate: '2018-06-01' }), [], flightDate);
    expect(errors).toContain('儿童旅客必须关联一名成人旅客');

    const ok = validatePassenger(passenger({ id: 'C2', type: 'child', birthDate: '2018-06-01', linkedAdultId: 'A1' }), [passenger({ id: 'A1' })], flightDate);
    expect(ok).toEqual([]);
  });



  it('restricts child, infant and UM document types to ID card, passport or household register', () => {
    const errors = validatePassenger(passenger({ id: 'C3', type: 'child', birthDate: '2018-06-01', linkedAdultId: 'A1', documentType: '港澳通行证' }), [passenger({ id: 'A1' })], flightDate);
    expect(errors).toContain('儿童/婴儿/UM旅客证件类型仅支持身份证/护照/户口簿');
  });

  it('requires infant passengers to be 14 days to under 2 years and linked to an adult', () => {
    const tooYoung = validatePassenger(passenger({ id: 'I1', type: 'infant', birthDate: '2026-07-25', linkedAdultId: 'A1' }), [passenger({ id: 'A1' })], flightDate);
    expect(tooYoung).toContain('婴儿旅客年龄需在14天-2周岁范围内');

    const ok = validatePassenger(passenger({ id: 'I2', type: 'infant', birthDate: '2025-02-01', linkedAdultId: 'A1' }), [passenger({ id: 'A1' })], flightDate);
    expect(ok).toEqual([]);
  });

  it('requires UM passenger age and sender/receiver information', () => {
    const errors = validatePassenger(passenger({ id: 'U1', type: 'um', birthDate: '2018-09-01' }), [], flightDate);
    expect(errors).toEqual(expect.arrayContaining(['无成人陪伴儿童必须填写送机人信息', '无成人陪伴儿童必须填写接机人信息']));

    const ok = validatePassenger(passenger({
      id: 'U2',
      type: 'um',
      birthDate: '2018-09-01',
      sender: { name: '王五', phone: '13700137000', documentNumber: '110101198001011234' },
      receiver: { name: '赵六', phone: '13600136000', relationship: '母亲' },
    }), [], flightDate);
    expect(ok).toEqual([]);
  });

  it('rejects order creation when cabin inventory is not enough', () => {
    const passengers = [passenger({ id: 'A1' }), passenger({ id: 'A2', documentNumber: '110101199002023333' })];
    const errors = validateOrderRequest(booking({ cabinRemainingSeats: 1, passengers }));
    expect(errors).toContain('所选舱位余票不足');
  });

  it('calculates adult, child, infant and UM fare rules', () => {
    expect(calculatePassengerFare(1000, 'adult')).toBe(1000);
    expect(calculatePassengerFare(1000, 'child')).toBe(500);
    expect(calculatePassengerFare(1000, 'infant')).toBe(100);
    expect(calculatePassengerFare(1000, 'um')).toBe(500);
  });

  it.each([
    ['first' as CabinClass, false, 1000, 50, 950],
    ['business' as CabinClass, true, 1000, 100, 900],
    ['economy' as CabinClass, false, 1000, 50, 950],
    ['economy' as CabinClass, true, 1000, 200, 800],
  ])('calculates refund for %s cabin afterDeparture=%s', (cabinClass, afterDeparture, paid, fee, refund) => {
    expect(calculateRefund({ cabinClass, paidAmount: paid, afterDeparture })).toEqual({ fee, refundAmount: refund });
  });

  it('creates an order with order number, PNR and ticket numbers', () => {
    const order = createOrder(booking({ passengers: [passenger({ id: 'A1' }), passenger({ id: 'C1', type: 'child', birthDate: '2016-01-01', linkedAdultId: 'A1' })] }), {
      now: new Date('2026-07-02T08:00:00Z'),
      random: () => 0.123456,
    });

    expect(order.orderNo).toMatch(/^CAO20260702/);
    expect(order.pnr).toMatch(/^[A-Z0-9]{6}$/);
    expect(order.tickets).toHaveLength(2);
    expect(order.tickets[0].ticketNo).toMatch(/^781-20260702/);
    expect(order.totalAmount).toBe(1470);
  });
});
