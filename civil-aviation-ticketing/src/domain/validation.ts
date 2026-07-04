import type { BookingRequest, ContactInput, EscortPerson, FlightSearchInput, PassengerInput } from './types';

const phonePattern = /^1[3-9]\d{9}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const chineseIdPattern = /^\d{17}[\dXx]$/;
const passportPattern = /^[A-Za-z0-9]{5,18}$/;
const householdPattern = /^[\u4e00-\u9fa5A-Za-z0-9-]{3,30}$/;
const namePattern = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z·\s]{1,30}$/;

export function calculateAgeOnDate(birthDate: string, onDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00`);
  const target = new Date(`${onDate}T00:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(target.getTime())) return Number.NaN;
  let age = target.getFullYear() - birth.getFullYear();
  const monthDiff = target.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && target.getDate() < birth.getDate())) age -= 1;
  return age;
}

function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00`).getTime();
  const b = new Date(`${end}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.floor((b - a) / 86_400_000);
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function validDocument(passenger: PassengerInput): boolean {
  if (passenger.documentType === '身份证') return chineseIdPattern.test(passenger.documentNumber);
  if (passenger.documentType === '户口簿') return householdPattern.test(passenger.documentNumber);
  return passportPattern.test(passenger.documentNumber);
}

function validateEscort(person: EscortPerson | undefined, role: '送机人' | '接机人'): string[] {
  const errors: string[] = [];
  if (!person?.name || !person.phone) {
    errors.push(`无成人陪伴儿童必须填写${role}信息`);
    return errors;
  }
  if (!namePattern.test(person.name)) errors.push(`${role}姓名格式不正确`);
  if (!phonePattern.test(person.phone)) errors.push(`${role}联系电话格式不正确`);
  if (role === '送机人' && !person.documentNumber) errors.push('送机人证件号必填');
  if (role === '接机人' && !person.relationship) errors.push('接机人与儿童关系必填');
  return errors;
}

export function validateFlightSearch(input: FlightSearchInput): string[] {
  const errors: string[] = [];
  if (!input.fromCityCode) errors.push('请选择出发城市');
  if (!input.toCityCode) errors.push('请选择到达城市');
  if (input.fromCityCode && input.toCityCode && input.fromCityCode === input.toCityCode) errors.push('出发城市与到达城市不能相同');
  if (!input.flightDate) errors.push('请选择出发日期');
  if (input.adults < 0 || input.children < 0 || input.infants < 0) errors.push('旅客人数不能为负数');
  if (input.adults + input.children + input.infants <= 0) errors.push('请至少选择一名旅客');
  if (input.infants > input.adults) errors.push('婴儿旅客数量不能超过成人旅客数量');
  return errors;
}

export function validateContact(contact: ContactInput): string[] {
  const errors: string[] = [];
  if (!contact.name || !namePattern.test(contact.name)) errors.push('联系人姓名格式不正确');
  if (!phonePattern.test(contact.phone)) errors.push('联系人电话格式不正确');
  if (contact.email && !emailPattern.test(contact.email)) errors.push('联系人邮箱格式不正确');
  return errors;
}

export function validatePassenger(passenger: PassengerInput, allPassengers: PassengerInput[], flightDate: string): string[] {
  const errors: string[] = [];
  if (!passenger.name || !namePattern.test(passenger.name)) errors.push('乘机人姓名格式不正确');
  if (!passenger.gender) errors.push('请选择乘机人性别');
  if (!passenger.birthDate || !isValidDateString(passenger.birthDate)) errors.push('请选择乘机人出生日期');
  if (!passenger.documentType) errors.push('请选择证件类型');
  const adultDocumentTypes = ['身份证', '护照', '港澳通行证', '台胞证'];
  const minorDocumentTypes = ['身份证', '护照', '户口簿'];
  if (passenger.type === 'adult' && !adultDocumentTypes.includes(passenger.documentType)) errors.push('成人旅客证件类型仅支持身份证/护照/港澳通行证/台胞证');
  if (passenger.type !== 'adult' && !minorDocumentTypes.includes(passenger.documentType)) errors.push('儿童/婴儿/UM旅客证件类型仅支持身份证/护照/户口簿');
  if (!passenger.documentNumber || !validDocument(passenger)) errors.push('证件号码格式不正确');
  if (!phonePattern.test(passenger.phone)) errors.push('联系电话格式不正确');
  if (passenger.email && !emailPattern.test(passenger.email)) errors.push('电子邮箱格式不正确');

  const age = calculateAgeOnDate(passenger.birthDate, flightDate);
  const days = daysBetween(passenger.birthDate, flightDate);
  const adultIds = new Set(allPassengers.filter((item) => item.type === 'adult').map((item) => item.id));

  if (passenger.type === 'adult') {
    if (age < 18 || age > 70) errors.push('成人旅客年龄需在18-70周岁范围内');
    if (!passenger.documentExpiry) errors.push('证件有效期必填');
    if (passenger.documentExpiry && (!isValidDateString(passenger.documentExpiry) || passenger.documentExpiry < flightDate)) errors.push('证件有效期不得早于航班出发日期');
  }

  if (passenger.type === 'child') {
    if (age < 2 || age >= 12) errors.push('儿童旅客年龄需在2-12周岁范围内');
    if (!passenger.linkedAdultId || !adultIds.has(passenger.linkedAdultId)) errors.push('儿童旅客必须关联一名成人旅客');
  }

  if (passenger.type === 'infant') {
    if (days < 14 || age >= 2) errors.push('婴儿旅客年龄需在14天-2周岁范围内');
    if (!passenger.linkedAdultId || !adultIds.has(passenger.linkedAdultId)) errors.push('婴儿旅客必须关联一名成人旅客');
  }

  if (passenger.type === 'um') {
    if (age < 5 || age >= 12) errors.push('无成人陪伴儿童年龄需在5-12周岁范围内');
    errors.push(...validateEscort(passenger.sender, '送机人'));
    errors.push(...validateEscort(passenger.receiver, '接机人'));
  }

  return errors;
}

export function validateOrderRequest(request: BookingRequest): string[] {
  const errors: string[] = [];
  if (!request.flightId) errors.push('航班不能为空');
  if (!request.flightDate || !isValidDateString(request.flightDate)) errors.push('航班日期不能为空');
  if (!Number.isFinite(request.baseFare) || request.baseFare <= 0) errors.push('票价必须大于0');
  if (!Array.isArray(request.passengers) || request.passengers.length === 0) errors.push('请填写乘机人信息');
  if (Array.isArray(request.passengers) && request.passengers.length > request.cabinRemainingSeats) errors.push('所选舱位余票不足');
  if (Array.isArray(request.passengers)) request.passengers.forEach((item) => errors.push(...validatePassenger(item, request.passengers, request.flightDate)));
  if (request.contact) errors.push(...validateContact(request.contact));
  else errors.push('联系人姓名格式不正确', '联系人电话格式不正确');
  return Array.from(new Set(errors));
}
