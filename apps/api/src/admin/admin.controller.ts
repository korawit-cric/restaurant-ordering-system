import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Req,
  UseGuards,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuthRequest, MemberGuard, requireRole } from '../security/auth';
import { parse } from '../orders/rules';
const name = z.string().trim().min(1).max(100);
const category = z
  .object({
    name,
    sortOrder: z.number().int().min(0).max(9999).default(0),
    active: z.boolean().default(true),
  })
  .strict();
const product = z
  .object({
    name,
    categoryId: z.string().uuid(),
    price: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
    description: z.string().max(500).nullable().optional(),
    imageUrl: z
      .string()
      .url()
      .max(2000)
      .refine((v) => v.startsWith('https://'), 'Use HTTPS')
      .nullable()
      .optional(),
    active: z.boolean().default(true),
    available: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .strict();
@Controller('admin')
@UseGuards(MemberGuard)
export class AdminController {
  constructor(private readonly db: PrismaService) {}
  private scope(req: AuthRequest) {
    return { tenantId: req.tenantId, branchId: req.branchId };
  }
  private manage(req: AuthRequest) {
    requireRole(req, ['OWNER', 'MANAGER']);
  }
  @Get('categories') categories(@Req() req: AuthRequest) {
    return this.db.client.menuCategory.findMany({
      where: this.scope(req),
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }
  @Post('categories') async createCategory(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    this.manage(req);
    const menu = await this.db.client.menu.findFirst({
      where: { ...this.scope(req), active: true },
    });
    if (!menu) throw new ConflictException('No active menu');
    return this.db.client.menuCategory.create({
      data: { ...parse(category, body), ...this.scope(req), menuId: menu.id },
    });
  }
  @Patch('categories/:id') async updateCategory(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.manage(req);
    const r = await this.db.client.menuCategory.updateMany({
      where: { id, ...this.scope(req) },
      data: parse(category.partial(), body),
    });
    if (!r.count) throw new NotFoundException();
    return this.db.client.menuCategory.findUnique({ where: { id } });
  }
  @Post('categories/:id/archive') archiveCategory(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    this.manage(req);
    return this.updateCategory(req, id, { active: false });
  }
  @Get('products') products(@Req() req: AuthRequest) {
    return this.db.client.product.findMany({
      where: this.scope(req),
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }
  @Post('products') async createProduct(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    this.manage(req);
    const data = parse(product, body);
    const c = await this.db.client.menuCategory.findFirst({
      where: { id: data.categoryId, ...this.scope(req) },
    });
    if (!c) throw new NotFoundException('Category not found');
    return this.db.client.product.create({
      data: { ...data, ...this.scope(req), menuId: c.menuId },
    });
  }
  @Patch('products/:id') async updateProduct(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.manage(req);
    const data = parse(product.partial(), body);
    if (data.categoryId) {
      const p = await this.db.client.product.findFirst({
        where: { id, ...this.scope(req) },
      });
      if (!p) throw new NotFoundException();
      const c = await this.db.client.menuCategory.findFirst({
        where: { id: data.categoryId, ...this.scope(req) },
      });
      if (!c) throw new NotFoundException('Category not found');
      if (p.menuId !== c.menuId)
        throw new ConflictException('Category belongs to another menu');
    }
    const r = await this.db.client.product.updateMany({
      where: { id, ...this.scope(req) },
      data,
    });
    if (!r.count) throw new NotFoundException();
    return this.db.client.product.findUnique({ where: { id } });
  }
  @Patch('products/:id/availability') async availability(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { available } = parse(
      z.object({ available: z.boolean() }).strict(),
      body,
    );
    const r = await this.db.client.product.updateMany({
      where: { id, ...this.scope(req) },
      data: { available },
    });
    if (!r.count) throw new NotFoundException();
    return this.db.client.product.findUnique({ where: { id } });
  }
  @Post('products/:id/archive') archiveProduct(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    this.manage(req);
    return this.updateProduct(req, id, { active: false });
  }
}
