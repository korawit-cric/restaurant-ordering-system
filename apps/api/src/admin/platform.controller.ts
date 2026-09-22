import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { OperatorGuard } from '../security/auth';
import { parse } from '../orders/rules';
@Controller('platform')
@UseGuards(OperatorGuard)
export class PlatformController {
  constructor(private readonly db: PrismaService) {}
  @Get('tenants') tenants() {
    return this.db.client.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        _count: { select: { branches: true } },
        subscription: {
          select: {
            status: true,
            trialEndsAt: true,
            plan: { select: { id: true, name: true, branchLimit: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Patch('tenants/:id/subscription') async subscription(
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          planId: z.enum(['starter', 'standard']).optional(),
          status: z
            .enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED'])
            .optional(),
        })
        .strict(),
      body,
    );
    const tenant = await this.db.client.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException();
    return this.db.client.subscription.update({
      where: { tenantId: id },
      data,
    });
  }
}
