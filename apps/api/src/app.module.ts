import { APP_FILTER } from '@nestjs/core';
import { PrismaFilter } from './prisma/prisma.filter';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthController, AuthGuard, AdminGuard } from './security/auth';
import { BoundaryMiddleware } from './security/boundary';
import { OrdersService } from './orders/orders.service';
import { OrderEvents } from './orders/events';
import {
  CustomerController,
  StaffController,
} from './orders/orders.controller';
import { AdminController } from './admin/admin.controller';
@Module({
  imports: [PrismaModule],
  controllers: [
    AuthController,
    CustomerController,
    StaffController,
    AdminController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: PrismaFilter },
    AuthGuard,
    AdminGuard,
    OrdersService,
    OrderEvents,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BoundaryMiddleware).forRoutes('*');
  }
}
