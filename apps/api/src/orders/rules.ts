import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, OrderStatus } from '@repo/prisma';
import { z } from 'zod';
export const createOrderSchema = z
  .object({
    requestKey: z.string().uuid(),
    method: z.enum(['CASH', 'QR']),
    items: z
      .array(
        z
          .object({
            menuItemId: z.string().min(1).max(100),
            quantity: z.number().int().min(1).max(30),
            expectedPrice: z.string().regex(/^\d{1,8}\.\d{2}$/),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine(
    (b) => new Set(b.items.map((i) => i.menuItemId)).size === b.items.length,
    'Duplicate menu items',
  );
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  return result.data;
}
export function snapshot(
  items: {
    id: string;
    name: string;
    price: Prisma.Decimal;
    active: boolean;
    available: boolean;
    category: { active: boolean };
  }[],
  input: z.infer<typeof createOrderSchema>['items'],
) {
  const lines = input.map((line) => {
    const item = items.find((x) => x.id === line.menuItemId);
    if (!item || !item.active || !item.available || !item.category.active)
      throw new ConflictException(
        'An item is no longer available. Review your menu.',
      );
    if (!item.price.equals(line.expectedPrice))
      throw new ConflictException(
        `${item.name} has a new price. Review your menu and submit again.`,
      );
    return {
      menuItemId: item.id,
      name: item.name,
      unitPrice: item.price,
      quantity: line.quantity,
      lineTotal: item.price.mul(line.quantity),
    };
  });
  return {
    lines,
    total: lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      new Prisma.Decimal(0),
    ),
  };
}
export function allowedTransition(from: OrderStatus, to: OrderStatus) {
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    NEW: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['SERVED', 'CANCELLED'],
    SERVED: [],
    CANCELLED: [],
  };
  return from === to || allowed[from].includes(to);
}
export function bangkokDay(date = new Date()) {
  const dateString = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const start = new Date(`${dateString}T00:00:00+07:00`);
  return { date: dateString, start, end: new Date(start.getTime() + 86400000) };
}
