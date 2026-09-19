import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  Res,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Prisma } from '@repo/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard, AdminGuard } from '../security/auth';
import { parse } from '../orders/rules';
const name = z.string().trim().min(1).max(100);
const category = z
  .object({
    name,
    sortOrder: z.number().int().min(0).max(9999),
    active: z.boolean(),
  })
  .strict();
const menuItem = z
  .object({
    name,
    categoryId: z.string().min(1),
    price: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/),
    description: z.string().max(500).nullable(),
    imageUrl: z
      .string()
      .max(2000)
      .refine((v) => !v || /^https:\/\//.test(v), 'Use an HTTPS image URL')
      .nullable(),
    active: z.boolean(),
    available: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
  })
  .strict();
@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly db: PrismaService) {}
  @Get('categories') categories() {
    return this.db.client.menuCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }
  @Post('categories') createCategory(@Body() body: unknown) {
    return this.db.client.menuCategory.create({ data: parse(category, body) });
  }
  @Patch('categories/:id') updateCategory(
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.db.client.menuCategory.update({
      where: { id },
      data: parse(category.partial(), body),
    });
  }
  @Delete('categories/:id') archiveCategory(@Param('id') id: string) {
    return this.db.client.menuCategory.update({
      where: { id },
      data: { active: false },
    });
  }
  @Get('menu') menu() {
    return this.db.client.menuItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }
  @Post('menu') createMenu(@Body() body: unknown) {
    return this.db.client.menuItem.create({ data: parse(menuItem, body) });
  }
  @Patch('menu/:id') updateMenu(
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.db.client.menuItem.update({
      where: { id },
      data: parse(menuItem.partial(), body),
    });
  }
  @Delete('menu/:id') archiveMenu(@Param('id') id: string) {
    return this.db.client.menuItem.update({
      where: { id },
      data: { active: false },
    });
  }
  @Get('tables') tables() {
    return this.db.client.table.findMany({ orderBy: { name: 'asc' } });
  }
  @Post('tables') async createTable(@Body() body: unknown) {
    try {
      return await this.db.client.table.create({
        data: parse(z.object({ name }).strict(), body),
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('A table with this name already exists');
      throw e;
    }
  }
  @Patch('tables/:id') updateTable(
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.db.client.table.update({
      where: { id },
      data: parse(
        z
          .object({ name: name.optional(), active: z.boolean().optional() })
          .strict(),
        body,
      ),
    });
  }
  @Post('tables/:id/token') rotate(@Param('id') id: string) {
    return this.db.client.table.update({
      where: { id },
      data: { qrToken: randomUUID() },
    });
  }
  @Get('tables/:id/qr') async qr(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const table = await this.db.client.table.findUnique({ where: { id } });
    if (!table) throw new NotFoundException();
    const url = `${process.env.APP_ORIGIN || 'http://localhost:3010'}/t/${table.qrToken}`;
    const svg = await QRCode.toString(url, {
      type: 'svg',
      width: 480,
      margin: 4,
      errorCorrectionLevel: 'M',
    });
    res.type('image/svg+xml').send(svg);
  }
}
