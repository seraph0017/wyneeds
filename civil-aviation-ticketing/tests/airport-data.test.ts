import { describe, expect, it } from 'vitest';
import { cities } from '../src/data/cities';
import { findFlight, flights, searchFlights } from '../src/data/flights';
import importedFlightData from '../src/data/imported-flight-data.json';

const requestedDomesticCodes = [
  'PEK', 'PKX', 'TSN', 'SJW', 'TYN', 'HET',
  'SHE', 'DLC', 'CGQ', 'HRB',
  'PVG', 'SHA', 'HGH', 'NKG', 'HFE', 'TNA', 'TAO', 'KHN', 'FOC', 'XMN', 'NGB', 'WNZ', 'TXN',
  'CAN', 'SZX', 'WUH', 'CSX', 'CGO', 'SYX', 'HAK', 'ZUH', 'NNG', 'KWL',
  'CKG', 'CTU', 'KMG', 'KWE', 'LJG', 'JHG', 'NDL',
  'XIY', 'LHW', 'INC', 'XNN', 'URC',
] as const;

const requestedOverseasCodes = [
  'HKG', 'MFM', 'TPE', 'NRT', 'HND', 'ICN', 'BKK', 'SIN', 'DXB', 'FRA', 'LHR', 'CDG',
] as const;

const requestedCodes = [...requestedDomesticCodes, ...requestedOverseasCodes];

describe('airport and route seed data', () => {
  it('includes the requested domestic and common overseas IATA airport codes', () => {
    const cityCodes = new Set(cities.map((city) => city.code));
    const missingCodes = requestedCodes.filter((code) => !cityCodes.has(code));

    expect(missingCodes).toEqual([]);
  });

  it('keeps airport codes unique for datalist lookup', () => {
    const duplicates = cities
      .map((city) => city.code)
      .filter((code, index, allCodes) => allCodes.indexOf(code) !== index);

    expect(duplicates).toEqual([]);
  });

  it('has explicit simulated flights touching every requested airport code', () => {
    const airportCodesWithFlights = new Set(flights.flatMap((flight) => [flight.fromCityCode, flight.toCityCode]));
    const missingFlightCodes = requestedCodes.filter((code) => !airportCodesWithFlights.has(code));

    expect(missingFlightCodes).toEqual([]);
  });

  it('seeds representative domestic and international route flights instead of only relying on fallback generation', () => {
    const explicitRoutePairs = new Set(flights.map((flight) => `${flight.fromCityCode}-${flight.toCityCode}`));

    expect(explicitRoutePairs.has('PKX-CAN')).toBe(true);
    expect(explicitRoutePairs.has('PEK-PVG')).toBe(true);
    expect(explicitRoutePairs.has('HGH-TXN')).toBe(true);
    expect(explicitRoutePairs.has('KMG-JHG')).toBe(true);
    expect(explicitRoutePairs.has('KMG-NDL')).toBe(true);
    expect(explicitRoutePairs.has('PEK-HKG')).toBe(true);
    expect(explicitRoutePairs.has('PVG-NRT')).toBe(true);
    expect(explicitRoutePairs.has('PVG-LHR')).toBe(true);
    expect(explicitRoutePairs.has('CAN-BKK')).toBe(true);
  });

  it('can search representative newly seeded routes', () => {
    expect(searchFlights('PKX', 'CAN').length).toBeGreaterThanOrEqual(2);
    expect(searchFlights('PVG', 'NRT').length).toBeGreaterThanOrEqual(2);
    expect(searchFlights('KMG', 'JHG').length).toBeGreaterThanOrEqual(2);
  });

  it('provides bookable simulated flights between every pair of requested airports', () => {
    const gaps: string[] = [];

    for (const fromCode of requestedCodes) {
      for (const toCode of requestedCodes) {
        if (fromCode === toCode) continue;

        const routeFlights = searchFlights(fromCode, toCode);
        if (routeFlights.length < 2) {
          gaps.push(`${fromCode}-${toCode}: 航班少于2班`);
          continue;
        }

        const unbookable = routeFlights.filter((flight) => !findFlight(flight.id));
        if (unbookable.length > 0) {
          gaps.push(`${fromCode}-${toCode}: ${unbookable.map((flight) => flight.id).join(',')} 不可订座`);
        }
      }
    }

    expect(gaps).toEqual([]);
  });

  it('merges the downloaded airport and flight seed data into the runnable system', () => {
    const cityCodes = new Set(cities.map((city) => city.code));
    const missingAirportCodes = importedFlightData.airports
      .map((airport) => airport.code)
      .filter((code) => !cityCodes.has(code));

    const importedFlightGaps = importedFlightData.flights.flatMap((imported) => {
      const routeFlights = searchFlights(imported.from, imported.to);
      const matched = routeFlights.find((flight) => (
        flight.flightNo === imported.flightNo
        && flight.departureTime === imported.departTime
        && flight.arrivalTime === imported.arriveTime
        && flight.aircraft === imported.aircraft
        && Boolean(findFlight(flight.id))
      ));

      return matched ? [] : [`${imported.from}-${imported.to} ${imported.flightNo}`];
    });

    expect(missingAirportCodes).toEqual([]);
    expect(importedFlightGaps).toEqual([]);
  });
});
