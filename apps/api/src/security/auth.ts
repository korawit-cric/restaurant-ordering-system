import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Controller,
  Post,
  Get,
  Req,
  Res,
  Body,
  UseGuards,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { User } from '@repo/prisma';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password';
export type AuthRequest = Request & { user: User; sessionExpiresAt: Date };
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
function cookieToken(req: Request) {
  return (
    req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('ros_session='))
      ?.slice(12) || ''
  );
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.db.client.session.findUnique({
      where: { tokenHash: digest(cookieToken(req)) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.active)
      throw new UnauthorizedException('Please sign in');
    req.user = session.user;
    req.sessionExpiresAt = session.expiresAt;
    return true;
  }
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<AuthRequest>().user?.role !== 'ADMIN')
      throw new ForbiddenException('Admin access required');
    return true;
  }
}
@Controller('auth')
export class AuthController {
  constructor(private readonly db: PrismaService) {}
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(256),
      })
      .strict()
      .safeParse(body);
    if (!result.success)
      throw new BadRequestException('Enter a valid email and password');
    const user = await this.db.client.user.findUnique({
      where: { email: result.data.email.toLowerCase() },
    });
    // A fixed dummy hash keeps unknown-user attempts on the same password hashing path.
    const valid = verifyPassword(
      result.data.password,
      user?.passwordHash ||
        '00000000000000000000000000000000:' + '00'.repeat(64),
    );
    if (!user?.active || !valid)
      throw new UnauthorizedException('Invalid email or password');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await this.db.client.session.create({
      data: { tokenHash: digest(token), userId: user.id, expiresAt },
    });
    res.cookie('ros_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      expires: expiresAt,
    });
    return { id: user.id, email: user.email, role: user.role };
  }
  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthRequest) {
    return { id: req.user.id, email: req.user.email, role: req.user.role };
  }
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.db.client.session.deleteMany({
      where: { tokenHash: digest(cookieToken(req)) },
    });
    res.clearCookie('ros_session', { path: '/' });
    return { ok: true };
  }
}
