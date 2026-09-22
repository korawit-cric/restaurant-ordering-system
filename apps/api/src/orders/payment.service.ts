import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthRequest } from '../security/auth';
import { PrismaService } from '../prisma/prisma.service';
import QRCode from 'qrcode';
import generatePayload from 'promptpay-qr';
export interface PaymentInstructions {
  method: 'PROMPTPAY';
  amount: string;
  payload: string;
  svg: string;
  manualConfirmation: true;
}
@Injectable()
export class PaymentService {
  constructor(private readonly db: PrismaService) {}
  private async promptpay(
    branchId: string,
    tenantId: string,
    amount: string,
  ): Promise<PaymentInstructions> {
    const settings = await this.db.client.branchSettings.findUnique({
      where: { tenantId_branchId: { tenantId, branchId } },
    });
    if (!settings?.promptpayId)
      throw new BadRequestException('PromptPay is not configured');
    const payload = generatePayload(settings.promptpayId, {
      amount: Number(amount),
    });
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return {
      method: 'PROMPTPAY',
      amount,
      payload,
      svg,
      manualConfirmation: true,
    };
  }
  async orderPromptPay(order: {
    paymentMethod: string | null;
    paymentStatus: string;
    tenantId: string;
    branchId: string;
    total: { toString(): string };
  }) {
    if (
      order.paymentMethod !== 'PROMPTPAY' ||
      order.paymentStatus !== 'PENDING'
    )
      throw new BadRequestException('No pending PromptPay payment');
    return this.promptpay(
      order.branchId,
      order.tenantId,
      order.total.toString(),
    );
  }
  async sessionPromptPay(req: AuthRequest, id: string) {
    const s = await this.db.client.orderSession.findFirst({
      where: {
        id,
        tenantId: req.tenantId,
        branchId: req.branchId,
        status: 'CLOSED',
        paymentMethod: 'PROMPTPAY',
        paymentStatus: 'PENDING',
      },
    });
    if (!s) throw new NotFoundException('Pending checkout not found');
    return this.promptpay(s.branchId, s.tenantId, s.subtotal.toString());
  }
}
