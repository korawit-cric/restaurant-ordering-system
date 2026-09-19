import { prepareOrder, restoreCart } from './cart';
import type { MenuItem } from '@repo/api-client';
const item: MenuItem = {
  id: 'leo',
  name: 'Leo',
  price: '80.10',
  categoryId: 'beer',
  description: null,
  imageUrl: null,
  active: true,
  available: true,
  sortOrder: 0,
};
const key = '8b7d0d67-14d7-4eb0-afd2-114d13495d66';
test('preserves an uncertain submission byte-for-byte across a reload', () => {
  const pending = prepareOrder({ leo: 2 }, [item], 'CASH', key);
  expect(
    restoreCart(JSON.stringify({ cart: { leo: 2 }, pending }))?.pending,
  ).toEqual(pending);
});
test('normalises display prices without including client totals', () => {
  expect(
    prepareOrder({ leo: 2 }, [{ ...item, price: '80' }], 'QR', key),
  ).toEqual({
    requestKey: key,
    method: 'QR',
    items: [{ menuItemId: 'leo', quantity: 2, expectedPrice: '80.00' }],
  });
});
test('rejects empty, sold-out and corrupted stored carts', () => {
  expect(() => prepareOrder({}, [item], 'CASH', key)).toThrow();
  expect(() =>
    prepareOrder({ leo: 1 }, [{ ...item, available: false }], 'CASH', key),
  ).toThrow();
  expect(() => restoreCart('{"cart":{"leo":-2},"pending":null}')).toThrow();
});
