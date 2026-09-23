import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Sse,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { takeUntil, timer } from 'rxjs';
import { OrdersService } from './orders.service';
import { OrderEvents } from './events';
import { parse } from './rules';
import { MemberGuard, requireRole, type AuthRequest } from '../security/auth';
import { PaymentService } from './payment.service';
@Controller('public/:kind/:token')
export class CustomerController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payment: PaymentService,
  ) {}
  private kind(kind: string): 'q' | 's' {
    if (kind !== 'q' && kind !== 's')
      throw new BadRequestException('Invalid QR');
    return kind;
  }
  @Get('menu') menu(
    @Param('kind') kind: string,
    @Param('token') token: string,
  ) {
    return this.orders.menu(this.kind(kind), token);
  }
  @Post('orders') create(
    @Param('kind') kind: string,
    @Param('token') token: string,
    @Body() body: unknown,
  ) {
    return this.orders.create(this.kind(kind), token, body);
  }
  @Get('orders/:id') order(
    @Param('kind') kind: string,
    @Param('token') token: string,
    @Param('id') id: string,
  ) {
    return this.orders.customerOrder(this.kind(kind), token, id);
  }
  @Get('orders/:id/promptpay') async promptpay(
    @Param('kind') kind: string,
    @Param('token') token: string,
    @Param('id') id: string,
  ) {
    const order = await this.orders.customerOrder(this.kind(kind), token, id);
    return this.payment.orderPromptPay(order);
  }
  @Post('orders/:id/payment-claim') claim(
    @Param('kind') kind: string,
    @Param('token') token: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.orders.submitPaymentClaim(this.kind(kind), token, id, body);
  }
}
@Controller('staff')
@UseGuards(MemberGuard)
export class StaffController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEvents,
    private readonly payment: PaymentService,
  ) {}
  @Get('orders') list(
    @Req() req: AuthRequest,
    @Query('history') history: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.orders.list(req, history === 'true', cursor);
  }
  @Get('orders/:id') detail(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.orders.detail(req, id);
  }
  @Get('summary') summary(@Req() req: AuthRequest) {
    return this.orders.summary(req);
  }
  @Get('daily') daily(@Req() req: AuthRequest, @Query('days') days?: string) {
    const count = Number(days || 7);
    if (!Number.isInteger(count) || count < 1 || count > 31)
      throw new BadRequestException('Days must be between 1 and 31');
    return this.orders.daily(req, count);
  }
  @Patch('orders/:id/status') status(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { status } = parse(
      z
        .object({
          status: z.enum([
            'NEW',
            'ACCEPTED',
            'PREPARING',
            'READY',
            'COMPLETED',
            'CANCELLED',
          ]),
        })
        .strict(),
      body,
    );
    return this.orders.status(req, id, status);
  }
  @Post('orders/:id/payment') paymentConfirm(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.orders.confirmPayment(req, id, body);
  }
  @Post('orders/:id/payment-claim/reject') rejectPaymentClaim(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.orders.rejectPaymentClaim(req, id, body);
  }
  @Post('orders/:id/refunds') createRefund(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.orders.createRefund(req, id, body);
  }
  @Post('orders/:orderId/refunds/:refundId/complete') completeRefund(
    @Req() req: AuthRequest,
    @Param('orderId') orderId: string,
    @Param('refundId') refundId: string,
    @Body() body: unknown,
  ) {
    requireRole(req, ['OWNER', 'MANAGER']);
    return this.orders.completeRefund(req, orderId, refundId, body);
  }
  @Post('orders/:orderId/refunds/:refundId/cancel') cancelRefund(
    @Req() req: AuthRequest,
    @Param('orderId') orderId: string,
    @Param('refundId') refundId: string,
  ) {
    requireRole(req, ['OWNER', 'MANAGER']);
    return this.orders.cancelRefund(req, orderId, refundId);
  }
  @Get('sessions/:id/promptpay') promptpay(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    return this.payment.sessionPromptPay(req, id);
  }
  @Sse('events') stream(@Req() req: AuthRequest) {
    return this.events
      .stream(req.branchId)
      .pipe(
        takeUntil(
          timer(
            Math.min(
              60000,
              Math.max(0, req.sessionExpiresAt.getTime() - Date.now()),
            ),
          ),
        ),
      );
  }
}
