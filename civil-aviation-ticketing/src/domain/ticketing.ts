import type { BookingRequest, OrderRecord } from './types';
import { calculatePassengerFare } from './pricing';
import { validateOrderRequest } from './validation';

interface CreateOrderOptions {
  now?: Date;
  random?: () => number;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function dateStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}`;
}

function randomToken(length: number, alphabet: string, random: () => number): string {
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  }
  return token;
}

export function createPnr(random: () => number = Math.random): string {
  return randomToken(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', random);
}

export function createOrderNumber(now: Date = new Date(), random: () => number = Math.random): string {
  return `CAO${dateStamp(now)}${pad(Math.floor(random() * 1_000_000), 6)}`;
}

export function createTicketNumber(now: Date, index: number, random: () => number = Math.random): string {
  return `781-${dateStamp(now)}${pad(index + 1, 2)}${pad(Math.floor(random() * 10_000), 4)}`;
}

export function createOrder(request: BookingRequest, options: CreateOrderOptions = {}): OrderRecord {
  const errors = validateOrderRequest(request);
  if (errors.length) throw new Error(errors.join('；'));

  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const createdAt = now.toISOString();
  const tickets = request.passengers.map((passenger, index) => ({
    passengerId: passenger.id,
    passengerName: passenger.name,
    passengerType: passenger.type,
    ticketNo: createTicketNumber(now, index, random),
    fare: calculatePassengerFare(request.baseFare, passenger.type),
  }));

  return {
    id: createOrderNumber(now, random),
    orderNo: createOrderNumber(now, random),
    pnr: createPnr(random),
    flightId: request.flightId,
    flightDate: request.flightDate,
    route: request.route,
    flightSnapshot: request.flightSnapshot,
    cabinClass: request.cabinClass,
    status: '下单成功',
    passengers: request.passengers,
    contact: request.contact,
    tickets,
    totalAmount: tickets.reduce((sum, ticket) => sum + ticket.fare, 0),
    createdAt,
    updatedAt: createdAt,
  };
}
