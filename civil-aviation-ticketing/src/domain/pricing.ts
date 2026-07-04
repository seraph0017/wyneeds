import type { CabinClass, PassengerType } from './types';

export function calculatePassengerFare(baseFare: number, type: PassengerType): number {
  const ratio: Record<PassengerType, number> = {
    adult: 1,
    child: 0.5,
    infant: 0.1,
    um: 0.5,
  };
  return Math.round(baseFare * ratio[type]);
}

export function cabinName(cabinClass: CabinClass): string {
  return cabinClass === 'first' ? '头等舱' : cabinClass === 'business' ? '公务舱' : '经济舱';
}

export function calculateRefund(input: { cabinClass: CabinClass; paidAmount: number; afterDeparture: boolean; discountEconomy?: boolean }): { fee: number; refundAmount: number } {
  const { cabinClass, paidAmount, afterDeparture, discountEconomy } = input;
  let rate = 0.05;
  if (afterDeparture) {
    if (cabinClass === 'economy') {
      rate = discountEconomy ? 0.3 : 0.2;
    } else {
      rate = 0.1;
    }
  }
  const fee = Math.round(paidAmount * rate);
  return { fee, refundAmount: Math.max(0, paidAmount - fee) };
}

export function calculateChangeFee(input: { cabinClass: CabinClass; paidAmount: number; sameCabin: boolean }): number {
  if (input.sameCabin) return Math.round(input.paidAmount * 0.03);
  return Math.round(input.paidAmount * 0.05);
}
