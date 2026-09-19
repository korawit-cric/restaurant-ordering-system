import { Prisma } from '@repo/prisma';
import { randomUUID } from 'node:crypto';
import {
  allowedTransition,
  bangkokDay,
  createOrderSchema,
  parse,
  snapshot,
} from './rules';
import { hashPassword, verifyPassword } from '../security/password';
describe('Ordering invariants', () => {
  const input = [{ menuItemId: 'one', quantity: 3, expectedPrice: '0.10' }];
  const item = {
    id: 'one',
    name: 'Soda',
    price: new Prisma.Decimal('0.10'),
    active: true,
    available: true,
    category: { active: true },
  };
  it('uses decimal arithmetic and snapshots authoritative names', () => {
    const result = snapshot([item], input);
    expect(result.total.toString()).toBe('0.3');
    expect(result.lines[0]?.name).toBe('Soda');
  });
  it('rejects stale prices, sold-out items, inactive categories and unknown items', () => {
    expect(() =>
      snapshot([item], [{ ...input[0]!, expectedPrice: '0.20' }]),
    ).toThrow();
    expect(() => snapshot([{ ...item, available: false }], input)).toThrow();
    expect(() =>
      snapshot([{ ...item, category: { active: false } }], input),
    ).toThrow();
    expect(() => snapshot([], input)).toThrow();
  });
  it.each([0, -1, 31, 1.5, '2', null])(
    'rejects malformed quantity %p',
    (quantity) =>
      expect(() =>
        parse(createOrderSchema, {
          requestKey: randomUUID(),
          method: 'CASH',
          items: [{ ...input[0], quantity }],
        }),
      ).toThrow(),
  );
  it('rejects client totals and duplicate menu lines', () => {
    expect(() =>
      parse(createOrderSchema, {
        requestKey: randomUUID(),
        method: 'CASH',
        items: input,
        total: 1,
      }),
    ).toThrow();
    expect(() =>
      parse(createOrderSchema, {
        requestKey: randomUUID(),
        method: 'CASH',
        items: [...input, ...input],
      }),
    ).toThrow();
  });
  it('allows forward fulfillment only', () => {
    expect(allowedTransition('NEW', 'SERVED')).toBe(false);
    expect(allowedTransition('PREPARING', 'ACCEPTED')).toBe(false);
    expect(allowedTransition('CANCELLED', 'NEW')).toBe(false);
    expect(allowedTransition('PREPARING', 'SERVED')).toBe(true);
  });
  it('uses Bangkok midnight across UTC date boundaries', () => {
    const day = bangkokDay(new Date('2026-09-18T18:00:00Z'));
    expect(day.date).toBe('2026-09-19');
    expect(day.start.toISOString()).toBe('2026-09-18T17:00:00.000Z');
    expect(day.end.getTime() - day.start.getTime()).toBe(86400000);
  });
  it('salts passwords and verifies them safely', () => {
    const a = hashPassword('long secure password');
    const b = hashPassword('long secure password');
    expect(a).not.toBe(b);
    expect(verifyPassword('long secure password', a)).toBe(true);
    expect(verifyPassword('wrong', a)).toBe(false);
  });
});
