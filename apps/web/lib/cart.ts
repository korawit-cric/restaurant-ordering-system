import { z } from 'zod';
import type { CreateOrder, MenuItem, PaymentMethod } from '@repo/api-client';
const line = z
  .object({
    menuItemId: z.string().min(1),
    quantity: z.number().int().min(1).max(30),
    expectedPrice: z.string().regex(/^\d{1,8}\.\d{2}$/),
  })
  .strict();
const savedCart = z.object({
  cart: z.record(z.number().int().min(0).max(30)),
  pending: z
    .object({
      requestKey: z.string().uuid(),
      method: z.enum(['CASH', 'QR']),
      items: z.array(line).min(1).max(40),
    })
    .strict()
    .nullable(),
});
export function restoreCart(raw: string | null) {
  return raw ? savedCart.parse(JSON.parse(raw)) : null;
}
export function prepareOrder(
  cart: Record<string, number>,
  menu: MenuItem[],
  method: PaymentMethod,
  requestKey: string,
): CreateOrder {
  const items = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, quantity]) => {
      const item = menu.find((m) => m.id === id);
      if (!item?.active || !item.available)
        throw new Error(
          'An item is no longer available. Remove it before ordering.',
        );
      return {
        menuItemId: id,
        quantity,
        expectedPrice: Number(item.price).toFixed(2),
      };
    });
  return savedCart.shape.pending.unwrap().parse({ requestKey, method, items });
}
