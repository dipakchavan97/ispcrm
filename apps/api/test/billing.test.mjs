import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { InvoicesService } from '../dist/modules/invoices/invoices.service.js';
import { PaymentsService } from '../dist/modules/payments/payments.service.js';
import {
  InvoiceStatus,
  PaymentStatus,
  PaymentMethod,
  CustomerStatus,
  calculateInvoiceTotals,
  calculatePaymentSettlement,
  toMoneyDecimal,
} from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';
import { Decimal } from 'decimal.js';

const authService = new AuthService();
const customersService = new CustomersService();
const invoicesService = new InvoicesService();
const paymentsService = new PaymentsService();

test('Billing MVP: Decimal Precision, Tax Architecture, Invoices, Payments, and Transactions', async (t) => {
  const ts = Date.now();

  await t.test('1. Arbitrary-precision Decimal Math (Zero Floating Point Drift)', async () => {
    // JavaScript floating point proof of bug: 0.1 + 0.2 === 0.30000000000000004
    assert.notEqual(0.1 + 0.2, 0.3);

    // Our Decimal math guarantees exact 0.30
    const decResult = toMoneyDecimal(0.1).plus(toMoneyDecimal(0.2)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    assert.equal(decResult.toFixed(2), '0.30');

    // Test item calculation with fractional percentages
    // ₹799.00 plan, 18% GST
    // Taxable: 799.00
    // Tax: 799 * 0.18 = 143.82
    // Total: 942.82
    const calc = calculateInvoiceTotals({
      items: [
        {
          description: 'High Speed Fiber 100M',
          sacCode: '998422',
          quantity: 1,
          unitPrice: '799.00',
          taxRatePercent: '18.00',
        },
      ],
      isIntraState: true,
    });

    assert.equal(calc.subtotal, '799.00');
    assert.equal(calc.cgstRatePercent, '9.00');
    assert.equal(calc.cgstAmount, '71.91');
    assert.equal(calc.sgstRatePercent, '9.00');
    assert.equal(calc.sgstAmount, '71.91');
    assert.equal(calc.igstAmount, '0.00');
    assert.equal(calc.totalTaxAmount, '143.82');
    assert.equal(calc.totalAmount, '942.82');
  });

  await t.test('2. Tax-Ready Architecture: Intra-State (CGST+SGST) vs Inter-State (IGST)', async () => {
    // Inter-state: ISP in Maharashtra, customer in Gujarat
    const interStateCalc = calculateInvoiceTotals({
      items: [
        {
          description: 'Dedicated Leased Line 1Gbps',
          quantity: 1,
          unitPrice: '10000.00',
          discountAmount: '1000.00', // Item discount: Taxable = 9000.00
        },
      ],
      invoiceDiscountAmount: '500.00', // Invoice discount: Net taxable = 8500.00
      isIntraState: false, // Inter-state
    });

    assert.equal(interStateCalc.subtotal, '9000.00');
    assert.equal(interStateCalc.discountAmount, '500.00');
    assert.equal(interStateCalc.taxableSubtotal, '8500.00');
    assert.equal(interStateCalc.cgstAmount, '0.00');
    assert.equal(interStateCalc.sgstAmount, '0.00');
    assert.equal(interStateCalc.igstRatePercent, '18.00');
    // 8500 * 18% = 1530.00
    assert.equal(interStateCalc.igstAmount, '1530.00');
    assert.equal(interStateCalc.totalAmount, '10030.00');
  });

  // Setup Organizations and Customers for DB tests
  const org1Result = await authService.registerOrganization({
    name: `Apex Broadband ${ts}`,
    slug: `apex-${ts}`,
    email: `billing@apex-${ts}.com`,
    phone: '9876540001',
    state: 'Maharashtra',
    stateCode: '27',
    ownerName: 'Apex Billing Owner',
    ownerEmail: `admin.${ts}@apex.com`,
    ownerPassword: 'Password123!',
  });
  const org1Id = org1Result.user.organizationId;
  const admin1Id = org1Result.user.id;

  const org2Result = await authService.registerOrganization({
    name: `Velocity Net ${ts}`,
    slug: `velocity-${ts}`,
    email: `billing@velocity-${ts}.com`,
    phone: '9876540002',
    state: 'Karnataka',
    stateCode: '29',
    ownerName: 'Velocity Owner',
    ownerEmail: `admin.${ts}@velocity.com`,
    ownerPassword: 'Password123!',
  });
  const org2Id = org2Result.user.organizationId;

  // Create intra-state customer in Org 1 (Maharashtra)
  const cust1 = await customersService.create(org1Id, admin1Id, {
    name: 'Rahul Sharma',
    customerCode: `CUST-MH-${ts}`,
    mobile: '9820011223',
    address: 'Andheri West, Mumbai',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400053',
    username: `rahul_${ts}`,
    pppoePassword: 'pass_rahul_123',
    status: CustomerStatus.ACTIVE,
  });

  // Create inter-state customer in Org 1 (Gujarat)
  const cust2 = await customersService.create(org1Id, admin1Id, {
    name: 'Priya Patel',
    customerCode: `CUST-GJ-${ts}`,
    mobile: '9898011224',
    address: 'Navrangpura, Ahmedabad',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380009',
    username: `priya_${ts}`,
    pppoePassword: 'pass_priya_123',
    status: CustomerStatus.SUSPENDED, // Will test reactivation
  });

  let intraInvoice;
  let interInvoice;

  await t.test('3. Create Invoice: Auto-Numbering, Items, Intra-State CGST+SGST, Transaction Safety', async () => {
    intraInvoice = await invoicesService.create(org1Id, admin1Id, {
      customerId: cust1.id,
      notes: 'Monthly billing for high-speed fiber',
      items: [
        {
          description: 'Fiber Ultra 100 Mbps',
          sacCode: '998422',
          quantity: 1,
          unitPrice: '1000.00',
        },
      ],
    });

    assert.ok(intraInvoice.id);
    assert.ok(intraInvoice.invoiceNumber.startsWith('INV-'));
    assert.equal(intraInvoice.status, InvoiceStatus.ISSUED);
    assert.equal(intraInvoice.subtotal, '1000.00');
    assert.equal(intraInvoice.cgstAmount, '90.00');
    assert.equal(intraInvoice.sgstAmount, '90.00');
    assert.equal(intraInvoice.igstAmount, '0.00');
    assert.equal(intraInvoice.totalAmount, '1180.00');
    assert.equal(intraInvoice.paidAmount, '0.00');
    assert.equal(intraInvoice.balanceDue, '1180.00');
    assert.equal(intraInvoice.items.length, 1);
    assert.equal(intraInvoice.items[0].sacCode, '998422');

    // Verify AuditLog was recorded
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org1Id, entityId: intraInvoice.id },
    });
    assert.ok(audit);
    assert.equal(audit.action, 'GENERATE_INVOICE');
  });

  await t.test('4. Create Invoice: Inter-State IGST Architecture', async () => {
    interInvoice = await invoicesService.create(org1Id, admin1Id, {
      customerId: cust2.id,
      notes: 'Interstate leased line connection',
      items: [
        {
          description: 'Enterprise Leased Line',
          sacCode: '998422',
          quantity: 1,
          unitPrice: '2000.00',
        },
      ],
    });

    assert.ok(interInvoice.id);
    assert.equal(interInvoice.status, InvoiceStatus.ISSUED);
    assert.equal(interInvoice.subtotal, '2000.00');
    assert.equal(interInvoice.cgstAmount, '0.00');
    assert.equal(interInvoice.sgstAmount, '0.00');
    assert.equal(interInvoice.igstAmount, '360.00');
    assert.equal(interInvoice.totalAmount, '2360.00');
    assert.equal(interInvoice.balanceDue, '2360.00');
  });

  await t.test('5. Partial Payment Settlement: PARTIALLY_PAID Status & Balance Due', async () => {
    // Total is ₹1,180.00. Make partial payment of ₹500.00
    const payment1 = await paymentsService.recordPayment(org1Id, admin1Id, {
      customerId: cust1.id,
      invoiceId: intraInvoice.id,
      amount: '500.00',
      paymentMethod: PaymentMethod.UPI,
      transactionRef: `UPI-REF-${ts}-1`,
      notes: 'First installment via UPI',
    });

    assert.ok(payment1.id);
    assert.ok(payment1.receiptNumber.startsWith('RCPT-'));
    assert.equal(payment1.amount, '500.00');
    assert.equal(payment1.settlement.newPaidAmount, '500.00');
    assert.equal(payment1.settlement.balanceDue, '680.00');
    assert.equal(payment1.settlement.targetStatus, InvoiceStatus.PARTIALLY_PAID);

    // Verify invoice in DB
    const fetched = await invoicesService.getById(org1Id, intraInvoice.id);
    assert.equal(fetched.status, InvoiceStatus.PARTIALLY_PAID);
    assert.equal(fetched.paidAmount, '500.00');
    assert.equal(fetched.balanceDue, '680.00');
    assert.equal(fetched.payments.length, 1);
  });

  await t.test('6. Overpayment Prevention: Strictly Rejects Payments Exceeding Balance Due', async () => {
    // Remaining balance is ₹680.00. Attempt to pay ₹700.00
    await assert.rejects(
      async () => {
        await paymentsService.recordPayment(org1Id, admin1Id, {
          customerId: cust1.id,
          invoiceId: intraInvoice.id,
          amount: '700.00',
          paymentMethod: PaymentMethod.CASH,
        });
      },
      {
        name: 'BadRequestException',
        message: /exceeds outstanding balance due/,
      },
    );

    // Verify invoice remains PARTIALLY_PAID with ₹680 balance
    const fetched = await invoicesService.getById(org1Id, intraInvoice.id);
    assert.equal(fetched.status, InvoiceStatus.PARTIALLY_PAID);
    assert.equal(fetched.paidAmount, '500.00');
    assert.equal(fetched.balanceDue, '680.00');
  });

  await t.test('7. Full Payment Settlement: PAID Status & Zero Balance', async () => {
    // Pay exact remaining balance: ₹680.00
    const payment2 = await paymentsService.recordPayment(org1Id, admin1Id, {
      customerId: cust1.id,
      invoiceId: intraInvoice.id,
      amount: '680.00',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      transactionRef: `NEFT-${ts}-2`,
    });

    assert.equal(payment2.settlement.newPaidAmount, '1180.00');
    assert.equal(payment2.settlement.balanceDue, '0.00');
    assert.equal(payment2.settlement.targetStatus, InvoiceStatus.PAID);
    assert.equal(payment2.settlement.isFullyPaid, true);

    const fetched = await invoicesService.getById(org1Id, intraInvoice.id);
    assert.equal(fetched.status, InvoiceStatus.PAID);
    assert.equal(fetched.paidAmount, '1180.00');
    assert.equal(fetched.balanceDue, '0.00');
    assert.ok(fetched.paidAt);
    assert.equal(fetched.payments.length, 2);
  });

  await t.test('8. Full Payment Auto-Reactivates Suspended Customer and Restores FreeRADIUS', async () => {
    // Customer 2 was SUSPENDED
    const custBefore = await prisma.customer.findUnique({ where: { id: cust2.id } });
    assert.equal(custBefore.status, CustomerStatus.SUSPENDED);

    // Pay interInvoice in full: ₹2360.00
    await paymentsService.recordPayment(org1Id, admin1Id, {
      customerId: cust2.id,
      invoiceId: interInvoice.id,
      amount: '2360.00',
      paymentMethod: PaymentMethod.CASH,
      notes: 'Cash collected at subscriber doorstep',
    });

    // Verify customer is now ACTIVE
    const custAfter = await prisma.customer.findUnique({ where: { id: cust2.id } });
    assert.equal(custAfter.status, CustomerStatus.ACTIVE);

    // Verify FreeRADIUS radcheck was restored
    const radcheck = await prisma.radCheck.findFirst({
      where: { username: cust2.username, attribute: 'Cleartext-Password' },
    });
    assert.ok(radcheck);
    assert.equal(radcheck.value, custAfter.pppoePassword);
    assert.equal(radcheck.value, 'pass_priya_123');
  });

  await t.test('9. Invoice Draft and Cancellation Flow', async () => {
    // Create draft invoice
    const draftInvoice = await invoicesService.create(org1Id, admin1Id, {
      customerId: cust1.id,
      status: InvoiceStatus.DRAFT,
      items: [
        {
          description: 'Static IP addon',
          quantity: 1,
          unitPrice: '200.00',
        },
      ],
    });
    assert.equal(draftInvoice.status, InvoiceStatus.DRAFT);

    // Cancel draft invoice
    const cancelled = await invoicesService.cancel(org1Id, admin1Id, draftInvoice.id, 'Customer opted out');
    assert.equal(cancelled.status, InvoiceStatus.CANCELLED);

    // Verify cannot pay cancelled invoice
    await assert.rejects(
      async () => {
        await paymentsService.recordPayment(org1Id, admin1Id, {
          customerId: cust1.id,
          invoiceId: cancelled.id,
          amount: '200.00',
        });
      },
      {
        name: 'BadRequestException',
        message: /cancelled/,
      },
    );

    // Verify cannot cancel fully paid invoice
    await assert.rejects(
      async () => {
        await invoicesService.cancel(org1Id, admin1Id, intraInvoice.id, 'Accidental cancel');
      },
      {
        name: 'BadRequestException',
        message: /Cannot cancel a fully paid invoice/,
      },
    );
  });

  await t.test('10. Tenant Isolation: Org 2 cannot read or pay Org 1 Invoices', async () => {
    // Org 2 tries to get Org 1's invoice
    await assert.rejects(
      async () => {
        await invoicesService.getById(org2Id, intraInvoice.id);
      },
      {
        name: 'NotFoundException',
      },
    );

    // Org 2 tries to record payment on Org 1's invoice
    await assert.rejects(
      async () => {
        await paymentsService.recordPayment(org2Id, undefined, {
          customerId: cust1.id,
          invoiceId: intraInvoice.id,
          amount: '100.00',
        });
      },
      {
        name: 'NotFoundException',
      },
    );
  });
});
