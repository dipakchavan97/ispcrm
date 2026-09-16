import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { CustomersController } from '../dist/modules/customers/customers.controller.js';
import { CafPdfService } from '../dist/modules/customers/caf-pdf.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import { SubscriptionsService } from '../dist/modules/subscriptions/subscriptions.service.js';
import { InvoicesService } from '../dist/modules/invoices/invoices.service.js';
import {
  CustomerStatus,
  BillingCycle,
  SpeedUnit,
  PlanStatus,
} from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';

/**
 * Robustly extracts decoded text from all PDF streams using PDF stream dictionary Length
 */
function extractCleanPdfText(buf) {
  let pos = 0;
  let allDecompressed = '';

  while ((pos = buf.indexOf(Buffer.from('stream'), pos)) !== -1) {
    const dictStart = buf.lastIndexOf(Buffer.from('<<'), pos);
    const dict = buf.slice(dictStart, pos).toString('ascii');
    const lenMatch = /Length\s+(\d+)/.exec(dict);

    let start = pos + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;

    if (lenMatch) {
      const len = parseInt(lenMatch[1], 10);
      const streamBuf = buf.slice(start, start + len);
      try {
        const decomp = zlib.inflateSync(streamBuf).toString('latin1');
        allDecompressed += decomp + '\n';
      } catch (e) {
        // Fallback: try raw slice if uncompressed
        allDecompressed += streamBuf.toString('latin1') + '\n';
      }
      pos = start + len;
    } else {
      // If no length, search for endstream
      const endPos = buf.indexOf(Buffer.from('endstream'), start);
      if (endPos !== -1) {
        const streamBuf = buf.slice(start, endPos);
        try {
          const decomp = zlib.inflateSync(streamBuf).toString('latin1');
          allDecompressed += decomp + '\n';
        } catch (e) {
          allDecompressed += streamBuf.toString('latin1') + '\n';
        }
        pos = endPos + 9;
      } else {
        pos += 6;
      }
    }
  }

  // Extract text from PDFKit TJ arrays: [<hex...> number <hex...>] TJ
  let extractedText = '';
  const tjRegex = /\[([\s\S]*?)\]\s*TJ/g;
  let m;
  while ((m = tjRegex.exec(allDecompressed)) !== null) {
    const inside = m[1];
    const hexRegex = /<([0-9a-fA-F]+)>/g;
    let h;
    while ((h = hexRegex.exec(inside)) !== null) {
      const hex = h[1];
      for (let i = 0; i < hex.length; i += 2) {
        extractedText += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      }
    }
    extractedText += ' ';
  }

  return {
    raw: buf.toString('latin1'),
    decompressed: allDecompressed,
    text: extractedText,
    all: buf.toString('latin1') + '\n' + allDecompressed + '\n' + extractedText,
  };
}

/**
 * Mock Express Response object for controller unit tests
 */
function createMockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end(data) {
      this.body = data;
    },
  };
}

const authService = new AuthService();
const customersService = new CustomersService();
const cafPdfService = new CafPdfService();
const customersController = new CustomersController(customersService, cafPdfService);
const plansService = new PlansService();
const invoicesService = new InvoicesService();
const subscriptionsService = new SubscriptionsService(undefined, invoicesService);

test('P1 CAF — Backend Customer Application Form PDF Generator Suite', async (t) => {
  const ts = Date.now();

  // ---------------------------------------------------------------------------
  // 1. Setup Tenant Organizations
  // ---------------------------------------------------------------------------
  const org1Result = await authService.registerOrganization({
    name: `Spacecom Networks ${ts}`,
    slug: `spacecom-${ts}`,
    email: `support@spacecom-${ts}.net`,
    phone: '9820011223',
    ownerName: 'Spacecom Admin',
    ownerEmail: `admin.${ts}@spacecom.net`,
    ownerPassword: 'Password123!',
  });
  const org1Id = org1Result.user.organizationId;
  const admin1UserId = org1Result.user.id;

  // Add rich organization metadata (GSTIN, legal name, address)
  await prisma.organization.update({
    where: { id: org1Id },
    data: {
      legalName: `Spacecom Internet Private Limited ${ts}`,
      gstin: '27AABCS1429B1Z',
      state: 'Maharashtra',
      stateCode: '27',
      address: 'Plot 42, Hinjewadi Phase 1',
      city: 'Pune',
      pincode: '411057',
    },
  });

  // Second isolated tenant
  const org2Result = await authService.registerOrganization({
    name: `SkyWire Telecom ${ts}`,
    slug: `skywire-${ts}`,
    email: `info@skywire-${ts}.in`,
    phone: '9820099887',
    ownerName: 'SkyWire Admin',
    ownerEmail: `admin.${ts}@skywire.in`,
    ownerPassword: 'Password123!',
  });
  const org2Id = org2Result.user.organizationId;

  // ---------------------------------------------------------------------------
  // 2. Setup Plans
  // ---------------------------------------------------------------------------
  const fastPlan = await plansService.create(org1Id, admin1UserId, {
    name: 'Fiber Blaster 100M',
    code: `BLASTER-100M-${ts}`,
    downloadSpeed: 100,
    uploadSpeed: 50,
    speedUnit: SpeedUnit.MBPS,
    price: 799,
    validityDays: 30,
    billingCycle: BillingCycle.MONTHLY,
    status: PlanStatus.ACTIVE,
  });

  // ---------------------------------------------------------------------------
  // 3. Create Full Featured Customer with Aadhaar, GSTIN, and Addresses
  // ---------------------------------------------------------------------------
  const RAW_AADHAAR = '556677889901';
  const PPPOE_SECRET = 'SuperSecretPPPoE999!';

  const fullCustomer = await customersService.create(org1Id, admin1UserId, {
    customerCode: `CAF-CUST-${ts}`,
    name: 'Rajesh Ramchandra Sharma',
    mobile: '9876543210',
    phone: '02025678901',
    alternatePhone: '9876500000',
    email: `rajesh.${ts}@example.com`,
    address: 'Flat 502, Orchid Residency, Shivaji Nagar',
    installationAddress: 'Shop 12, Commercial Plaza, FC Road',
    area: 'Shivaji Nagar',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411005',
    username: `rajesh_sharma_${ts}`,
    pppoePassword: PPPOE_SECRET,
    staticIp: '10.100.20.15',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    status: CustomerStatus.ACTIVE,
  });

  // Explicitly update aadhaar, gstin, and installationAddress on customer in DB
  await prisma.customer.update({
    where: { id: fullCustomer.id },
    data: {
      aadhaarNumber: RAW_AADHAAR,
      gstin: '27AABCS9999Z1Z5',
      installationAddress: 'Shop 12, Commercial Plaza, FC Road',
    },
  });


  // Assign subscription plan
  await subscriptionsService.create(org1Id, admin1UserId, {
    customerId: fullCustomer.id,
    planId: fastPlan.id,
    startDate: new Date().toISOString(),
  });

  // ---------------------------------------------------------------------------
  // 4. Create Minimal Customer (Missing All Optional Fields)
  // ---------------------------------------------------------------------------
  const minimalCustomer = await customersService.create(org1Id, admin1UserId, {
    customerCode: `MIN-CUST-${ts}`,
    name: 'Amit Verma',
    mobile: '9123456780',
    username: `amit_verma_${ts}`,
    pppoePassword: 'SimplePassword1!',
    status: CustomerStatus.ACTIVE,
  });

  // ===========================================================================
  // TEST 1: Authorized Tenant Generates Valid CAF PDF Buffer
  // ===========================================================================
  await t.test('1. Authorized tenant can generate valid CAF PDF with magic bytes', async () => {
    const { buffer, filename } = await cafPdfService.generateCafPdf(org1Id, fullCustomer.id);

    assert.ok(Buffer.isBuffer(buffer), 'Result buffer must be a Node.js Buffer');
    assert.ok(buffer.length > 5000, `Buffer length must be > 5KB, got ${buffer.length}`);

    // Magic bytes check (%PDF-)
    const headerStr = buffer.slice(0, 5).toString('ascii');
    assert.equal(headerStr, '%PDF-', 'PDF buffer must begin with %PDF- magic bytes');

    // Filename convention check
    assert.ok(filename.startsWith(`CAF-${fullCustomer.customerCode}`), `Filename must start with CAF reference, got ${filename}`);
    assert.ok(filename.endsWith('.pdf'), 'Filename must end with .pdf');
  });

  // ===========================================================================
  // TEST 2: Strict Tenant Isolation Enforcement
  // ===========================================================================
  await t.test('2. Tenant isolation: Tenant 2 CANNOT access or generate Tenant 1 customer CAF', async () => {
    await assert.rejects(
      async () => {
        await cafPdfService.generateCafPdf(org2Id, fullCustomer.id);
      },
      (err) => {
        assert.equal(err.status, 404, 'Must throw NotFoundException (404)');
        assert.match(err.message, /not found in your organization/i);
        return true;
      },
      'Cross-tenant CAF generation must be rejected with 404',
    );
  });

  // ===========================================================================
  // TEST 3: Non-existent Customer Rejection
  // ===========================================================================
  await t.test('3. Non-existent customer ID throws 404', async () => {
    await assert.rejects(
      async () => {
        await cafPdfService.generateCafPdf(org1Id, '00000000-0000-0000-0000-000000000000');
      },
      (err) => {
        assert.equal(err.status, 404);
        return true;
      },
    );
  });

  // ===========================================================================
  // TEST 4: Sensitive Data & Secret Leakage Prevention
  // ===========================================================================
  await t.test('4. Security: Raw Aadhaar, PPPoE passwords, and secrets NEVER appear in PDF', async () => {
    const { buffer } = await cafPdfService.generateCafPdf(org1Id, fullCustomer.id);
    const ext = extractCleanPdfText(buffer);

    // 1. Raw 12-digit Aadhaar must NOT exist in the buffer
    assert.equal(
      ext.all.includes(RAW_AADHAAR),
      false,
      `Raw Aadhaar '${RAW_AADHAAR}' must NEVER appear in the PDF output`,
    );

    // 2. Masked Aadhaar MUST appear (XXXX-XXXX-9901)
    const expectedMasked = `XXXX-XXXX-${RAW_AADHAAR.slice(-4)}`;
    assert.ok(
      ext.text.includes(expectedMasked),
      `Masked Aadhaar '${expectedMasked}' must appear in the PDF`,
    );

    // 3. PPPoE Password must NEVER appear in the buffer
    assert.equal(
      ext.all.includes(PPPOE_SECRET),
      false,
      `PPPoE password '${PPPOE_SECRET}' must NEVER appear in the PDF output`,
    );

    // 4. Check for arbitrary router/radius secret strings
    assert.equal(ext.all.includes('Password123!'), false, 'Admin password must never leak in PDF');
  });

  // ===========================================================================
  // TEST 5: Customer, Organization & Plan Data Verification in PDF
  // ===========================================================================
  await t.test('5. Customer, Organization, and Plan data appear accurately in CAF PDF', async () => {
    const { buffer } = await cafPdfService.generateCafPdf(org1Id, fullCustomer.id);
    const ext = extractCleanPdfText(buffer);

    // Organization data (matches case-insensitively)
    assert.match(ext.text, /Spacecom Internet Private Limited/i, 'Legal organization name must appear');
    assert.ok(ext.text.includes('27AABCS1429B1Z'), 'Organization GSTIN must appear');
    assert.ok(ext.text.includes('Hinjewadi'), 'Organization address must appear');

    // Customer Identity
    assert.ok(ext.text.includes('Rajesh Ramchandra Sharma'), 'Customer full name must appear');
    assert.ok(ext.text.includes(fullCustomer.customerCode), 'Customer account code must appear');
    assert.ok(ext.text.includes('9876543210'), 'Primary mobile must appear');
    assert.ok(ext.text.includes('Shivaji Nagar'), 'Area must appear');

    // Customer Premise
    assert.ok(ext.text.includes('Commercial Plaza'), 'Installation address must appear');

    // Subscription & Plan
    assert.ok(ext.text.includes('Fiber Blaster 100M'), 'Plan name must appear');
    assert.ok(ext.text.includes('100 Mbps'), 'Download speed must appear');
    assert.ok(ext.text.includes('50 Mbps'), 'Upload speed must appear');

    // Network specs
    assert.ok(ext.text.includes(fullCustomer.username), 'PPPoE username must appear');
    assert.ok(ext.text.includes('10.100.20.15'), 'Static IP must appear');
    assert.ok(ext.text.includes('AA:BB:CC:DD:EE:FF'), 'MAC address must appear');

    // Statutory Declarations & Undertaking
    assert.ok(ext.text.includes('SUBSCRIBER DECLARATION'), 'Subscriber declaration heading must appear');
    assert.ok(ext.text.includes('Indian Telegraph Act'), 'Statutory telecom compliance reference must appear');
    assert.ok(ext.text.includes('APPLICANT / SUBSCRIBER SIGNATURE'), 'Applicant signature area must appear');
    assert.ok(ext.text.includes('AUTHORIZED SIGNATORY'), 'Authorized signatory area must appear');
    assert.ok(ext.text.includes('PASSPORT SIZE'), 'Passport photo box placeholder must appear');
  });

  // ===========================================================================
  // TEST 6: Graceful Handling of Minimal Customer (Missing Optional Fields)
  // ===========================================================================
  await t.test('6. Missing optional fields (null Aadhaar, GSTIN, Address, Plan) generate cleanly', async () => {
    const { buffer, filename } = await cafPdfService.generateCafPdf(org1Id, minimalCustomer.id);

    assert.ok(Buffer.isBuffer(buffer), 'Must return valid Buffer for minimal customer');
    assert.ok(buffer.length > 5000, `Buffer length must be > 5KB, got ${buffer.length}`);

    const ext = extractCleanPdfText(buffer);
    assert.ok(ext.text.includes('Amit Verma'), 'Customer name must appear');
    assert.ok(ext.text.includes(minimalCustomer.customerCode), 'Customer code must appear');
    assert.ok(ext.text.includes('Not Provided') || ext.text.includes('—'), 'Missing Aadhaar must show fallback');
    assert.ok(ext.text.includes('Individual / Residential'), 'Default customer type must be Individual');
    assert.ok(filename.startsWith(`CAF-${minimalCustomer.customerCode}`), 'Filename convention maintained');
  });

  // ===========================================================================
  // TEST 7: Controller Endpoint HTTP Headers & Content-Disposition
  // ===========================================================================
  await t.test('7. CustomersController.downloadCafPdf handles headers and preview mode', async () => {
    // 1. Direct Download mode (preview=0 or omitted)
    const mockRes1 = createMockResponse();
    await customersController.downloadCafPdf(org1Id, fullCustomer.id, mockRes1, undefined);

    assert.equal(mockRes1.headers['Content-Type'], 'application/pdf');
    assert.ok(mockRes1.headers['Content-Disposition'].startsWith('attachment; filename="CAF-'));
    assert.ok(Number(mockRes1.headers['Content-Length']) > 5000);
    assert.ok(Buffer.isBuffer(mockRes1.body));

    // 2. Inline Preview mode (preview=true)
    const mockRes2 = createMockResponse();
    await customersController.downloadCafPdf(org1Id, fullCustomer.id, mockRes2, 'true');

    assert.equal(mockRes2.headers['Content-Type'], 'application/pdf');
    assert.ok(mockRes2.headers['Content-Disposition'].startsWith('inline; filename="CAF-'));
    assert.ok(Number(mockRes2.headers['Content-Length']) > 5000);
  });

  // ===========================================================================
  // TEST 8: Existing Customer Functionality Unaffected
  // ===========================================================================
  await t.test('8. Existing customer profile and list queries remain 100% operational', async () => {
    const fetched = await customersService.getById(org1Id, fullCustomer.id);
    assert.equal(fetched.id, fullCustomer.id);
    assert.equal(fetched.name, 'Rajesh Ramchandra Sharma');
    assert.ok(fetched.subscriptions.length >= 1);

    const listRes = await customersService.list(org1Id, { limit: 10 });
    assert.ok(listRes.items.length >= 2);
    assert.ok(listRes.total >= 2);
  });
});
