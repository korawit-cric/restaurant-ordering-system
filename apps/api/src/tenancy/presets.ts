import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type {
  FulfillmentMode,
  PaymentMode,
  QrMode,
  SessionMode,
} from '@repo/prisma';
export const presetSchema = z.enum([
  'TABLE_SERVICE',
  'BAR_FLEXIBLE',
  'QUICK_SERVICE',
  'PICKUP_STALL',
]);
export type Preset = z.infer<typeof presetSchema>;
export const presets: Record<
  Preset,
  {
    label: string;
    qrMode: QrMode;
    sessionMode: SessionMode;
    paymentMode: PaymentMode;
    fulfillmentMode: FulfillmentMode;
  }
> = {
  TABLE_SERVICE: {
    label: 'Table Service',
    qrMode: 'PERMANENT',
    sessionMode: 'OPEN_SESSION',
    paymentMode: 'AT_CHECKOUT',
    fulfillmentMode: 'SERVE_TO_LOCATION',
  },
  BAR_FLEXIBLE: {
    label: 'Bar / Flexible Seating',
    qrMode: 'SESSION',
    sessionMode: 'OPEN_SESSION',
    paymentMode: 'PER_ORDER',
    fulfillmentMode: 'SERVE_TO_LOCATION',
  },
  QUICK_SERVICE: {
    label: 'Quick Service',
    qrMode: 'PERMANENT',
    sessionMode: 'SINGLE_ORDER',
    paymentMode: 'PER_ORDER',
    fulfillmentMode: 'PICKUP',
  },
  PICKUP_STALL: {
    label: 'Pickup / Food Stall',
    qrMode: 'PERMANENT',
    sessionMode: 'SINGLE_ORDER',
    paymentMode: 'PER_ORDER',
    fulfillmentMode: 'PICKUP',
  },
};
export const applyPreset = (preset: Preset) => ({
  preset,
  qrMode: presets[preset].qrMode,
  sessionMode: presets[preset].sessionMode,
  paymentMode: presets[preset].paymentMode,
  fulfillmentMode: presets[preset].fulfillmentMode,
});
export function validateWorkflow(settings: {
  qrMode: QrMode;
  sessionMode: SessionMode;
  paymentMode: PaymentMode;
  fulfillmentMode: FulfillmentMode;
}) {
  if (
    settings.paymentMode === 'AT_CHECKOUT' &&
    settings.sessionMode !== 'OPEN_SESSION'
  )
    throw new BadRequestException('Checkout payment requires an open session');
  if (
    settings.qrMode === 'SESSION' &&
    settings.sessionMode === 'SINGLE_ORDER' &&
    settings.paymentMode === 'AT_CHECKOUT'
  )
    throw new BadRequestException(
      'Single-order sessions cannot accumulate checkout payments',
    );
}
