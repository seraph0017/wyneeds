import type { Flight } from '../domain/types';
import { cities, findCity } from './cities';
import importedFlightData from './imported-flight-data.json';

const airlines = [
  { name: '中国国际航空', logo: 'CA' },
  { name: '东方航空', logo: 'MU' },
  { name: '南方航空', logo: 'CZ' },
  { name: '海南航空', logo: 'HU' },
  { name: '厦门航空', logo: 'MF' },
];

const aircrafts = ['波音737-800', '空客A320neo', '空客A321', '波音787-9', '中国商飞C919'];
const airlineByPrefix: Record<string, { name: string; logo: string }> = {
  '3U': { name: '四川航空', logo: '3U' },
  CA: { name: '中国国际航空', logo: 'CA' },
  MU: { name: '东方航空', logo: 'MU' },
  CZ: { name: '南方航空', logo: 'CZ' },
  HU: { name: '海南航空', logo: 'HU' },
  MF: { name: '厦门航空', logo: 'MF' },
  ZH: { name: '深圳航空', logo: 'ZH' },
  KN: { name: '中国联合航空', logo: 'KN' },
  SC: { name: '山东航空', logo: 'SC' },
  CX: { name: '国泰航空', logo: 'CX' },
  OZ: { name: '韩亚航空', logo: 'OZ' },
};

type Route = [fromCode: string, toCode: string, durationMinutes: number];

function twoWay(routes: Route[]): Route[] {
  return routes.flatMap(([from, to, duration]): Route[] => [
    [from, to, duration],
    [to, from, duration + 5],
  ]);
}

const baseRoutes: Route[] = [
  ['PEK', 'SHA', 125], ['SHA', 'PEK', 130], ['PEK', 'CAN', 190], ['CAN', 'PEK', 185],
  ['PEK', 'SZX', 200], ['SZX', 'PEK', 195], ['SHA', 'CAN', 150], ['CAN', 'SHA', 145],
  ['SHA', 'SZX', 150], ['SZX', 'SHA', 145], ['CTU', 'PEK', 165], ['PEK', 'CTU', 170],
  ['CKG', 'SHA', 145], ['SHA', 'CKG', 150], ['HGH', 'XIY', 135], ['XIY', 'HGH', 140],
  ['WUH', 'KMG', 125], ['KMG', 'WUH', 130], ['NKG', 'XMN', 105], ['XMN', 'NKG', 110],
  ['CSX', 'TAO', 140], ['TAO', 'CSX', 135], ['URC', 'PEK', 235], ['PEK', 'URC', 240],
  ['LXA', 'CTU', 120], ['CTU', 'LXA', 125], ['HAK', 'SHA', 175], ['SHA', 'HAK', 180],
  ['SYX', 'CAN', 95], ['CAN', 'SYX', 95], ['KWE', 'SZX', 105], ['SZX', 'KWE', 110],
];

const expandedDomesticRoutes = twoWay([
  ['PKX', 'CAN', 190],
  ['PKX', 'SZX', 195],
  ['PEK', 'PVG', 130],
  ['PVG', 'CAN', 150],
  ['PVG', 'SZX', 150],
  ['TSN', 'CAN', 185],
  ['SJW', 'SHA', 120],
  ['TYN', 'SHA', 130],
  ['HET', 'SHA', 155],
  ['SHE', 'SHA', 145],
  ['DLC', 'SHA', 110],
  ['CGQ', 'SHA', 160],
  ['HRB', 'SHA', 180],
  ['HFE', 'SZX', 125],
  ['TNA', 'PVG', 100],
  ['KHN', 'PVG', 105],
  ['FOC', 'PEK', 165],
  ['NGB', 'CAN', 125],
  ['WNZ', 'PEK', 150],
  ['HGH', 'TXN', 55],
  ['CGO', 'CAN', 125],
  ['ZUH', 'PKX', 185],
  ['NNG', 'PVG', 165],
  ['KWL', 'SHA', 140],
  ['LJG', 'CTU', 90],
  ['KMG', 'JHG', 60],
  ['KMG', 'NDL', 70],
  ['LHW', 'PEK', 145],
  ['INC', 'SHA', 160],
  ['XNN', 'PEK', 150],
]);

const expandedOverseasRoutes = twoWay([
  ['PEK', 'HKG', 205],
  ['PVG', 'HKG', 170],
  ['PKX', 'MFM', 210],
  ['PVG', 'TPE', 115],
  ['XMN', 'TPE', 80],
  ['PVG', 'NRT', 180],
  ['SHA', 'HND', 175],
  ['PEK', 'ICN', 125],
  ['TAO', 'ICN', 95],
  ['CAN', 'BKK', 165],
  ['KMG', 'BKK', 135],
  ['PVG', 'SIN', 330],
  ['CAN', 'SIN', 240],
  ['PEK', 'DXB', 480],
  ['PVG', 'DXB', 515],
  ['PVG', 'FRA', 720],
  ['PEK', 'FRA', 680],
  ['PVG', 'LHR', 740],
  ['PEK', 'LHR', 720],
  ['PVG', 'CDG', 735],
  ['PEK', 'CDG', 705],
]);

function parseDurationMinutes(duration: string): number {
  const match = duration.match(/(?:(\d+)h)?(?:(\d+)m)?/i);
  if (!match) return 150;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + minutes;
}

const importedRoutes: Route[] = importedFlightData.flights.map((flight) => [
  flight.from,
  flight.to,
  parseDurationMinutes(flight.duration),
]);

function routeKey(fromCode: string, toCode: string): string {
  return `${fromCode}-${toCode}`;
}

function isLongHaul(code: string): boolean {
  return ['DXB', 'FRA', 'LHR', 'CDG'].includes(code);
}

function isOverseas(code: string): boolean {
  const city = findCity(code);
  return Boolean(city && !['北京市', '天津市', '上海市', '重庆市'].includes(city.province) && !city.province.endsWith('省') && !city.province.endsWith('自治区'));
}

function deterministicHash(value: string): number {
  return [...value].reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 11), 0);
}

function estimateDuration(fromCode: string, toCode: string): number {
  const hash = deterministicHash(`${fromCode}-${toCode}`);
  if (isLongHaul(fromCode) || isLongHaul(toCode)) return 560 + (hash % 190);
  if (isOverseas(fromCode) || isOverseas(toCode)) return 95 + (hash % 260);
  if (fromCode.slice(0, 1) === toCode.slice(0, 1)) return 55 + (hash % 95);
  return 85 + (hash % 165);
}

function buildCompleteRouteNetwork(seedRoutes: Route[]): Route[] {
  const routeMap = new Map<string, Route>();

  for (const [fromCode, toCode, duration] of seedRoutes) {
    if (!findCity(fromCode) || !findCity(toCode) || fromCode === toCode) continue;
    routeMap.set(routeKey(fromCode, toCode), [fromCode, toCode, duration]);
  }

  for (const from of cities) {
    for (const to of cities) {
      if (from.code === to.code) continue;
      const key = routeKey(from.code, to.code);
      if (!routeMap.has(key)) routeMap.set(key, [from.code, to.code, estimateDuration(from.code, to.code)]);
    }
  }

  return [...routeMap.values()];
}

const routes: Route[] = buildCompleteRouteNetwork([...baseRoutes, ...expandedDomesticRoutes, ...expandedOverseasRoutes, ...importedRoutes]);

function addMinutes(time: string, minutes: number): { time: string; nextDay: boolean } {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return { time: `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`, nextDay: total >= 1440 };
}

function baseFare(duration: number, index: number): number {
  return Math.round((560 + duration * 4.2 + (index % 5) * 90) / 10) * 10;
}

function makeFlight(fromCode: string, toCode: string, duration: number, index: number, departureTime: string): Flight {
  const from = findCity(fromCode)!;
  const to = findCity(toCode)!;
  const airline = airlines[index % airlines.length];
  const arrival = addMinutes(departureTime, duration);
  const fare = baseFare(duration, index);
  const soldOut = index % 11 === 0;
  const lowFare = index % 7 === 0;
  return {
    id: `FL-${fromCode}-${toCode}-${String(index + 1).padStart(3, '0')}`,
    flightNo: `${airline.logo}${String(1000 + ((index * 17) % 9000)).padStart(4, '0')}`,
    airline: airline.name,
    logoText: airline.logo,
    fromCityCode: fromCode,
    toCityCode: toCode,
    fromAirport: from.airport,
    toAirport: to.airport,
    departureTime,
    arrivalTime: arrival.time,
    arrivalNextDay: arrival.nextDay,
    durationMinutes: duration,
    aircraft: aircrafts[index % aircrafts.length],
    loadFactor: soldOut ? 100 : 62 + (index % 30),
    cabins: [
      { class: 'first', name: '头等舱', fare: Math.round(fare * 2.2), remainingSeats: soldOut ? 0 : 2 + (index % 4) },
      { class: 'business', name: '公务舱', fare: Math.round(fare * 1.55), remainingSeats: soldOut ? 0 : 4 + (index % 6) },
      { class: 'economy', name: '经济舱', fare: lowFare ? Math.round(fare * 0.68) : fare, remainingSeats: soldOut ? 0 : 18 + (index % 22), discountLabel: lowFare ? '低价航班' : undefined },
    ],
  };
}

function flightPrefix(flightNo: string): string {
  if (flightNo.startsWith('3U')) return '3U';
  return flightNo.slice(0, 2);
}

function makeImportedFlight(seed: typeof importedFlightData.flights[number], index: number): Flight {
  const from = findCity(seed.from)!;
  const to = findCity(seed.to)!;
  const prefix = flightPrefix(seed.flightNo);
  const airline = airlineByPrefix[prefix] ?? { name: '模拟航司', logo: prefix };
  const duration = parseDurationMinutes(seed.duration);
  const fare = baseFare(duration, index);
  const arrivalNextDay = seed.arriveTime.includes('+');
  const arrivalTime = seed.arriveTime.replace(/\+.*/, '');

  return {
    id: `IM-${seed.from}-${seed.to}-${seed.flightNo}`,
    flightNo: seed.flightNo,
    airline: airline.name,
    logoText: airline.logo,
    fromCityCode: seed.from,
    toCityCode: seed.to,
    fromAirport: from.airport,
    toAirport: to.airport,
    departureTime: seed.departTime,
    arrivalTime,
    arrivalNextDay,
    durationMinutes: duration,
    aircraft: seed.aircraft,
    loadFactor: 58 + (index % 36),
    cabins: [
      { class: 'first', name: '头等舱', fare: Math.round(fare * 2.2), remainingSeats: seed.seatsF },
      { class: 'business', name: '公务舱', fare: Math.round(fare * 1.55), remainingSeats: seed.seatsC },
      { class: 'economy', name: '经济舱', fare, remainingSeats: seed.seatsY },
    ],
  };
}

const departures = ['07:10', '09:25', '11:40', '14:05', '16:35', '19:20'];

const generatedFlights: Flight[] = routes.flatMap(([from, to, duration], routeIndex) => {
  return [0, 1].map((variant) => makeFlight(String(from), String(to), Number(duration), routeIndex * 2 + variant, departures[(routeIndex + variant) % departures.length]));
});

const importedFlights: Flight[] = importedFlightData.flights.map((seed, index) => makeImportedFlight(seed, generatedFlights.length + index));

export const flights: Flight[] = [...generatedFlights, ...importedFlights];

export function searchFlights(fromCityCode: string, toCityCode: string): Flight[] {
  const matched = flights.filter((flight) => flight.fromCityCode === fromCityCode && flight.toCityCode === toCityCode);
  if (matched.length) return matched;
  const from = cities.find((city) => city.code === fromCityCode);
  const to = cities.find((city) => city.code === toCityCode);
  if (!from || !to) return [];
  return [makeFlight(fromCityCode, toCityCode, 150, flights.length + fromCityCode.charCodeAt(0) + toCityCode.charCodeAt(0), '10:30')];
}

export function findFlight(id: string): Flight | undefined {
  return flights.find((flight) => flight.id === id);
}
