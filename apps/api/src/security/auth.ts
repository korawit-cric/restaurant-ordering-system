import {
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Post,
  Body,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { User, BranchUser } from '@repo/prisma';
import { Prisma } from '@repo/prisma';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password';
import { applyPreset, presetSchema } from '../tenancy/presets';
import { parse } from '../orders/rules';

export type AuthRequest = Request & {
  user: User;
  membership: BranchUser;
  tenantId: string;
  branchId: string;
  sessionExpiresAt: Date;
  sessionHash: string;
};
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const tokenFrom = (req: Request) =>
  req.headers.cookie
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('ros_session='))
    ?.slice(12) || '';
const email = z
  .string()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z.string().min(12).max(256);
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .min(3)
  .max(50);
const businessSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug,
    branchName: z.string().trim().min(1).max(100),
    preset: presetSchema,
  })
  .strict();
const signupSchema = businessSchema.extend({ email, password });

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(protected readonly db: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const sessionHash = digest(tokenFrom(req));
    const session = await this.db.client.authSession.findUnique({
      where: { tokenHash: sessionHash },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || !session.user.active)
      throw new UnauthorizedException('Please sign in');
    req.user = session.user;
    req.sessionHash = sessionHash;
    req.sessionExpiresAt = session.expiresAt;
    if (session.tenantId && session.branchId) {
      req.tenantId = session.tenantId;
      req.branchId = session.branchId;
    }
    return true;
  }
}
@Injectable()
export class MemberGuard extends AuthGuard {
  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (!req.tenantId || !req.branchId)
      throw new ForbiddenException('Select a branch');
    const member = await this.db.client.branchUser.findFirst({
      where: {
        userId: req.user.id,
        tenantId: req.tenantId,
        branchId: req.branchId,
        active: true,
        branch: { status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      },
    });
    if (!member)
      throw new ForbiddenException('Branch access is no longer available');
    req.membership = member;
    return true;
  }
}
@Injectable()
export class OperatorGuard extends AuthGuard {
  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (req.user.platformRole !== 'OPERATOR')
      throw new ForbiddenException('Platform operator access required');
    return true;
  }
}
export function requireRole(req: AuthRequest, roles: BranchUser['role'][]) {
  if (!roles.includes(req.membership.role))
    throw new ForbiddenException('Your role does not allow this action');
}

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}
  async issue(
    res: Response,
    userId: string,
    tenantId?: string,
    branchId?: string,
  ) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await this.db.client.authSession.create({
      data: { tokenHash: digest(token), userId, tenantId, branchId, expiresAt },
    });
    res.cookie('ros_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      expires: expiresAt,
    });
  }
  async createBusiness(
    userId: string | null,
    body: unknown,
    credentials?: { email: string; passwordHash: string },
  ) {
    const data = parse(businessSchema, body);
    const settings = applyPreset(data.preset);
    try {
      return await this.db.client.$transaction(async (tx) => {
        const ownerId =
          userId ||
          (
            await tx.user.create({
              data: {
                email: credentials!.email,
                passwordHash: credentials!.passwordHash,
              },
            })
          ).id;
        const tenant = await tx.tenant.create({
          data: {
            name: data.name,
            slug: data.slug,
            subscription: {
              create: {
                planId: 'starter',
                status: 'TRIAL',
                trialEndsAt: new Date(Date.now() + 30 * 86400000),
              },
            },
          },
        });
        const branch = await tx.branch.create({
          data: {
            tenantId: tenant.id,
            name: data.branchName,
            slug: 'main',
          },
        });
        await tx.branchSettings.create({
          data: { tenantId: tenant.id, branchId: branch.id, ...settings },
        });
        await tx.menu.create({
          data: { tenantId: tenant.id, branchId: branch.id, name: 'Main menu' },
        });
        await tx.branchUser.create({
          data: {
            tenantId: tenant.id,
            branchId: branch.id,
            userId: ownerId,
            role: 'OWNER',
          },
        });
        return { tenant, branch, ownerId };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'This email or restaurant slug is already in use',
        );
      throw error;
    }
  }
}
@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  @Post('signup')
  @HttpCode(201)
  async signup(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = parse(signupSchema, body);
    try {
      const { tenant, branch, ownerId } = await this.auth.createBusiness(
        null,
        {
          name: data.name,
          slug: data.slug,
          branchName: data.branchName,
          preset: data.preset,
        },
        { email: data.email, passwordHash: hashPassword(data.password) },
      );
      await this.auth.issue(res, ownerId, tenant.id, branch.id);
      return {
        id: ownerId,
        email: data.email,
        role: 'OWNER',
        tenant: { id: tenant.id, name: tenant.name },
        branch: { id: branch.id, name: branch.name },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('This email is already registered');
      throw error;
    }
  }
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = parse(
      z.object({ email, password: z.string().min(1).max(256) }).strict(),
      body,
    );
    const user = await this.db.client.user.findUnique({
      where: { email: data.email },
      include: {
        memberships: {
          where: { active: true },
          include: { branch: { include: { tenant: true } } },
        },
      },
    });
    const valid = verifyPassword(
      data.password,
      user?.passwordHash ||
        '00000000000000000000000000000000:' + '00'.repeat(64),
    );
    if (!user?.active || !valid)
      throw new UnauthorizedException('Invalid email or password');
    const membership = user.memberships.find(
      (m) =>
        m.branch.status === 'ACTIVE' && m.branch.tenant.status === 'ACTIVE',
    );
    if (!membership && user.platformRole !== 'OPERATOR')
      throw new ForbiddenException('No active restaurant access');
    await this.auth.issue(
      res,
      user.id,
      membership?.tenantId,
      membership?.branchId,
    );
    return {
      id: user.id,
      email: user.email,
      role: membership?.role || 'OPERATOR',
      tenantId: membership?.tenantId,
      branchId: membership?.branchId,
    };
  }
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthRequest) {
    const memberships = await this.db.client.branchUser.findMany({
      where: {
        userId: req.user.id,
        active: true,
        branch: { status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      },
      include: { branch: { include: { tenant: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id: req.user.id,
      email: req.user.email,
      platformRole: req.user.platformRole,
      tenantId: req.tenantId || null,
      branchId: req.branchId || null,
      role:
        memberships.find(
          (m) => m.tenantId === req.tenantId && m.branchId === req.branchId,
        )?.role || null,
      memberships: memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.branch.tenant.name,
        branchId: m.branchId,
        branchName: m.branch.name,
        role: m.role,
      })),
    };
  }
  @Post('context')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async context(@Req() req: AuthRequest, @Body() body: unknown) {
    const { branchId } = parse(
      z.object({ branchId: z.string().uuid() }).strict(),
      body,
    );
    const member = await this.db.client.branchUser.findFirst({
      where: {
        userId: req.user.id,
        branchId,
        active: true,
        branch: { status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      },
    });
    if (!member) throw new ForbiddenException('Branch access denied');
    await this.db.client.authSession.update({
      where: { tokenHash: req.sessionHash },
      data: { tenantId: member.tenantId, branchId: member.branchId },
    });
    return {
      tenantId: member.tenantId,
      branchId: member.branchId,
      role: member.role,
    };
  }
  @Post('restaurant')
  @UseGuards(AuthGuard)
  async restaurant(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.auth.createBusiness(req.user.id, body);
  }
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.db.client.authSession.deleteMany({
      where: { tokenHash: digest(tokenFrom(req)) },
    });
    res.clearCookie('ros_session', { path: '/' });
    return { ok: true };
  }
}
