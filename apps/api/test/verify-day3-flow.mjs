import assert from 'node:assert/strict';
import { prisma } from '@isp-crm/database';
import { Decimal } from 'decimal.js';

const API_BASE = 'http://localhost:4000/api';
const WEB_BASE = 'http://localhost:3000';

const getJson = async (res) => {
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
};

async function runDay3FlowCheck() {
  console.log('===============================================================');
  console.log('🧪 DAY 3 DELIVERABLE END-TO-END FLOW VERIFICATION');
  console.log('   Customer ➔ Plan ➔ Subscription ➔ Invoice ➔ Payment ➔ ACTIVE');
  console.log('===============================================================\n');

  // Step 0: Authenticate
  console.log('🔑 Step 0: Authenticating as ISP Admin (admin@speednet.in)...');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@speednet.in',
      password: 'admin123',
    }),
  });
  assert.equal(loginRes.status, 200, 'Admin login failed');
  const authPayload = await getJson(loginRes);
  const token = authPayload.accessToken;
  const orgId = authPayload.user?.organizationId;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  console.log(`   ✅ Logged in successfully. Organization ID: ${orgId}\n`);

  const ts = Date.now();

  // Step 1: Customer (Created with PENDING status for new onboarding)
  console.log('👤 Step 1: Creating New Customer (Initial Status: PENDING)...');
  const custRes = await fetch(`${API_BASE}/customers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `Day3 Flow User ${ts}`,
      customerCode: `CUST-D3-${ts}`,
      mobile: '9820011223',
      email: `day3.${ts}@example.com`,
      address: 'Flat 402, Sea Breeze Apts, Bandra West',
      area: 'Bandra',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400050',
      username: `user_d3_${ts}`,
      pppoePassword: 'pass_secret_d3',
      status: 'PENDING',
      notes: 'New broadband subscriber onboarding test',
    }),
  });
  assert.equal(custRes.status, 201, 'Failed to create customer');
  const customer = await getJson(custRes);
  console.log(`   ✅ Customer Created:`);
  console.log(`      - ID: ${customer.id}`);
  console.log(`      - Code: ${customer.customerCode}`);
  console.log(`      - Username: ${customer.username}`);
  console.log(`      - Status: ${customer.status}\n`);
  assert.equal(customer.status, 'PENDING');

  // Step 2: Plan
  console.log('📦 Step 2: Creating / Selecting Internet Plan (100 Mbps - ₹799)...');
  const planRes = await fetch(`${API_BASE}/plans`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `Turbo Fiber 100M ${ts}`,
      code: `TURBO-100-${ts}`,
      downloadSpeed: 100,
      uploadSpeed: 50,
      speedUnit: 'MBPS',
      price: 799,
      validityDays: 30,
      billingCycle: 'MONTHLY',
      status: 'ACTIVE',
      description: 'High-speed broadband with 100 Mbps speed',
    }),
  });
  assert.equal(planRes.status, 201, 'Failed to create plan');
  const plan = await getJson(planRes);
  console.log(`   ✅ Plan Created:`);
  console.log(`      - Name: ${plan.name} (${plan.code})`);
  console.log(`      - Speed: ${plan.downloadSpeed} ${plan.speedUnit} down / ${plan.uploadSpeed} ${plan.speedUnit} up`);
  console.log(`      - Price: ₹${plan.price} / ${plan.billingCycle} (${plan.validityDays} days)\n`);

  // Step 3: Subscription (Created for Customer with Plan)
  console.log('📋 Step 3: Creating Subscription for Customer (Initial Status: PENDING)...');
  const subRes = await fetch(`${API_BASE}/subscriptions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: customer.id,
      planId: plan.id,
      status: 'PENDING',
      billingCycle: 'MONTHLY',
    }),
  });
  assert.equal(subRes.status, 201, 'Failed to create subscription');
  const subscription = await getJson(subRes);
  console.log(`   ✅ Subscription Created:`);
  console.log(`      - ID: ${subscription.id}`);
  console.log(`      - Status: ${subscription.status}`);
  console.log(`      - Start Date: ${subscription.startDate}`);
  console.log(`      - End Date: ${subscription.endDate}\n`);
  assert.equal(subscription.status, 'PENDING');

  // Verify RADIUS before payment (should NOT be active)
  const radCheckBefore = await prisma.radCheck.findFirst({
    where: { username: customer.username, attribute: 'Cleartext-Password' },
  });
  console.log(`   🔍 FreeRADIUS Check Before Payment: ${radCheckBefore ? 'EXISTS' : 'NOT_FOUND (PPPoE Inactive as expected)'}\n`);

  // Step 4: Invoice (Generated for the Subscription)
  console.log('🧾 Step 4: Generating Invoice for Subscription (₹799 + 18% GST)...');
  const invRes = await fetch(`${API_BASE}/invoices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: customer.id,
      subscriptionId: subscription.id,
      notes: 'Initial activation invoice for Turbo Fiber 100M',
      items: [
        {
          description: `${plan.name} (SAC 998422)`,
          sacCode: '998422',
          quantity: 1,
          unitPrice: '799.00',
        },
      ],
    }),
  });
  assert.equal(invRes.status, 201, 'Failed to generate invoice');
  const invoice = await getJson(invRes);
  console.log(`   ✅ Invoice Generated:`);
  console.log(`      - Number: ${invoice.invoiceNumber}`);
  console.log(`      - Status: ${invoice.status}`);
  console.log(`      - Subtotal: ₹${invoice.subtotal}`);
  console.log(`      - GST Tax: CGST ₹${invoice.cgstAmount} + SGST ₹${invoice.sgstAmount} (Total Tax: ₹${new Decimal(invoice.cgstAmount).plus(invoice.sgstAmount).toFixed(2)})`);
  console.log(`      - Total Amount: ₹${invoice.totalAmount}`);
  console.log(`      - Balance Due: ₹${invoice.balanceDue}\n`);
  assert.equal(invoice.status, 'ISSUED');
  assert.equal(invoice.totalAmount, '942.82');
  assert.equal(invoice.balanceDue, '942.82');

  // Step 5: Payment (Simulating Payment Gateway via MockPaymentProvider)
  console.log('💳 Step 5: Customer clicks "Pay" ➔ Initiating Payment Intent & Gateway Settlement...');
  const intentRes = await fetch(`${API_BASE}/payments/create-intent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      invoiceId: invoice.id,
    }),
  });
  assert.equal(intentRes.status, 201, 'Failed to create payment intent');
  const intent = await getJson(intentRes);
  console.log(`   ✅ Gateway Intent Created:`);
  console.log(`      - Gateway Order ID: ${intent.gatewayOrderId}`);
  console.log(`      - Checkout URL: ${intent.paymentUrl}`);
  console.log(`      - Payable Amount: ₹${intent.amount}`);

  // Gateway Callback verification
  const gatewayPaymentId = `mock_pay_d3_${ts}`;
  const idemKey = `idem_d3_${ts}`;
  console.log(`   Verifying payment callback (Gateway Payment ID: ${gatewayPaymentId})...`);
  const verifyRes = await fetch(`${API_BASE}/payments/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      invoiceId: invoice.id,
      gatewayOrderId: intent.gatewayOrderId,
      gatewayPaymentId: gatewayPaymentId,
      signature: 'valid_mock_signature',
      idempotencyKey: idemKey,
    }),
  });
  assert.ok(verifyRes.status === 200 || verifyRes.status === 201, 'Payment verification failed');
  const settlement = await getJson(verifyRes);
  console.log(`   ✅ Payment Settled Successfully:`);
  console.log(`      - Payment ID: ${settlement.payment.id}`);
  console.log(`      - Payment Status: ${settlement.payment.status}`);
  console.log(`      - Receipt Number: ${settlement.payment.receiptNumber}`);
  console.log(`      - Amount Paid: ₹${settlement.payment.amount}\n`);

  // Step 6: Verify Final ACTIVE State & Tri-State Sync
  console.log('🎯 Step 6: Verifying Complete System State (Customer ➔ Plan ➔ Subscription ➔ Invoice ➔ Payment ➔ ACTIVE)...');

  // 6.1 Check Invoice
  console.log('   Checking Invoice State:');
  const finalInvRes = await fetch(`${API_BASE}/invoices/${invoice.id}`, { headers });
  const finalInvoice = await getJson(finalInvRes);
  console.log(`      - Status: ${finalInvoice.status} (Expected: PAID)`);
  console.log(`      - Paid Amount: ₹${finalInvoice.paidAmount}`);
  console.log(`      - Balance Due: ₹${finalInvoice.balanceDue}`);
  assert.equal(finalInvoice.status, 'PAID');
  assert.equal(finalInvoice.balanceDue, '0.00');
  assert.equal(finalInvoice.paidAmount, '942.82');
  console.log(`      ✅ Invoice is PAID with 0.00 balance due.`);

  // 6.2 Check Payment
  console.log('   Checking Payment State:');
  const finalPayRes = await fetch(`${API_BASE}/payments/${settlement.payment.id}`, { headers });
  const finalPayment = await getJson(finalPayRes);
  console.log(`      - Status: ${finalPayment.status} (Expected: SUCCESS)`);
  console.log(`      - Method: ${finalPayment.paymentMethod}`);
  console.log(`      - Gateway Payment ID: ${finalPayment.gatewayPaymentId}`);
  assert.equal(finalPayment.status, 'SUCCESS');
  console.log(`      ✅ Payment is SUCCESS.`);

  // 6.3 Check Subscription
  console.log('   Checking Subscription State:');
  const finalSubRes = await fetch(`${API_BASE}/subscriptions/${subscription.id}`, { headers });
  const finalSub = await getJson(finalSubRes);
  console.log(`      - Status: ${finalSub.status} (Expected: ACTIVE)`);
  console.log(`      - Start Date: ${finalSub.startDate}`);
  console.log(`      - End Date: ${finalSub.endDate}`);
  assert.equal(finalSub.status, 'ACTIVE');
  const subEndDate = new Date(finalSub.endDate);
  assert.ok(subEndDate > new Date(), 'Subscription endDate must be in the future');
  console.log(`      ✅ Subscription is ACTIVE (Valid until: ${finalSub.endDate}).`);

  // 6.4 Check Customer Status
  console.log('   Checking Customer State:');
  const finalCustRes = await fetch(`${API_BASE}/customers/${customer.id}`, { headers });
  const finalCust = await getJson(finalCustRes);
  console.log(`      - Status: ${finalCust.status} (Expected: ACTIVE)`);
  assert.equal(finalCust.status, 'ACTIVE');
  console.log(`      ✅ Customer status is ACTIVE.`);

  // 6.5 Check Subscription History
  console.log('   Checking Subscription Audit History:');
  const subHistory = await prisma.subscriptionHistory.findFirst({
    where: { subscriptionId: subscription.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(subHistory, 'Subscription history not found');
  console.log(`      - Action: ${subHistory.action}`);
  console.log(`      - From Status: ${subHistory.fromStatus} ➔ To Status: ${subHistory.toStatus}`);
  console.log(`      - Reason: ${subHistory.reason}`);
  assert.equal(subHistory.toStatus, 'ACTIVE');
  console.log(`      ✅ Audit history correctly recorded.`);

  // 6.6 Check FreeRADIUS Authentication Table
  console.log('   Checking FreeRADIUS radcheck PPPoE Credentials:');
  const radCheckAfter = await prisma.radCheck.findFirst({
    where: { username: customer.username, attribute: 'Cleartext-Password' },
  });
  assert.ok(radCheckAfter, 'FreeRADIUS radcheck credential missing');
  console.log(`      - Username: ${radCheckAfter.username}`);
  console.log(`      - Attribute: ${radCheckAfter.attribute}`);
  console.log(`      - Value: [Secured]`);
  assert.equal(radCheckAfter.value, 'pass_secret_d3');
  console.log(`      ✅ FreeRADIUS PPPoE authentication entry is ACTIVE in PostgreSQL radcheck table.`);

  // 6.7 Check Web Frontend
  console.log('\n🌐 Checking Web UI Endpoints:');
  const pages = ['/customers', '/plans', '/subscriptions', '/invoices'];
  for (const page of pages) {
    const pageRes = await fetch(`${WEB_BASE}${page}`);
    assert.equal(pageRes.status, 200, `Page ${page} failed`);
    console.log(`   ✅ Web Page ${WEB_BASE}${page} ➔ HTTP 200 OK`);
  }

  console.log('\n===============================================================');
  console.log('🎉 DAY 3 FLOW FULLY VERIFIED AND WORKING 100%!');
  console.log('   Customer ➔ Plan ➔ Subscription ➔ Invoice ➔ Payment ➔ ACTIVE');
  console.log('===============================================================');
}

runDay3FlowCheck().catch((err) => {
  console.error('\n❌ Day 3 Flow Verification Failed:', err);
  process.exit(1);
});
