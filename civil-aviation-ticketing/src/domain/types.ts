export type PassengerType = 'adult' | 'child' | 'infant' | 'um';
export type Gender = '男' | '女';
export type DocumentType = '身份证' | '护照' | '港澳通行证' | '台胞证' | '户口簿';
export type CabinClass = 'first' | 'business' | 'economy';
export type OrderStatus = '下单成功' | '已取消' | '已完成' | '已退票' | '已改签';

export interface FlightSearchInput {
  fromCityCode: string;
  toCityCode: string;
  flightDate: string;
  adults: number;
  children: number;
  infants: number;
}

export interface EscortPerson {
  name: string;
  phone: string;
  documentNumber?: string;
  relationship?: string;
}

export interface PassengerInput {
  id: string;
  type: PassengerType;
  name: string;
  gender: Gender;
  birthDate: string;
  documentType: DocumentType;
  documentNumber: string;
  documentExpiry?: string;
  phone: string;
  email?: string;
  linkedAdultId?: string;
  um?: boolean;
  sender?: EscortPerson;
  receiver?: EscortPerson;
  note?: string;
}

export interface ContactInput {
  name: string;
  phone: string;
  email?: string;
}


export interface FlightSnapshot {
  flightNo: string;
  airline: string;
  aircraft: string;
  fromAirport: string;
  toAirport: string;
  departureTime: string;
  arrivalTime: string;
  arrivalNextDay?: boolean;
  durationMinutes: number;
}

export interface BookingRequest {
  flightId: string;
  flightDate: string;
  cabinClass: CabinClass;
  cabinRemainingSeats: number;
  baseFare: number;
  route: string;
  flightSnapshot?: FlightSnapshot;
  passengers: PassengerInput[];
  contact: ContactInput;
}

export interface TicketRecord {
  passengerId: string;
  passengerName: string;
  passengerType: PassengerType;
  ticketNo: string;
  fare: number;
}

export interface OrderRecord {
  id: string;
  orderNo: string;
  pnr: string;
  flightId: string;
  flightDate: string;
  route: string;
  flightSnapshot?: FlightSnapshot;
  cabinClass: CabinClass;
  status: OrderStatus;
  passengers: PassengerInput[];
  contact: ContactInput;
  tickets: TicketRecord[];
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  refund?: {
    fee: number;
    refundAmount: number;
    afterDeparture: boolean;
    at: string;
  };
  change?: {
    targetFlightId: string;
    fee: number;
    fareDifference: number;
    at: string;
  };
}

export interface City {
  name: string;
  code: string;
  province: string;
  airport: string;
}

export interface CabinInventory {
  class: CabinClass;
  name: string;
  fare: number;
  remainingSeats: number;
  discountLabel?: string;
}

export interface Flight {
  id: string;
  flightNo: string;
  airline: string;
  logoText: string;
  fromCityCode: string;
  toCityCode: string;
  fromAirport: string;
  toAirport: string;
  departureTime: string;
  arrivalTime: string;
  arrivalNextDay?: boolean;
  durationMinutes: number;
  aircraft: string;
  loadFactor: number;
  cabins: CabinInventory[];
}
