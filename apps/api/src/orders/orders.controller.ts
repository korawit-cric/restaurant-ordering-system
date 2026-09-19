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
} from '@nestjs/common';
import { z } from 'zod';
import { takeUntil, timer } from 'rxjs';
import { OrdersService } from './orders.service';
import { OrderEvents } from './events';
import { parse } from './rules';
import { AuthGuard, type AuthRequest } from '../security/auth';
@Controller('public/tables/:token')
export class CustomerController {
  constructor(private readonly orders: OrdersService) {}
  @Get('menu') menu(@Param('token') token: string) {
    return this.orders.menu(token);
  }
  @Post('orders') create(@Param('token') token: string, @Body() body: unknown) {
    return this.orders.create(token, body);
  }
  @Get('orders/:id') order(
    @Param('token') token: string,
    @Param('id') id: string,
  ) {
    return this.orders.customerOrder(token, id);
  }
}
@Controller('staff')
@UseGuards(AuthGuard)
export class StaffController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEvents,
  ) {}
  @Get('orders') list(
    @Query('history') history: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.orders.list(history === 'true', cursor);
  }
  @Get('orders/:id') detail(@Param('id') id: string) {
    return this.orders.detail(id);
  }
  @Get('summary') summary() {
    return this.orders.summary();
  }
  @Patch('orders/:id/status') status(
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          status: z.enum([
            'NEW',
            'ACCEPTED',
            'PREPARING',
            'SERVED',
            'CANCELLED',
          ]),
        })
        .strict(),
      body,
    );
    return this.orders.status(id, data.status);
  }
  @Post('orders/:id/payment') payment(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.orders.confirmPayment(id, req.user.id);
  }
  @Sse('events') stream(@Req() req: AuthRequest) {
    return this.events
      .stream()
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
