export interface CreatePaymentParams {
  orderId: string;
  amount: string; // Decimal string e.g. "999.00"
  currency?: string; // Default "INR"
  customerId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  description?: string;
  callbackUrl?: string;
  metadata?: Record<string, any>;
}

export interface CreatePaymentResult {
  gatewayOrderId: string;
  paymentUrl?: string;
  amount: string;
  currency: string;
  status: 'CREATED' | 'PENDING' | 'FAILED';
  rawResponse?: Record<string, any>;
}

export interface VerifyPaymentParams {
  gatewayOrderId: string;
  gatewayPaymentId: string;
  signature?: string;
  rawPayload?: Record<string, any>;
}

export interface VerifyPaymentResult {
  isSuccess: boolean;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amount: string;
  currency: string;
  status: 'SUCCESS' | 'FAILED';
  paidAt?: Date;
  failureReason?: string;
  rawResponse?: Record<string, any>;
}

export interface RefundParams {
  gatewayPaymentId: string;
  amount?: string;
  reason?: string;
}

export interface RefundResult {
  isSuccess: boolean;
  refundId: string;
  gatewayPaymentId: string;
  amount: string;
  status: 'REFUNDED' | 'FAILED';
  failureReason?: string;
}

/**
 * Pluggable payment provider abstraction supporting mock & real gateways
 * (Razorpay, Stripe, Cashfree, PayU)
 */
export interface PaymentProvider {
  readonly name: string;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  refund(params: RefundParams): Promise<RefundResult>;
}
