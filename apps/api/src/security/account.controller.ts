import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { parse } from '../orders/rules';
import { AuthRequest, MemberGuard, requireRole } from './auth';
import { hashPassword } from './password';
import { EmailService } from './email.service';

const email = z
  .string()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const password = z.string().min(12).max(256);
const token = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const freshToken = () => randomBytes(32).toString('hex');

@Controller('auth')
export class AccountController {
  constructor(
    private readonly db: PrismaService,
    private readonly mail: EmailService,
  ) {}

  @Post('password/request')
  @HttpCode(200)
  async requestReset(@Body() body: unknown) {
    const data = parse(z.object({ email }).strict(), body);
    this.mail.assertConfigured();
    const user = await this.db.client.user.findUnique({
      where: { email: data.email },
    });
    if (user?.active) {
      const recent = await this.db.client.passwordReset.findFirst({
        where: {
          userId: user.id,
          createdAt: { gt: new Date(Date.now() - 5 * 60000) },
        },
      });
      if (!recent) {
        const raw = freshToken();
        await this.db.client.passwordReset.create({
          data: {
            tokenHash: digest(raw),
            userId: user.id,
            expiresAt: new Date(Date.now() + 30 * 60000),
          },
        });
        const link = this.mail.link(`/staff/reset-password?token=${raw}`);
        try {
          await this.mail.send(
            user.email,
            'Reset your Orderly password',
            `Open this link to reset your password. It expires in 30 minutes:\n${link}\n\nIf you did not request this, you can ignore this email.`,
          );
        } catch {
          await this.db.client.passwordReset.deleteMany({
            where: { tokenHash: digest(raw) },
          });
          // Keep account existence private even when the email provider fails.
        }
      }
    }
    return { message: 'If the account exists, a reset link has been sent.' };
  }

  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() body: unknown) {
    const data = parse(z.object({ token, password }).strict(), body);
    const tokenHash = digest(data.token);
    const user = await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "tokenHash" FROM "PasswordReset" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const reset = await tx.passwordReset.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (!reset || reset.expiresAt <= new Date() || !reset.user.active)
        throw new BadRequestException('Reset link is invalid or expired');
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash: hashPassword(data.password) },
      });
      await tx.authSession.deleteMany({ where: { userId: reset.userId } });
      await tx.passwordReset.deleteMany({ where: { userId: reset.userId } });
      return reset.user;
    });
    try {
      await this.mail.send(
        user.email,
        'Your Orderly password was changed',
        'Your Orderly password was changed. If this was not you, contact your restaurant owner immediately.',
      );
    } catch {
      // The password change succeeded; a notification outage must not reverse it.
    }
    return { ok: true };
  }

  @Get('invitations/:raw')
  async invitation(@Param('raw') raw: string) {
    const tokenHash = digest(parse(token, raw));
    const invitation = await this.db.client.staffInvitation.findUnique({
      where: { tokenHash },
      include: { branch: { include: { tenant: true } } },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.branch.status !== 'ACTIVE' ||
      invitation.branch.tenant.status !== 'ACTIVE'
    )
      throw new NotFoundException('Invitation is invalid or expired');
    const existing = await this.db.client.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    return {
      email: invitation.email,
      role: invitation.role,
      restaurant: invitation.branch.tenant.name,
      branch: invitation.branch.name,
      needsPassword: !existing,
    };
  }

  @Post('invitations/:raw/accept')
  @HttpCode(200)
  async accept(@Param('raw') raw: string, @Body() body: unknown) {
    const tokenHash = digest(parse(token, raw));
    const data = parse(
      z.object({ password: password.optional() }).strict(),
      body,
    );
    await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "StaffInvitation" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const invitation = await tx.staffInvitation.findUnique({
        where: { tokenHash },
        include: { branch: { include: { tenant: true } } },
      });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.expiresAt <= new Date() ||
        invitation.branch.status !== 'ACTIVE' ||
        invitation.branch.tenant.status !== 'ACTIVE'
      )
        throw new BadRequestException('Invitation is invalid or expired');
      let user = await tx.user.findUnique({
        where: { email: invitation.email },
      });
      if (user && !user.active)
        throw new ConflictException('This account is inactive');
      if (!user) {
        if (!data.password) throw new BadRequestException('Choose a password');
        user = await tx.user.create({
          data: {
            email: invitation.email,
            passwordHash: hashPassword(data.password),
          },
        });
      }
      const member = await tx.branchUser.findUnique({
        where: {
          userId_branchId: { userId: user.id, branchId: invitation.branchId },
        },
      });
      if (member)
        throw new ConflictException(
          'This account already belongs to the branch',
        );
      await tx.branchUser.create({
        data: {
          tenantId: invitation.tenantId,
          branchId: invitation.branchId,
          userId: user.id,
          role: invitation.role,
        },
      });
      await tx.staffInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
    });
    return { ok: true };
  }
}

@Controller('restaurant/invitations')
@UseGuards(MemberGuard)
export class StaffInvitationController {
  constructor(
    private readonly db: PrismaService,
    private readonly mail: EmailService,
  ) {}

  @Get()
  async list(@Req() req: AuthRequest) {
    requireRole(req, ['OWNER', 'MANAGER']);
    return this.db.client.staffInvitation.findMany({
      where: {
        tenantId: req.tenantId,
        branchId: req.branchId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, role: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    requireRole(req, ['OWNER']);
    const data = parse(
      z.object({ email, role: z.enum(['MANAGER', 'STAFF']) }).strict(),
      body,
    );
    this.mail.assertConfigured();
    const member = await this.db.client.branchUser.findFirst({
      where: {
        tenantId: req.tenantId,
        branchId: req.branchId,
        user: { email: data.email },
      },
    });
    if (member)
      throw new ConflictException('This email already belongs to the branch');
    const branch = await this.db.client.branch.findFirstOrThrow({
      where: { id: req.branchId, tenantId: req.tenantId },
      include: { tenant: true },
    });
    const raw = freshToken();
    const tokenHash = digest(raw);
    const invitation = await this.db.client.staffInvitation.upsert({
      where: {
        tenantId_branchId_email: {
          tenantId: req.tenantId,
          branchId: req.branchId,
          email: data.email,
        },
      },
      create: {
        tenantId: req.tenantId,
        branchId: req.branchId,
        email: data.email,
        role: data.role,
        tokenHash,
        expiresAt: new Date(Date.now() + 48 * 3600000),
      },
      update: {
        role: data.role,
        tokenHash,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 48 * 3600000),
      },
    });
    const link = this.mail.link(`/staff/accept-invite?token=${raw}`);
    try {
      await this.mail.send(
        data.email,
        `Join ${branch.tenant.name} on Orderly`,
        `${branch.tenant.name} invited you to ${branch.name} as ${data.role.toLowerCase()}. Open this link within 48 hours to accept:\n${link}\n\nIf you did not expect this invitation, ignore it.`,
      );
    } catch (error) {
      await this.db.client.staffInvitation.deleteMany({
        where: { id: invitation.id, tokenHash },
      });
      throw error;
    }
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  @Delete(':id')
  async revoke(@Req() req: AuthRequest, @Param('id') id: string) {
    requireRole(req, ['OWNER']);
    const deleted = await this.db.client.staffInvitation.deleteMany({
      where: {
        id,
        tenantId: req.tenantId,
        branchId: req.branchId,
        acceptedAt: null,
      },
    });
    if (!deleted.count) throw new NotFoundException();
    return { ok: true };
  }
}
