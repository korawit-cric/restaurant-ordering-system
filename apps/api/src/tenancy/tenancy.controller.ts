import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../security/password';
import { Prisma } from '@repo/prisma';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuthRequest, MemberGuard, requireRole } from '../security/auth';
import { parse } from '../orders/rules';
import { applyPreset, presetSchema, validateWorkflow } from './presets';
const name = z.string().trim().min(1).max(100);
const point = z
  .object({
    name,
    description: z.string().trim().max(240).nullable().optional(),
    type: z
      .enum(['TABLE', 'BAR_SEAT', 'ZONE', 'COUNTER', 'PICKUP', 'OTHER'])
      .default('TABLE'),
  })
  .strict();
const setting = z
  .object({
    qrMode: z.enum(['PERMANENT', 'SESSION']),
    sessionMode: z.enum(['SINGLE_ORDER', 'OPEN_SESSION']),
    paymentMode: z.enum(['PER_ORDER', 'AT_CHECKOUT', 'STAFF_MANAGED']),
    fulfillmentMode: z.enum(['SERVE_TO_LOCATION', 'PICKUP']),
    promptpayId: z
      .string()
      .regex(/^(0\d{9}|\d{13}|\d{15})$/)
      .nullable()
      .optional(),
  })
  .strict();
@Controller('restaurant')
@UseGuards(MemberGuard)
export class TenancyController {
  constructor(private readonly db: PrismaService) {}
  @Get('branch') async branch(@Req() req: AuthRequest) {
    return this.db.client.branch.findFirst({
      where: { id: req.branchId, tenantId: req.tenantId },
      include: {
        tenant: { include: { subscription: { include: { plan: true } } } },
        settings: true,
      },
    });
  }
  @Get('branches') async branches(@Req() req: AuthRequest) {
    return this.db.client.branch.findMany({
      where: {
        tenantId: req.tenantId,
        members: { some: { userId: req.user.id, active: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
  @Post('branches') async createBranch(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER']);
    const data = parse(
      z
        .object({
          name,
          slug: z
            .string()
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
            .max(50),
          preset: presetSchema,
          timezone: z.string().max(80).default('Asia/Bangkok'),
        })
        .strict(),
      body,
    );
    try {
      new Intl.DateTimeFormat('en', { timeZone: data.timezone });
    } catch {
      throw new ConflictException('Invalid timezone');
    }
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${req.tenantId} FOR UPDATE`;
      const sub = await tx.subscription.findUnique({
        where: { tenantId: req.tenantId },
        include: { plan: true },
      });
      if (
        !sub ||
        !['TRIAL', 'ACTIVE'].includes(sub.status) ||
        (sub.status === 'TRIAL' &&
          sub.trialEndsAt &&
          sub.trialEndsAt < new Date())
      )
        throw new ConflictException('Subscription is not active');
      const count = await tx.branch.count({
        where: { tenantId: req.tenantId, status: 'ACTIVE' },
      });
      if (count >= sub.plan.branchLimit)
        throw new ConflictException('Your plan branch limit has been reached');
      const branch = await tx.branch.create({
        data: {
          tenantId: req.tenantId,
          name: data.name,
          slug: data.slug,
          timezone: data.timezone,
        },
      });
      await tx.branchSettings.create({
        data: {
          tenantId: req.tenantId,
          branchId: branch.id,
          ...applyPreset(data.preset),
        },
      });
      await tx.menu.create({
        data: {
          tenantId: req.tenantId,
          branchId: branch.id,
          name: 'Main menu',
        },
      });
      await tx.branchUser.create({
        data: {
          tenantId: req.tenantId,
          branchId: branch.id,
          userId: req.user.id,
          role: 'OWNER',
        },
      });
      return branch;
    });
  }
  @Patch('branch') async updateBranch(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER', 'MANAGER']);
    const data = parse(
      z
        .object({
          name: name.optional(),
          address: z.string().max(300).nullable().optional(),
          timezone: z.string().max(80).optional(),
        })
        .strict(),
      body,
    );
    if (data.timezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: data.timezone });
      } catch {
        throw new ConflictException('Invalid timezone');
      }
    }
    return this.db.client.branch.update({
      where: { tenantId_id: { tenantId: req.tenantId, id: req.branchId } },
      data,
    });
  }
  @Patch('settings') async settings(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER', 'MANAGER']);
    const data = parse(setting, body);
    validateWorkflow(data);
    const current = await this.db.client.branchSettings.findUniqueOrThrow({
      where: {
        tenantId_branchId: { tenantId: req.tenantId, branchId: req.branchId },
      },
    });
    if (
      data.qrMode !== current.qrMode ||
      data.sessionMode !== current.sessionMode ||
      data.paymentMode !== current.paymentMode ||
      data.fulfillmentMode !== current.fulfillmentMode
    ) {
      const open = await this.db.client.orderSession.count({
        where: {
          tenantId: req.tenantId,
          branchId: req.branchId,
          status: 'OPEN',
        },
      });
      if (open)
        throw new ConflictException(
          'Close active sessions before changing workflow',
        );
    }
    return this.db.client.branchSettings.update({
      where: {
        tenantId_branchId: { tenantId: req.tenantId, branchId: req.branchId },
      },
      data: { ...data, preset: 'CUSTOM' },
    });
  }
  @Post('preset') async preset(@Req() req: AuthRequest, @Body() body: unknown) {
    requireRole(req, ['OWNER', 'MANAGER']);
    const { preset } = parse(z.object({ preset: presetSchema }).strict(), body);
    const sessions = await this.db.client.orderSession.count({
      where: { tenantId: req.tenantId, branchId: req.branchId, status: 'OPEN' },
    });
    if (sessions)
      throw new ConflictException(
        'Close active sessions before changing workflow',
      );
    return this.db.client.branchSettings.update({
      where: {
        tenantId_branchId: { tenantId: req.tenantId, branchId: req.branchId },
      },
      data: applyPreset(preset),
    });
  }
  @Get('onboarding') async onboarding(@Req() req: AuthRequest) {
    const [branch, categories, products, points, orders] = await Promise.all([
      this.db.client.branch.findFirst({
        where: { id: req.branchId, tenantId: req.tenantId },
        include: { settings: true },
      }),
      this.db.client.menuCategory.count({
        where: { tenantId: req.tenantId, branchId: req.branchId, active: true },
      }),
      this.db.client.product.count({
        where: { tenantId: req.tenantId, branchId: req.branchId, active: true },
      }),
      this.db.client.servicePoint.count({
        where: { tenantId: req.tenantId, branchId: req.branchId, active: true },
      }),
      this.db.client.order.count({
        where: { tenantId: req.tenantId, branchId: req.branchId },
      }),
    ]);
    return {
      branch,
      steps: [
        { key: 'restaurant', done: !!branch },
        { key: 'menu', done: categories > 0 && products > 0 },
        { key: 'servicePoints', done: points > 0 },
        { key: 'qr', done: points > 0 },
        { key: 'firstOrder', done: orders > 0 },
      ],
    };
  }
  @Get('staff') async staff(@Req() req: AuthRequest) {
    requireRole(req, ['OWNER', 'MANAGER']);
    const members = await this.db.client.branchUser.findMany({
      where: { tenantId: req.tenantId, branchId: req.branchId },
      include: { user: { select: { id: true, email: true, active: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      role: m.role,
      active: m.active,
    }));
  }
  @Post('staff') async addStaff(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER']);
    const data = parse(
      z
        .object({
          email: z
            .string()
            .email()
            .transform((v) => v.toLowerCase()),
          password: z.string().min(12).max(256),
          role: z.enum(['MANAGER', 'STAFF']),
        })
        .strict(),
      body,
    );
    if (await this.db.client.user.findUnique({ where: { email: data.email } }))
      throw new ConflictException(
        'This email already has an account. An invitation flow is not available yet.',
      );
    return this.db.client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: data.email, passwordHash: hashPassword(data.password) },
      });
      const membership = await tx.branchUser.create({
        data: {
          tenantId: req.tenantId,
          branchId: req.branchId,
          userId: user.id,
          role: data.role,
        },
      });
      return {
        id: membership.id,
        email: user.email,
        role: membership.role,
        active: true,
      };
    });
  }
  @Patch('staff/:id') async updateStaff(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER']);
    const data = parse(
      z
        .object({
          role: z.enum(['MANAGER', 'STAFF']).optional(),
          active: z.boolean().optional(),
        })
        .strict(),
      body,
    );
    const existing = await this.db.client.branchUser.findFirst({
      where: { id, tenantId: req.tenantId, branchId: req.branchId },
    });
    if (!existing || existing.role === 'OWNER') throw new NotFoundException();
    await this.db.client.branchUser.updateMany({
      where: { id, tenantId: req.tenantId, branchId: req.branchId },
      data,
    });
    return this.db.client.branchUser.findUnique({ where: { id } });
  }
  @Get('service-points') points(@Req() req: AuthRequest) {
    return this.db.client.servicePoint.findMany({
      where: { tenantId: req.tenantId, branchId: req.branchId },
      orderBy: { name: 'asc' },
    });
  }
  @Post('service-points') createPoint(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER', 'MANAGER']);
    const data = parse(point, body);
    return this.db.client.servicePoint.create({
      data: { ...data, tenantId: req.tenantId, branchId: req.branchId },
    });
  }
  @Patch('service-points/:id') async updatePoint(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER', 'MANAGER']);
    const data = parse(
      point.partial().extend({ active: z.boolean().optional() }),
      body,
    );
    const result = await this.db.client.servicePoint.updateMany({
      where: { id, tenantId: req.tenantId, branchId: req.branchId },
      data,
    });
    if (!result.count) throw new NotFoundException();
    return this.db.client.servicePoint.findUnique({ where: { id } });
  }
  @Post('service-points/:id/rotate') async rotate(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    requireRole(req, ['OWNER', 'MANAGER']);
    const result = await this.db.client.servicePoint.updateMany({
      where: { id, tenantId: req.tenantId, branchId: req.branchId },
      data: { qrToken: randomUUID() },
    });
    if (!result.count) throw new NotFoundException();
    return this.db.client.servicePoint.findUnique({ where: { id } });
  }
  @Get('sessions') sessions(@Req() req: AuthRequest) {
    return this.db.client.orderSession.findMany({
      where: {
        tenantId: req.tenantId,
        branchId: req.branchId,
        OR: [
          { status: 'OPEN' },
          {
            status: 'CLOSED',
            paymentMethod: { not: null },
            paymentStatus: 'PENDING',
          },
        ],
      },
      include: { servicePoint: true, _count: { select: { orders: true } } },
      orderBy: { openedAt: 'desc' },
    });
  }
  @Post('sessions') async open(@Req() req: AuthRequest, @Body() body: unknown) {
    const data = parse(
      z
        .object({
          servicePointId: z.string().uuid().nullable().optional(),
          label: name.optional(),
          description: z.string().max(240).nullable().optional(),
        })
        .strict(),
      body,
    );
    const branch = await this.db.client.branch.findFirst({
      where: { id: req.branchId, tenantId: req.tenantId },
      include: { settings: true },
    });
    if (branch?.settings?.qrMode !== 'SESSION')
      throw new ConflictException('This branch uses permanent QR codes');
    if (data.servicePointId) {
      const p = await this.db.client.servicePoint.findFirst({
        where: {
          id: data.servicePointId,
          tenantId: req.tenantId,
          branchId: req.branchId,
          active: true,
        },
      });
      if (!p) throw new NotFoundException('Service point unavailable');
    }
    return this.db.client.orderSession.create({
      data: {
        tenantId: req.tenantId,
        branchId: req.branchId,
        servicePointId: data.servicePointId,
        label: data.label,
        description: data.description,
      },
    });
  }
  @Patch('sessions/:id') async updateSession(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          servicePointId: z.string().uuid().nullable(),
          label: name.nullable(),
          description: z.string().max(240).nullable(),
        })
        .partial()
        .strict(),
      body,
    );
    if (data.servicePointId) {
      const p = await this.db.client.servicePoint.findFirst({
        where: {
          id: data.servicePointId,
          tenantId: req.tenantId,
          branchId: req.branchId,
          active: true,
        },
      });
      if (!p) throw new NotFoundException('Service point unavailable');
    }
    const result = await this.db.client.orderSession.updateMany({
      where: {
        id,
        tenantId: req.tenantId,
        branchId: req.branchId,
        status: 'OPEN',
      },
      data,
    });
    if (!result.count) throw new NotFoundException();
    return this.db.client.orderSession.findUnique({ where: { id } });
  }
  @Post('sessions/:id/close') async close(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { method } = parse(
      z
        .object({ method: z.enum(['CASH', 'PROMPTPAY']).nullable().optional() })
        .strict(),
      body,
    );
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OrderSession" WHERE id = ${id} AND "tenantId" = ${req.tenantId} AND "branchId" = ${req.branchId} FOR UPDATE`;
      const session = await tx.orderSession.findFirst({
        where: {
          id,
          tenantId: req.tenantId,
          branchId: req.branchId,
          status: 'OPEN',
        },
      });
      if (!session) throw new NotFoundException('Open session not found');
      const settings = await tx.branchSettings.findUniqueOrThrow({
        where: {
          tenantId_branchId: { tenantId: req.tenantId, branchId: req.branchId },
        },
      });
      if (settings.paymentMode === 'AT_CHECKOUT' && !method)
        throw new ConflictException('Choose payment at checkout');
      if (method === 'PROMPTPAY' && !settings.promptpayId)
        throw new ConflictException('Configure PromptPay before checkout');
      const orders = await tx.order.findMany({
        where: {
          tenantId: req.tenantId,
          branchId: req.branchId,
          sessionId: id,
          status: { not: 'CANCELLED' },
        },
        select: { total: true },
      });
      const subtotal = orders.reduce(
        (v, o) => v.add(o.total),
        new Prisma.Decimal(0),
      );
      return tx.orderSession.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          subtotal,
          paymentMethod: settings.paymentMode === 'AT_CHECKOUT' ? method : null,
        },
      });
    });
  }
  @Post('sessions/:id/payment') async confirmSession(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER', 'MANAGER', 'STAFF']);
    const data = parse(
      z
        .object({
          reference: z.string().trim().min(2).max(100).optional(),
          note: z.string().trim().max(240).optional(),
        })
        .strict(),
      body,
    );
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OrderSession" WHERE id = ${id} AND "tenantId" = ${req.tenantId} AND "branchId" = ${req.branchId} FOR UPDATE`;
      const session = await tx.orderSession.findFirst({
        where: {
          id,
          tenantId: req.tenantId,
          branchId: req.branchId,
          status: 'CLOSED',
        },
      });
      if (!session || !session.paymentMethod)
        throw new NotFoundException('Checkout not found');
      if (session.paymentStatus === 'PAID') return session;
      if (session.paymentMethod === 'PROMPTPAY' && !data.reference)
        throw new BadRequestException(
          'Enter the bank transaction reference after checking the receiving account',
        );
      const updated = await tx.orderSession.update({
        where: { id },
        data: {
          paymentStatus: 'PAID',
          paidAt: new Date(),
          confirmedBy: req.user.id,
          paymentReference: data.reference || null,
          paymentNote: data.note || null,
        },
      });
      await tx.order.updateMany({
        where: {
          tenantId: req.tenantId,
          branchId: req.branchId,
          sessionId: id,
          status: { not: 'CANCELLED' },
        },
        data: {
          paymentStatus: 'PAID',
          paidAt: new Date(),
          confirmedBy: req.user.id,
          paymentReference: data.reference || null,
          paymentNote: data.note || null,
        },
      });
      return updated;
    });
  }
}
