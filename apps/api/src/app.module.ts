import { APP_FILTER } from '@nestjs/core';
import { PrismaFilter } from './prisma/prisma.filter';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import {
  AuthController,
  AuthGuard,
  AuthService,
  MemberGuard,
  OperatorGuard,
} from './security/auth';
import { BoundaryMiddleware } from './security/boundary';
import {
  AccountController,
  StaffInvitationController,
} from './security/account.controller';
import { EmailService } from './security/email.service';
import { OrdersService } from './orders/orders.service';
import { PaymentService } from './orders/payment.service';
import { OrderEvents } from './orders/events';
import {
  CustomerController,
  StaffController,
} from './orders/orders.controller';
import { AdminController } from './admin/admin.controller';
import { PlatformController } from './admin/platform.controller';
import { TenancyController } from './tenancy/tenancy.controller';
@Module({
  imports: [PrismaModule],
  controllers: [
    AuthController,
    AccountController,
    StaffInvitationController,
    CustomerController,
    StaffController,
    AdminController,
    PlatformController,
    TenancyController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: PrismaFilter },
    AuthGuard,
    MemberGuard,
    OperatorGuard,
    AuthService,
    EmailService,
    OrdersService,
    PaymentService,
    OrderEvents,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BoundaryMiddleware).forRoutes('*');
  }
}
