import { describe, expect, it } from 'vitest';
import { priceFor, priceFromFor } from './booking';
import { dateLong, euro, formatPhone, priceText } from './format';

const prices = [
  { serviceId: 'cut', variant: '', priceCents: 3000, isFrom: false, finishSurchargeCents: null },
  { serviceId: 'cut', variant: 'wash', priceCents: 4500, isFrom: true, finishSurchargeCents: null },
  { serviceId: 'color_root', variant: '', priceCents: 6900, isFrom: true, finishSurchargeCents: 1500 },
];

describe('client helpers', () => {
  it('dates are written in words', () => expect(dateLong('2026-11-03')).toBe('Di., 3. November 2026'));
  it('formats euros the German way', () => {
    expect(euro(4500).replace(/\s/g, ' ')).toBe('45 €');
    expect(euro(4550).replace(/\s/g, ' ')).toBe('45,50 €');
    expect(priceText({ cents: 6900, isFrom: true })?.replace(/\s/g, ' ')).toBe('ab 69 €');
  });
  it('price lookup mirrors the server', () => {
    expect(priceFor(prices, { serviceId: 'cut', variant: 'dry' })).toEqual({ cents: 3000, isFrom: false });
    expect(priceFor(prices, { serviceId: 'cut', variant: 'wash' })).toEqual({ cents: 4500, isFrom: true });
    expect(priceFor(prices, { serviceId: 'color_root', finish: true })).toEqual({ cents: 8400, isFrom: true });
    expect(priceFor(prices, { serviceId: 'perm' })).toBeNull();
    expect(priceFromFor(prices, 'cut')).toEqual({ cents: 3000, isFrom: true });
  });
  it('phone numbers are grouped for reading', () => {
    expect(formatPhone('+4915123456789')).toBe('+49 1512 3456789');
    expect(formatPhone('030 123 45 67')).toBe('030 123 45 67');
  });
});
