import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import { SubscriptionsService } from '../dist/modules/subscriptions/subscriptions.service.js';
import { InvoicesService } from '../dist/modules/invoices/invoices.service.js';
import { PaymentsService } from '../dist/modules/payments/payments.service.js';
import { MockPaymentProvider } from '../dist/modules/payments/providers/mock-payment.provider.js';
import {
  InvoiceStatus,
  PaymentStatus,
  SubscriptionStatus,
  CustomerStatus,
  BillingCycle,
  SpeedUnit,
  PlanStatus,
} from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';
import { Decimal } from 'decimal.js';

const authService = new AuthService();
const customersService = new CustomersService();
const plansService = new PlansService();
const subscriptionsService = new SubscriptionsService();
const invoicesService = new InvoicesService();
const mockProvider = new MockPaymentProvider();
const paymentsService = new PaymentsService(mockProvider);

test('PaymentProvider & Idempotency: Mock Gateway, Tri-State Settlement, Duplicate Callback Protection', async (t) => {
  const ts = Date.now();

  await t.test('1. MockPaymentProvider Unit Behavior: createPayment, verifyPayment, refund', async () => {
    // createPayment
    const order = await mockProvider.createPayment({
      orderId: 'inv_test_123',
      amount: '999.00',
      currency: 'INR',
      customerId: 'cust_test_123',
      customerName: 'Aarav Gupta',
    });
    assert.ok(order.gatewayOrderId.startsWith('mock_ord_'));
    assert.ok(order.paymentUrl.includes(order.gatewayOrderId));
    assert.equal(order.status, 'CREATED');
    assert.equal(order.amount, '999.00');

    // verifyPayment (valid)
    const validVerification = await mockProvider.verifyPayment({
      gatewayOrderId: order.gatewayOrderId,
      gatewayPaymentId: 'mock_pay_success_123',
      signature: 'valid_sig_abc',
      rawPayload: { amount: '999.00', currency: 'INR' },
    });
    assert.equal(validVerification.isSuccess, true);
    assert.equal(validVerification.status, 'SUCCESS');
    assert.ok(validVerification.paidAt);

    // verifyPayment (invalid signature simulation)
    const invalidVerification = await mockProvider.verifyPayment({
      gatewayOrderId: order.gatewayOrderId,
      gatewayPaymentId: 'mock_pay_fail_456',
      signature: 'INVALID_SIGNATURE',
    });
    assert.equal(invalidVerification.isSuccess, false);
    assert.equal(invalidVerification.status, 'FAILED');
    assert.ok(invalidVerification.failureReason);

    // refund
    const refundResult = await mockProvider.refund({
      gatewayPaymentId: 'mock_pay_success_123',
      amount: '999.00',
      reason: 'Customer cancelled subscription',
    });
    assert.equal(refundResult.isSuccess, true);
    assert.equal(refundResult.status, 'REFUNDED');
    assert.ok(refundResult.refundId.startsWith('mock_rfnd_'));
  });

  // Setup Tenant Organization, Plan, Customer, and Subscription
  const orgResult = await authService.registerOrganization({
    name: `SwiftFiber ISP ${ts}`,
    slug: `swiftfiber-${ts}`,
    email: `billing@swiftfiber-${ts}.com`,
    phone: '9876590001',
    ownerName: 'Swift Admin',
    ownerEmail: `admin.${ts}@swiftfiber.com`,
    ownerPassword: 'Password123!',
  });
  const orgId = orgResult.user.organizationId;
  const adminId = orgResult.user.id;

  const plan = await plansService.create(orgId, adminId, {
    name: 'Swift 100M Fiber',
    code: `SWIFT-100M-${ts}`,
    downloadSpeed: 100,
    uploadSpeed: 50,
    speedUnit: SpeedUnit.MBPS,
    price: 999,
    validityDays: 30,
    billingCycle: BillingCycle.MONTHLY,
    status: PlanStatus.ACTIVE,
  });

  const customer = await customersService.create(orgId, adminId, {
    name: 'Vikram Joshi',
    customerCode: `CUST-SWIFT-${ts}`,
    mobile: '9820099881',
    address: 'Bandra West, Mumbai',
    city: 'Mumbai',
    state: 'Maharashtra',
    username: `vikram_${ts}`,
    pppoePassword: 'pass_vikram_123',
    status: CustomerStatus.ACTIVE,
  });

  // Initial subscription set to SUSPENDED past its due date
  const now = new Date();
  const initialEndDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days expired
  const subscription = await subscriptionsService.create(orgId, adminId, {
    customerId: customer.id,
    planId: plan.id,
    status: SubscriptionStatus.SUSPENDED,
    startDate: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000).toISOString(),
    billingCycle: BillingCycle.MONTHLY,
  });

  // Update subscription endDate explicitly to the expired date
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { endDate: initialEndDate, status: SubscriptionStatus.SUSPENDED },
  });

  // Create Invoice tied to this subscription: ₹999 + 18% GST = ₹1,178.82
  const invoice = await invoicesService.create(orgId, adminId, {
    customerId: customer.id,
    subscriptionId: subscription.id,
    notes: 'Monthly renewal invoice for Swift 100M Fiber',
    items: [
      {
        description: 'Swift 100M Fiber Monthly Plan',
        sacCode: '998422',
        quantity: 1,
        unitPrice: '999.00',
      },
    ],
  });

  assert.equal(invoice.status, InvoiceStatus.ISSUED);
  assert.equal(invoice.totalAmount, '1178.82');
  assert.equal(invoice.balanceDue, '1178.82');

  const testGatewayOrderId = `mock_ord_${ts}_001`;
  const testGatewayPaymentId = `mock_pay_${ts}_999`;
  const testIdempotencyKey = `idem_${ts}_key_abc`;

  await t.test('2. Online Payment Settlement: invoice → PAID, payment → SUCCESS, subscription → ACTIVE/RENEWED', async () => {
    // 1. Create Payment Intent
    const intent = await paymentsService.createPaymentIntent(orgId, {
      invoiceId: invoice.id,
    });
    assert.ok(intent.gatewayOrderId);
    assert.equal(intent.amount, '1178.82');
    assert.equal(intent.invoiceNumber, invoice.invoiceNumber);

    // 2. Verify and settle payment
    const result = await paymentsService.verifyAndSettleOnlinePayment(orgId, adminId, {
      invoiceId: invoice.id,
      gatewayOrderId: testGatewayOrderId,
      gatewayPaymentId: testGatewayPaymentId,
      signature: 'mock_valid_signature',
      idempotencyKey: testIdempotencyKey,
    });

    assert.equal(result.isSuccess, true);
    assert.equal(result.isDuplicate, false);

    // Assert: invoice → PAID
    assert.equal(result.invoice.status, InvoiceStatus.PAID);
    assert.equal(result.invoice.paidAmount, '1178.82');
    assert.equal(result.invoice.balanceDue, '0.00');

    // Assert: payment → SUCCESS
    assert.equal(result.payment.status, PaymentStatus.SUCCESS);
    assert.equal(result.payment.amount, '1178.82');
    assert.equal(result.payment.gatewayPaymentId, testGatewayPaymentId);
    assert.equal(result.payment.idempotencyKey, testIdempotencyKey);

    // Assert: subscription → ACTIVE/RENEWED with extended endDate
    assert.ok(result.subscription);
    assert.equal(result.subscription.status, SubscriptionStatus.ACTIVE);
    const newEnd = new Date(result.subscription.endDate);
    assert.ok(newEnd > now, 'New endDate must be in the future');

    // Verify SubscriptionHistory was created with action RENEW
    const history = await prisma.subscriptionHistory.findFirst({
      where: { subscriptionId: subscription.id, action: 'RENEW' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(history);
    assert.equal(history.toStatus, SubscriptionStatus.ACTIVE);

    // Verify FreeRADIUS radcheck credentials restored
    const radcheck = await prisma.radCheck.findFirst({
      where: { username: customer.username, attribute: 'Cleartext-Password' },
    });
    assert.ok(radcheck);
    assert.equal(radcheck.value, 'pass_vikram_123');
  });

  await t.test('3. Idempotency: Duplicate Payment Callback Handled Safely Without Double-Charging or Re-renewing', async () => {
    // Check baseline counts before duplicate call
    const paymentsCountBefore = await prisma.payment.count({ where: { invoiceId: invoice.id } });
    assert.equal(paymentsCountBefore, 1);

    const subBefore = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    const endDateBefore = subBefore.endDate.toISOString();

    const invBefore = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    const paidAmountBefore = invBefore.paidAmount.toString();

    // Send the EXACT same callback payload a SECOND time
    const duplicateResult = await paymentsService.verifyAndSettleOnlinePayment(orgId, adminId, {
      invoiceId: invoice.id,
      gatewayOrderId: testGatewayOrderId,
      gatewayPaymentId: testGatewayPaymentId,
      signature: 'mock_valid_signature',
      idempotencyKey: testIdempotencyKey,
    });

    // Assert it is acknowledged as duplicate
    assert.equal(duplicateResult.isSuccess, true);
    assert.equal(duplicateResult.isDuplicate, true);
    assert.match(duplicateResult.message, /idempotent/i);

    // Assert NO double charging
    const invAfter = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(invAfter.paidAmount.toString(), paidAmountBefore);

    // Assert NO duplicate payment records created
    const paymentsCountAfter = await prisma.payment.count({ where: { invoiceId: invoice.id } });
    assert.equal(paymentsCountAfter, 1);

    // Assert NO second subscription extension
    const subAfter = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    assert.equal(subAfter.endDate.toISOString(), endDateBefore);

    // Send a THIRD time to be 100% sure
    const thirdResult = await paymentsService.verifyAndSettleOnlinePayment(orgId, adminId, {
      invoiceId: invoice.id,
      gatewayOrderId: testGatewayOrderId,
      gatewayPaymentId: testGatewayPaymentId,
      signature: 'mock_valid_signature',
      idempotencyKey: testIdempotencyKey,
    });
    assert.equal(thirdResult.isDuplicate, true);
    const paymentsCountThird = await prisma.payment.count({ where: { invoiceId: invoice.id } });
    assert.equal(paymentsCountThird, 1);
  });

  await t.test('4. Concurrent Duplicate Callbacks: Thread/Race Condition Safety', async () => {
    // Create new customer and invoice to test concurrent requests
    const custConcurrent = await customersService.create(orgId, adminId, {
      name: 'Pooja Hegde',
      customerCode: `CUST-CONC-${ts}`,
      mobile: '9820099882',
      address: 'Juhu, Mumbai',
      username: `pooja_${ts}`,
      pppoePassword: 'pass_pooja_123',
    });

    const invConcurrent = await invoicesService.create(orgId, adminId, {
      customerId: custConcurrent.id,
      items: [
        {
          description: 'Internet Access Monthly',
          unitPrice: '500.00',
        },
      ],
    });

    const concOrderId = `mock_ord_conc_${ts}`;
    const concPaymentId = `mock_pay_conc_${ts}`;
    const concIdempotencyKey = `conc_idem_${ts}`;

    // Dispatch 2 concurrent calls in parallel
    const [res1, res2] = await Promise.all([
      paymentsService.verifyAndSettleOnlinePayment(orgId, adminId, {
        invoiceId: invConcurrent.id,
        gatewayOrderId: concOrderId,
        gatewayPaymentId: concPaymentId,
        idempotencyKey: concIdempotencyKey,
      }),
      paymentsService.verifyAndSettleOnlinePayment(orgId, adminId, {
        invoiceId: invConcurrent.id,
        gatewayOrderId: concOrderId,
        gatewayPaymentId: concPaymentId,
        idempotencyKey: concIdempotencyKey,
      }),
    ]);

    // One must be fresh, one must be duplicate (or both succeed idempotently)
    assert.ok(res1.isSuccess);
    assert.ok(res2.isSuccess);
    const hasDuplicate = res1.isDuplicate || res2.isDuplicate;
    assert.equal(hasDuplicate, true);

    // Exactly 1 payment record should exist
    const concPaymentsCount = await prisma.payment.count({
      where: { invoiceId: invConcurrent.id },
    });
    assert.equal(concPaymentsCount, 1);
  });

  await t.test('5. Signature Failure: Rejects Tampered or Failed Payment Callbacks', async () => {
    const custFail = await customersService.create(orgId, adminId, {
      name: 'Amitabh Sen',
      customerCode: `CUST-FAIL-${ts}`,
      mobile: '9820099883',
      address: 'Worli, Mumbai',
      username: `amitabh_${ts}`,
      pppoePassword: 'pass_amitabh_123',
    });

    const invFail = await invoicesService.create(orgId, adminId, {
      customerId: custFail.id,
      items: [{ description: 'Broadband', unitPrice: '400.00' }],
    });

    await assert.rejects(
      async () => {
        await paymentsService.verifyAndSettleOnlinePayment(orgId, adminId, {
          invoiceId: invFail.id,
          gatewayOrderId: `mock_ord_fail_${ts}`,
          gatewayPaymentId: `mock_pay_fail_${ts}`,
          signature: 'INVALID_SIGNATURE',
        });
      },
      {
        name: 'BadRequestException',
        message: /verification failed/i,
      },
    );

    // Verify invoice remains ISSUED
    const invCheck = await prisma.invoice.findUnique({ where: { id: invFail.id } });
    assert.equal(invCheck.status, InvoiceStatus.ISSUED);
    assert.equal(Number(invCheck.paidAmount), 0);
  });

  await t.test('6. Refund Flow: Refunds Payment and Updates Ledger', async () => {
    // Find the successful payment from test 2
    const payment = await prisma.payment.findFirst({
      where: { gatewayPaymentId: testGatewayPaymentId },
    });
    assert.ok(payment);

    const refund = await paymentsService.refundPayment(orgId, adminId, payment.id, {
      reason: 'Customer billing dispute resolved',
    });

    assert.equal(refund.isSuccess, true);
    assert.equal(refund.payment.status, PaymentStatus.REFUNDED);

    // Verify DB state
    const paymentAfter = await prisma.payment.findUnique({ where: { id: payment.id } });
    assert.equal(paymentAfter.status, PaymentStatus.REFUNDED);
  });
});
