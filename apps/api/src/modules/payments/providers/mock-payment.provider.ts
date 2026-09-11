import { Injectable } from '@nestjs/common';
import {
  PaymentProvider,
  CreatePaymentParams,
  CreatePaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  RefundParams,
  RefundResult,
} from '@isp-crm/shared';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK_GATEWAY';

  /**
   * Create an online payment order intent
   */
  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    const gatewayOrderId = `mock_ord_${timestamp}_${rand}`;
    const paymentUrl = `https://checkout.mockpay.local/pay/${gatewayOrderId}?amt=${params.amount}&cur=${params.currency || 'INR'}`;

    return {
      gatewayOrderId,
      paymentUrl,
      amount: params.amount,
      currency: params.currency || 'INR',
      status: 'CREATED',
      rawResponse: {
        provider: this.name,
        orderId: params.orderId,
        gatewayOrderId,
        amount: params.amount,
        createdAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Deterministically verify payment signature or callback payload
   */
  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    // Check if test simulates a signature or gateway failure
    const isExplicitFailure =
      params.signature === 'INVALID_SIGNATURE' ||
      params.gatewayPaymentId.includes('fail') ||
      params.gatewayOrderId.includes('fail');

    if (isExplicitFailure) {
      return {
        isSuccess: false,
        gatewayOrderId: params.gatewayOrderId,
        gatewayPaymentId: params.gatewayPaymentId,
        amount: params.rawPayload?.amount?.toString() || '0.00',
        currency: params.rawPayload?.currency || 'INR',
        status: 'FAILED',
        failureReason: 'Mock payment signature verification failed or payment declined by bank',
        rawResponse: {
          error: 'BAD_SIGNATURE',
          gatewayOrderId: params.gatewayOrderId,
          gatewayPaymentId: params.gatewayPaymentId,
        },
      };
    }

    return {
      isSuccess: true,
      gatewayOrderId: params.gatewayOrderId,
      gatewayPaymentId: params.gatewayPaymentId,
      amount: params.rawPayload?.amount?.toString() || '0.00',
      currency: params.rawPayload?.currency || 'INR',
      status: 'SUCCESS',
      paidAt: new Date(),
      rawResponse: {
        verified: true,
        gatewayOrderId: params.gatewayOrderId,
        gatewayPaymentId: params.gatewayPaymentId,
        method: params.rawPayload?.method || 'UPI',
      },
    };
  }

  /**
   * Process refund through gateway
   */
  async refund(params: RefundParams): Promise<RefundResult> {
    const refundId = `mock_rfnd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    return {
      isSuccess: true,
      refundId,
      gatewayPaymentId: params.gatewayPaymentId,
      amount: params.amount || '0.00',
      status: 'REFUNDED',
    };
  }
}
