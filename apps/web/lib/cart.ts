import { z } from 'zod';
import type { CreateOrder, Product, PaymentMethod } from '@repo/api-client';
const line = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(30),
    expectedPrice: z.string(),
    note: z.string().max(240).nullable().optional(),
  })
  .strict();
const saved = z.object({
  cart: z.record(z.number().int().min(0).max(30)),
  notes: z.record(z.string().max(240)),
  pending: z
    .object({
      requestKey: z.string().uuid(),
      method: z.enum(['CASH', 'PROMPTPAY']).nullable(),
      items: z.array(line).min(1).max(40),
    })
    .strict()
    .nullable(),
});
export function restoreCart(raw: string | null) {
  return raw ? saved.parse(JSON.parse(raw)) : null;
}
export function prepareOrder(
  cart: Record<string, number>,
  notes: Record<string, string>,
  menu: Product[],
  method: PaymentMethod | null,
  requestKey: string,
): CreateOrder {
  const items = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([id, quantity]) => {
      const p = menu.find((x) => x.id === id);
      if (!p?.active || !p.available)
        throw new Error('An item is no longer available. Refresh the menu.');
      return {
        productId: id,
        quantity,
        expectedPrice: Number(p.price).toFixed(2),
        note: notes[id] || null,
      };
    });
  return saved.shape.pending.unwrap().parse({ requestKey, method, items });
}
