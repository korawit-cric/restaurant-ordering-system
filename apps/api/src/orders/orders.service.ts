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
  branchDay,
} from './rules';
import type { AuthRequest } from '../security/auth';
const include = {
  items: true,
  session: {
    select: { id: true, label: true, description: true, status: true },
  },
  servicePoint: { select: { id: true, name: true, type: true } },
} as const;
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: OrderEvents,
  ) {}
  async target(kind: 'q' | 's', token: string) {
    if (kind === 'q') {
      const point = await this.db.client.servicePoint.findUnique({
        where: { qrToken: token },
        include: { branch: { include: { tenant: true, settings: true } } },
      });
      if (
        !point?.active ||
        point.branch.status !== 'ACTIVE' ||
        point.branch.tenant.status !== 'ACTIVE' ||
        point.branch.settings?.qrMode !== 'PERMANENT'
      )
        throw new NotFoundException(
          'This QR is inactive. Ask staff for a new one.',
        );
      return {
        tenantId: point.tenantId,
        branchId: point.branchId,
        point,
        session: null,
        branch: point.branch,
      };
    }
    const session = await this.db.client.orderSession.findUnique({
      where: { token },
      include: {
        servicePoint: true,
        branch: { include: { tenant: true, settings: true } },
      },
    });
    if (
      !session ||
      session.branch.status !== 'ACTIVE' ||
      session.branch.tenant.status !== 'ACTIVE' ||
      session.branch.settings?.qrMode !== 'SESSION'
    )
      throw new NotFoundException(
        'This QR is invalid. Ask staff for a new one.',
      );
    return {
      tenantId: session.tenantId,
      branchId: session.branchId,
      point: session.servicePoint,
      session,
      branch: session.branch,
    };
  }
  async menu(kind: 'q' | 's', token: string) {
    const t = await this.target(kind, token);
    if (t.session?.status === 'CLOSED')
      throw new ConflictException(
        'This session has closed. Ask staff for a new QR.',
      );
    const categories = await this.db.client.menuCategory.findMany({
      where: {
        tenantId: t.tenantId,
        branchId: t.branchId,
        active: true,
        menu: { active: true },
      },
      include: {
        products: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return {
      branch: { id: t.branch.id, name: t.branch.name },
      servicePoint: t.point
        ? {
            id: t.point.id,
            name: t.point.name,
            description: t.point.description,
          }
        : null,
      session: t.session
        ? {
            id: t.session.id,
            label: t.session.label,
            description: t.session.description,
            status: t.session.status,
          }
        : null,
      settings: t.branch.settings,
      categories,
    };
  }
  async create(kind: 'q' | 's', token: string, body: unknown) {
    const data = parse(createOrderSchema, body);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          kind,
          token,
          method: data.method || null,
          items: [...data.items].sort((a, b) =>
            a.productId.localeCompare(b.productId),
          ),
        }),
      )
      .digest('hex');
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await this.db.client.$transaction(
          async (tx) => {
            // Resolve and lock the destination so a session close or QR rotation cannot race submission.
            const t = await this.targetInTransaction(tx, kind, token);
            const existing = await tx.order.findUnique({
              where: {
                tenantId_requestKey: {
                  tenantId: t.tenantId,
                  requestKey: data.requestKey,
                },
              },
              include,
            });
            if (existing) {
              if (existing.requestHash !== requestHash)
                throw new ConflictException(
                  'This request key belongs to a different order',
                );
              return { order: existing, created: false };
            }
            if (t.session?.status === 'CLOSED')
              throw new ConflictException('This session is closed');
            const settings = await tx.branchSettings.findUniqueOrThrow({
              where: {
                tenantId_branchId: {
                  tenantId: t.tenantId,
                  branchId: t.branchId,
                },
              },
            });
            if (settings.paymentMode === 'PER_ORDER' && !data.method)
              throw new BadRequestException('Choose a payment method');
            if (settings.paymentMode !== 'PER_ORDER' && data.method)
              throw new BadRequestException(
                'Payment is handled at checkout or by staff',
              );
            if (data.method === 'PROMPTPAY' && !settings.promptpayId)
              throw new BadRequestException(
                'PromptPay is not configured. Choose cash.',
              );
            const productIds = data.items.map((x) => x.productId).sort();
            await tx.$queryRaw`SELECT id FROM "Product" WHERE "tenantId" = ${t.tenantId} AND "branchId" = ${t.branchId} AND id IN (${Prisma.join(productIds)}) FOR SHARE`;
            const products = await tx.product.findMany({
              where: {
                tenantId: t.tenantId,
                branchId: t.branchId,
                id: { in: productIds },
              },
              include: { category: true, menu: true },
            });
            const { lines, total } = snapshot(products, data.items);
            let session = t.session;
            if (kind === 'q' && settings.sessionMode === 'OPEN_SESSION') {
              session = await tx.orderSession.findFirst({
                where: {
                  tenantId: t.tenantId,
                  branchId: t.branchId,
                  servicePointId: t.point?.id,
                  status: 'OPEN',
                },
              });
              if (!session)
                session = await tx.orderSession.create({
                  data: {
                    tenantId: t.tenantId,
                    branchId: t.branchId,
                    servicePointId: t.point?.id,
                    label: t.point?.name,
                  },
                });
            }
            const branch = await tx.branch.update({
              where: { tenantId_id: { tenantId: t.tenantId, id: t.branchId } },
              data: { nextOrderNumber: { increment: 1 } },
              select: { nextOrderNumber: true },
            });
            const order = await tx.order.create({
              data: {
                tenantId: t.tenantId,
                branchId: t.branchId,
                sessionId: session?.id,
                servicePointId: t.point?.id,
                locationSnapshot: session?.label || t.point?.name || null,
                orderNumber: branch.nextOrderNumber - 1,
                requestKey: data.requestKey,
                requestHash,
                paymentMethod:
                  settings.paymentMode === 'PER_ORDER' ? data.method : null,
                paymentStatus: 'PENDING',
                subtotal: total,
                total,
              },
              select: { id: true },
            });
            await tx.orderItem.createMany({
              data: lines.map((x) => ({
                ...x,
                tenantId: t.tenantId,
                branchId: t.branchId,
                orderId: order.id,
              })),
            });
            const complete = await tx.order.findUniqueOrThrow({
              where: { id: order.id },
              include,
            });
            if (session && settings.sessionMode === 'SINGLE_ORDER')
              await tx.orderSession.update({
                where: { id: session.id },
                data: { status: 'CLOSED', closedAt: new Date() },
              });
            return { order: complete, created: true };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (result.created)
          this.events.publish(result.order.branchId, 'new', result.order.id);
        return this.safe(result.order);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(e.code) &&
          attempt < 4
        )
          continue;
        throw e;
      }
    }
    throw new ConflictException('Could not complete order. Please retry.');
  }
  private async targetInTransaction(
    tx: Prisma.TransactionClient,
    kind: 'q' | 's',
    token: string,
  ) {
    if (kind === 'q') {
      await tx.$queryRaw`SELECT id FROM "ServicePoint" WHERE "qrToken" = ${token} FOR UPDATE`;
      const point = await tx.servicePoint.findUnique({
        where: { qrToken: token },
        include: { branch: { include: { tenant: true, settings: true } } },
      });
      if (
        !point?.active ||
        point.branch.status !== 'ACTIVE' ||
        point.branch.tenant.status !== 'ACTIVE' ||
        point.branch.settings?.qrMode !== 'PERMANENT'
      )
        throw new NotFoundException('QR inactive');
      return {
        tenantId: point.tenantId,
        branchId: point.branchId,
        point,
        session: null as Awaited<ReturnType<typeof tx.orderSession.findUnique>>,
      };
    }
    await tx.$queryRaw`SELECT id FROM "OrderSession" WHERE token = ${token} FOR UPDATE`;
    const session = await tx.orderSession.findUnique({
      where: { token },
      include: {
        servicePoint: true,
        branch: { include: { tenant: true, settings: true } },
      },
    });
    if (
      !session ||
      session.branch.status !== 'ACTIVE' ||
      session.branch.tenant.status !== 'ACTIVE' ||
      session.branch.settings?.qrMode !== 'SESSION'
    )
      throw new NotFoundException('Session QR inactive');
    if (session.servicePoint && !session.servicePoint.active)
      throw new ConflictException('Service point is inactive');
    return {
      tenantId: session.tenantId,
      branchId: session.branchId,
      point: session.servicePoint,
      session,
    };
  }
  safe<T extends { requestHash: string; requestKey: string }>(order: T) {
    const { requestHash: _hash, requestKey: _key, ...safe } = order;
    return safe;
  }
  async customerOrder(kind: 'q' | 's', token: string, id: string) {
    const t = await this.target(kind, token);
    const order = await this.db.client.order.findFirst({
      where: {
        id,
        tenantId: t.tenantId,
        branchId: t.branchId,
        ...(kind === 's'
          ? { sessionId: t.session?.id }
          : { servicePointId: t.point?.id }),
      },
      include,
    });
    if (!order) throw new NotFoundException();
    return this.safe(order);
  }
  async list(req: AuthRequest, history = false, cursor?: string) {
    const where = {
      tenantId: req.tenantId,
      branchId: req.branchId,
      ...(history
        ? {}
        : {
            OR: [
              {
                status: {
                  in: [
                    'NEW',
                    'ACCEPTED',
                    'PREPARING',
                    'READY',
                  ] as OrderStatus[],
                },
              },
              {
                paymentStatus: 'PENDING' as const,
                status: 'COMPLETED' as const,
              },
            ],
          }),
    };
    const orders = await this.db.client.order.findMany({
      where,
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: history ? 51 : 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const more = history && orders.length > 50;
    return {
      orders: (more ? orders.slice(0, 50) : orders).map((o) => this.safe(o)),
      nextCursor: more ? orders[49]!.id : null,
    };
  }
  async detail(req: AuthRequest, id: string) {
    const order = await this.db.client.order.findFirst({
      where: { id, tenantId: req.tenantId, branchId: req.branchId },
      include,
    });
    if (!order) throw new NotFoundException();
    return this.safe(order);
  }
  async status(req: AuthRequest, id: string, status: OrderStatus) {
    const order = await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} AND "tenantId" = ${req.tenantId} AND "branchId" = ${req.branchId} FOR UPDATE`;
      const current = await tx.order.findFirst({
        where: { id, tenantId: req.tenantId, branchId: req.branchId },
      });
      if (!current) throw new NotFoundException();
      if (!allowedTransition(current.status, status))
        throw new ConflictException('Invalid order transition');
      if (status === 'CANCELLED' && current.paymentStatus === 'PAID')
        throw new ConflictException(
          'Paid orders require an external refund before cancellation',
        );
      if (status === 'CANCELLED' && current.sessionId) {
        const session = await tx.orderSession.findUnique({
          where: { id: current.sessionId },
        });
        if (session?.status === 'CLOSED')
          throw new ConflictException(
            'Orders in a closed session cannot be cancelled',
          );
      }
      return tx.order.update({
        where: { id },
        data: {
          status,
          ...(status === 'CANCELLED'
            ? { paymentStatus: 'CANCELLED' as const }
            : {}),
        },
        include,
      });
    });
    this.events.publish(req.branchId, 'changed', id);
    return this.safe(order);
  }
  async confirmPayment(req: AuthRequest, id: string) {
    const order = await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} AND "tenantId" = ${req.tenantId} AND "branchId" = ${req.branchId} FOR UPDATE`;
      const current = await tx.order.findFirst({
        where: { id, tenantId: req.tenantId, branchId: req.branchId },
      });
      if (!current) throw new NotFoundException();
      if (
        current.status === 'CANCELLED' ||
        current.paymentStatus === 'FAILED' ||
        current.paymentStatus === 'CANCELLED' ||
        !current.paymentMethod
      )
        throw new ConflictException('This order payment cannot be confirmed');
      if (current.paymentStatus === 'PAID') return current;
      return tx.order.update({
        where: { id },
        data: {
          paymentStatus: 'PAID',
          paidAt: new Date(),
          confirmedBy: req.user.id,
        },
      });
    });
    this.events.publish(req.branchId, 'changed', id);
    return this.safe(order);
  }
  async summary(req: AuthRequest) {
    const branch = await this.db.client.branch.findFirstOrThrow({
      where: { id: req.branchId, tenantId: req.tenantId },
    });
    const day = branchDay(branch.timezone);
    const scope = { tenantId: req.tenantId, branchId: req.branchId };
    const [orderCount, paidOrders, paidSessions, top] = await Promise.all([
      this.db.client.order.count({
        where: {
          ...scope,
          createdAt: { gte: day.start, lt: day.end },
          status: { not: 'CANCELLED' },
        },
      }),
      this.db.client.order.groupBy({
        by: ['paymentMethod'],
        where: {
          ...scope,
          paymentStatus: 'PAID',
          paymentMethod: { not: null },
          paidAt: { gte: day.start, lt: day.end },
        },
        _sum: { total: true },
      }),
      this.db.client.orderSession.groupBy({
        by: ['paymentMethod'],
        where: {
          ...scope,
          paymentStatus: 'PAID',
          paymentMethod: { not: null },
          paidAt: { gte: day.start, lt: day.end },
        },
        _sum: { subtotal: true },
      }),
      this.db.client.orderItem.groupBy({
        by: ['productId', 'productNameSnapshot'],
        where: {
          ...scope,
          order: {
            createdAt: { gte: day.start, lt: day.end },
            status: { not: 'CANCELLED' },
          },
        },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
    ]);
    const amount = (method: 'CASH' | 'PROMPTPAY') =>
      (
        paidOrders.find((x) => x.paymentMethod === method)?._sum.total ||
        new Prisma.Decimal(0)
      ).add(
        paidSessions.find((x) => x.paymentMethod === method)?._sum.subtotal ||
          new Prisma.Decimal(0),
      );
    const cash = amount('CASH');
    const promptpay = amount('PROMPTPAY');
    return {
      date: day.date,
      orderCount,
      cash,
      promptpay,
      total: cash.add(promptpay),
      topProducts: top,
    };
  }
  async daily(req: AuthRequest, days = 7) {
    const branch = await this.db.client.branch.findFirstOrThrow({
      where: { id: req.branchId, tenantId: req.tenantId },
    });
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const scope = { tenantId: req.tenantId, branchId: req.branchId };
    const [orders, sessions] = await Promise.all([
      this.db.client.order.findMany({
        where: {
          ...scope,
          paymentStatus: 'PAID',
          paymentMethod: { not: null },
          paidAt: { gte: start },
        },
        select: { paidAt: true, total: true, paymentMethod: true },
      }),
      this.db.client.orderSession.findMany({
        where: {
          ...scope,
          paymentStatus: 'PAID',
          paymentMethod: { not: null },
          paidAt: { gte: start },
        },
        select: { paidAt: true, subtotal: true, paymentMethod: true },
      }),
    ]);
    const rows = new Map<
      string,
      {
        date: string;
        cash: Prisma.Decimal;
        promptpay: Prisma.Decimal;
        total: Prisma.Decimal;
      }
    >();
    for (const payment of [
      ...orders.map((o) => ({
        paidAt: o.paidAt,
        amount: o.total,
        method: o.paymentMethod,
      })),
      ...sessions.map((s) => ({
        paidAt: s.paidAt,
        amount: s.subtotal,
        method: s.paymentMethod,
      })),
    ]) {
      if (!payment.paidAt || !payment.method) continue;
      const date = branchDay(branch.timezone, payment.paidAt).date;
      const row = rows.get(date) || {
        date,
        cash: new Prisma.Decimal(0),
        promptpay: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
      };
      if (payment.method === 'CASH') row.cash = row.cash.add(payment.amount);
      else row.promptpay = row.promptpay.add(payment.amount);
      row.total = row.total.add(payment.amount);
      rows.set(date, row);
    }
    return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
  }
}
