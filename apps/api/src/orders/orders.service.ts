import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, OrderStatus } from '@repo/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { OrderEvents } from './events';
import {
  createOrderSchema,
  parse,
  snapshot,
  allowedTransition,
  bangkokDay,
} from './rules';
const include = { items: true, payment: true } as const;
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: OrderEvents,
  ) {}
  async table(token: string) {
    const table = await this.db.client.table.findUnique({
      where: { qrToken: token },
    });
    if (!table?.active)
      throw new NotFoundException(
        'This table QR is inactive or invalid. Please ask staff.',
      );
    return table;
  }
  async menu(token: string) {
    const table = await this.table(token);
    const categories = await this.db.client.menuCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        items: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });
    return {
      table: { id: table.id, name: table.name },
      categories,
      payment: {
        qrUrl: process.env.PROMPTPAY_QR_URL || null,
        recipient: process.env.PAYMENT_RECIPIENT || null,
      },
    };
  }
  async create(token: string, body: unknown) {
    const data = parse(createOrderSchema, body);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          token,
          method: data.method,
          items: [...data.items].sort((a, b) =>
            a.menuItemId.localeCompare(b.menuItemId),
          ),
        }),
      )
      .digest('hex');
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await this.db.client.$transaction(
          async (tx) => {
            const table = await tx.table.findUnique({
              where: { qrToken: token },
            });
            if (!table?.active)
              throw new NotFoundException(
                'This table QR is inactive or invalid.',
              );
            const existing = await tx.order.findUnique({
              where: { requestKey: data.requestKey },
              include,
            });
            if (existing) {
              if (
                existing.requestHash !== requestHash ||
                existing.tableId !== table.id
              )
                throw new ConflictException(
                  'This request key belongs to a different order.',
                );
              return { order: existing, created: false };
            }
            if (data.method === 'QR' && !process.env.PROMPTPAY_QR_URL)
              throw new BadRequestException(
                'QR payment is not configured. Choose cash.',
              );
            const menu = await tx.menuItem.findMany({
              where: { id: { in: data.items.map((i) => i.menuItemId) } },
              include: { category: true },
            });
            const { lines, total } = snapshot(menu, data.items);
            const order = await tx.order.create({
              data: {
                tableId: table.id,
                tableName: table.name,
                requestKey: data.requestKey,
                requestHash,
                total,
                items: { create: lines },
                payment: { create: { method: data.method, amount: total } },
              },
              include,
            });
            return { order, created: true };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (result.created) this.events.publish('new', result.order.id);
        return this.publicOrder(result.order);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(error.code) &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }
  publicOrder<T extends { requestHash: string; requestKey: string }>(order: T) {
    const { requestHash: _hash, requestKey: _key, ...safe } = order;
    return safe;
  }
  async customerOrder(token: string, id: string) {
    const table = await this.table(token);
    const order = await this.db.client.order.findFirst({
      where: { id, tableId: table.id },
      include,
    });
    if (!order) throw new NotFoundException('Order not found');
    const safe = this.publicOrder(order);
    return {
      ...safe,
      payment: safe.payment
        ? {
            method: safe.payment.method,
            status: safe.payment.status,
            amount: safe.payment.amount,
            paidAt: safe.payment.paidAt,
          }
        : null,
    };
  }
  async list(history = false, cursor?: string) {
    const orders = await this.db.client.order.findMany({
      where: history
        ? {}
        : {
            OR: [
              { status: { in: ['NEW', 'ACCEPTED', 'PREPARING'] } },
              { status: 'SERVED', payment: { status: 'PENDING' } },
            ],
          },
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(history
        ? { take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }
        : {}),
    });
    const hasMore = history && orders.length > 50;
    const page = hasMore ? orders.slice(0, 50) : orders;
    return {
      orders: page.map((o) => this.publicOrder(o)),
      nextCursor: hasMore ? page.at(-1)?.id : null,
    };
  }
  async detail(id: string) {
    const order = await this.db.client.order.findUnique({
      where: { id },
      include,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.publicOrder(order);
  }
  async status(id: string, status: OrderStatus) {
    const order = await this.db.client.$transaction(async (tx) => {
      // Lock the order for both fulfillment and payment updates, avoiding cancel/confirm races.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.order.findUnique({ where: { id }, include });
      if (!current) throw new NotFoundException('Order not found');
      if (!allowedTransition(current.status, status))
        throw new ConflictException(
          'Order state changed. Refresh and try again.',
        );
      if (status === 'CANCELLED' && current.payment?.status === 'PAID')
        throw new ConflictException(
          'Paid orders cannot be cancelled in this MVP. Ask the manager to arrange a refund outside the system.',
        );
      if (status === 'CANCELLED')
        await tx.payment.updateMany({
          where: { orderId: id, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
      return tx.order.update({ where: { id }, data: { status }, include });
    });
    this.events.publish('changed', id);
    return this.publicOrder(order);
  }
  async confirmPayment(id: string, userId: string) {
    const payment = await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id },
        include: { payment: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (
        order.status === 'CANCELLED' ||
        !order.payment ||
        ['CANCELLED', 'FAILED'].includes(order.payment.status)
      )
        throw new ConflictException('This payment cannot be confirmed');
      if (order.payment.status === 'PAID') return order.payment;
      return tx.payment.update({
        where: { orderId: id },
        data: { status: 'PAID', paidAt: new Date(), confirmedBy: userId },
      });
    });
    this.events.publish('changed', id);
    return payment;
  }
  async summary() {
    const day = bangkokDay();
    const [orderCount, paid] = await this.db.client.$transaction([
      this.db.client.order.count({
        where: {
          createdAt: { gte: day.start, lt: day.end },
          status: { not: 'CANCELLED' },
        },
      }),
      this.db.client.payment.groupBy({
        by: ['method'],
        orderBy: { method: 'asc' },
        where: { status: 'PAID', paidAt: { gte: day.start, lt: day.end } },
        _sum: { amount: true },
      }),
    ]);
    const cash =
      paid.find((p) => p.method === 'CASH')?._sum?.amount ||
      new Prisma.Decimal(0);
    const qr =
      paid.find((p) => p.method === 'QR')?._sum?.amount ||
      new Prisma.Decimal(0);
    return { date: day.date, orderCount, cash, qr, total: cash.add(qr) };
  }
}
