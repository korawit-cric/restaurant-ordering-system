import { Prisma } from '@repo/prisma';
import {
  allowedTransition,
  branchDay,
  createOrderSchema,
  snapshot,
} from './rules';
const product = {
  id: 'f2956cf6-816c-4637-936a-7577946daa10',
  name: 'Leo',
  price: new Prisma.Decimal('80.00'),
  active: true,
  available: true,
  category: { active: true },
  menu: { active: true },
};
describe('order rules', () => {
  test('snapshots current database price and quantity', () => {
    const r = snapshot(
      [product],
      [{ productId: product.id, quantity: 2, expectedPrice: '80.00' }],
    );
    expect(r.total.toString()).toBe('160');
    expect(r.lines[0]?.productNameSnapshot).toBe('Leo');
  });
  test('rejects stale price and sold-out product', () => {
    expect(() =>
      snapshot(
        [product],
        [{ productId: product.id, quantity: 1, expectedPrice: '70.00' }],
      ),
    ).toThrow();
    expect(() =>
      snapshot(
        [{ ...product, available: false }],
        [{ productId: product.id, quantity: 1, expectedPrice: '80.00' }],
      ),
    ).toThrow();
  });
  test('rejects duplicate lines', () => {
    expect(
      createOrderSchema.safeParse({
        requestKey: 'f2956cf6-816c-4637-936a-7577946daa11',
        method: 'CASH',
        items: [
          { productId: product.id, quantity: 1, expectedPrice: '80.00' },
          { productId: product.id, quantity: 1, expectedPrice: '80.00' },
        ],
      }).success,
    ).toBe(false);
  });
  test('validates state transitions', () => {
    expect(allowedTransition('NEW', 'ACCEPTED')).toBe(true);
    expect(allowedTransition('NEW', 'COMPLETED')).toBe(false);
    expect(allowedTransition('READY', 'COMPLETED')).toBe(true);
  });
  test('uses branch timezone for daily summary', () => {
    expect(
      branchDay('Asia/Bangkok', new Date('2026-09-18T18:00:00Z')).date,
    ).toBe('2026-09-19');
  });
});
