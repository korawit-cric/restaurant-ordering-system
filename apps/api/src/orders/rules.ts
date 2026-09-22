import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, OrderStatus } from '@repo/prisma';
import { z } from 'zod';
export const createOrderSchema = z
  .object({
    requestKey: z.string().uuid(),
    method: z.enum(['CASH', 'PROMPTPAY']).nullable().optional(),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantity: z.number().int().min(1).max(30),
            expectedPrice: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
            note: z.string().trim().max(240).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine(
    (b) => new Set(b.items.map((i) => i.productId)).size === b.items.length,
    'Duplicate products',
  );
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return r.data;
}
export function snapshot(
  products: {
    id: string;
    name: string;
    price: Prisma.Decimal;
    active: boolean;
    available: boolean;
    category: { active: boolean };
    menu: { active: boolean };
  }[],
  input: z.infer<typeof createOrderSchema>['items'],
) {
  const lines = input.map((line) => {
    const p = products.find((x) => x.id === line.productId);
    if (!p || !p.active || !p.available || !p.category.active || !p.menu.active)
      throw new ConflictException(
        'An item is no longer available. Refresh the menu.',
      );
    if (!p.price.equals(line.expectedPrice))
      throw new ConflictException(
        `${p.name} has a new price. Refresh the menu.`,
      );
    return {
      productId: p.id,
      productNameSnapshot: p.name,
      unitPriceSnapshot: p.price,
      quantity: line.quantity,
      note: line.note || null,
      lineTotal: p.price.mul(line.quantity),
    };
  });
  const total = lines.reduce(
    (sum, line) => sum.add(line.lineTotal),
    new Prisma.Decimal(0),
  );
  return { lines, total };
}
export function allowedTransition(from: OrderStatus, to: OrderStatus) {
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    NEW: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  };
  return from === to || allowed[from].includes(to);
}
export function branchDay(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (key: string) => parts.find((x) => x.type === key)?.value || '';
  const dateString = `${part('year')}-${part('month')}-${part('day')}`;
  const offset =
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(`${dateString}T12:00:00Z`))
      .find((x) => x.type === 'timeZoneName')
      ?.value.replace('GMT', '') || '+00:00';
  const start = new Date(`${dateString}T00:00:00${offset}`);
  return { date: dateString, start, end: new Date(start.getTime() + 86400000) };
}
