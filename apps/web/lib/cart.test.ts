import { prepareOrder, restoreCart } from './cart';
import type { Product } from '@repo/api-client';
const p: Product = {
  id: 'f2956cf6-816c-4637-936a-7577946daa10',
  categoryId: 'c',
  name: 'Leo',
  price: '80.00',
  description: null,
  imageUrl: null,
  active: true,
  available: true,
  sortOrder: 0,
};
test('prepares order with authoritative expected price and note', () => {
  const o = prepareOrder(
    { [p.id]: 2 },
    { [p.id]: 'Cold' },
    [p],
    'CASH',
    'f2956cf6-816c-4637-936a-7577946daa11',
  );
  expect(o.items).toEqual([
    { productId: p.id, quantity: 2, expectedPrice: '80.00', note: 'Cold' },
  ]);
});
test('rejects unavailable product', () => {
  expect(() =>
    prepareOrder(
      { [p.id]: 1 },
      {},
      [{ ...p, available: false }],
      'CASH',
      'f2956cf6-816c-4637-936a-7577946daa11',
    ),
  ).toThrow();
});
test('restores pending idempotent request', () => {
  const o = prepareOrder(
    { [p.id]: 1 },
    {},
    [p],
    'CASH',
    'f2956cf6-816c-4637-936a-7577946daa11',
  );
  expect(
    restoreCart(JSON.stringify({ cart: { [p.id]: 1 }, notes: {}, pending: o }))
      ?.pending?.requestKey,
  ).toBe(o.requestKey);
});
