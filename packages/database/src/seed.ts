import {
  PrismaClient,
  UserRole,
  CustomerStatus,
  SubscriptionStatus,
  PlanStatus,
  BillingCycle,
  SpeedUnit,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial database...');

  // 1. Create Organization
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-isp' },
    update: {},
    create: {
      name: 'SpeedNet Broadband India',
      slug: 'demo-isp',
      legalName: 'SpeedNet Telecommunications Pvt Ltd',
      gstin: '27AAAAA0000A1Z5',
      email: 'admin@speednet.in',
      phone: '+919876543210',
      address: 'Shop 4, Market Complex, MG Road',
      city: 'Pune',
      state: 'Maharashtra',
      stateCode: '27',
      pincode: '411001',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
    },
  });

  // 2. Create Admin User
  await prisma.adminUser.upsert({
    where: {
      organizationId_email: {
        organizationId: org.id,
        email: 'admin@speednet.in',
      },
    },
    update: {
      passwordHash: '$2a$10$OjeNA9LiJqLlgYF3qnzJqO318zWH0gg6SMf0vUiD.DBsJ5t8Uxao.',
    },
    create: {
      organizationId: org.id,
      name: 'System Administrator',
      email: 'admin@speednet.in',
      passwordHash: '$2a$10$OjeNA9LiJqLlgYF3qnzJqO318zWH0gg6SMf0vUiD.DBsJ5t8Uxao.', // 'admin123'
      role: UserRole.ISP_OWNER,
      phone: '+919876543210',
    },
  });

  // 3. Create Sample Internet Plans (50 Mbps @ ₹499, 100 Mbps @ ₹799, 200 Mbps @ ₹999)
  const plan50M = await prisma.internetPlan.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'FIBER-50M',
      },
    },
    update: {
      price: 499.0,
      downloadSpeed: 50,
      uploadSpeed: 20,
      downloadSpeedMbps: 50,
      uploadSpeedMbps: 20,
      speedUnit: SpeedUnit.MBPS,
      billingCycle: BillingCycle.MONTHLY,
      status: PlanStatus.ACTIVE,
    },
    create: {
      organizationId: org.id,
      name: 'Fiber 50 Mbps - ₹499',
      code: 'FIBER-50M',
      description: 'Ideal for streaming, browsing, and remote work',
      downloadSpeed: 50,
      uploadSpeed: 20,
      downloadSpeedMbps: 50,
      uploadSpeedMbps: 20,
      speedUnit: SpeedUnit.MBPS,
      validityDays: 30,
      billingCycle: BillingCycle.MONTHLY,
      price: 499.0,
      status: PlanStatus.ACTIVE,
      gstRatePercent: 18.0,
      hsnSacCode: '998422',
    },
  });

  const plan100M = await prisma.internetPlan.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'FIBER-100M',
      },
    },
    update: {
      price: 799.0,
      downloadSpeed: 100,
      uploadSpeed: 50,
      downloadSpeedMbps: 100,
      uploadSpeedMbps: 50,
      speedUnit: SpeedUnit.MBPS,
      billingCycle: BillingCycle.MONTHLY,
      status: PlanStatus.ACTIVE,
    },
    create: {
      organizationId: org.id,
      name: 'Fiber 100 Mbps - ₹799',
      code: 'FIBER-100M',
      description: 'Ultra-fast broadband for multi-device 4K streaming and gaming',
      downloadSpeed: 100,
      uploadSpeed: 50,
      downloadSpeedMbps: 100,
      uploadSpeedMbps: 50,
      speedUnit: SpeedUnit.MBPS,
      validityDays: 30,
      billingCycle: BillingCycle.MONTHLY,
      price: 799.0,
      status: PlanStatus.ACTIVE,
      gstRatePercent: 18.0,
      hsnSacCode: '998422',
    },
  });

  const plan200M = await prisma.internetPlan.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'FIBER-200M',
      },
    },
    update: {
      price: 999.0,
      downloadSpeed: 200,
      uploadSpeed: 100,
      downloadSpeedMbps: 200,
      uploadSpeedMbps: 100,
      speedUnit: SpeedUnit.MBPS,
      billingCycle: BillingCycle.MONTHLY,
      status: PlanStatus.ACTIVE,
    },
    create: {
      organizationId: org.id,
      name: 'Fiber 200 Mbps - ₹999',
      code: 'FIBER-200M',
      description: 'Gigabit-ready symmetrical fiber for power users and small offices',
      downloadSpeed: 200,
      uploadSpeed: 100,
      downloadSpeedMbps: 200,
      uploadSpeedMbps: 100,
      speedUnit: SpeedUnit.MBPS,
      validityDays: 30,
      billingCycle: BillingCycle.MONTHLY,
      price: 999.0,
      status: PlanStatus.ACTIVE,
      gstRatePercent: 18.0,
      hsnSacCode: '998422',
    },
  });

  // 4. Create Sample Customer
  const customer = await prisma.customer.upsert({
    where: { username: 'rajesh_fiber' },
    update: {},
    create: {
      organizationId: org.id,
      customerCode: 'CUST-00001',
      name: 'Rajesh Kumar',
      email: 'rajesh.kumar@example.com',
      mobile: '9123456780',
      phone: '+919123456780',
      address: 'Flat 302, Green Valley Apartments, Pune',
      installationAddress: 'Flat 302, Green Valley Apartments, Pune',
      area: 'Shivajinagar',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      username: 'rajesh_fiber',
      pppoeUsername: 'rajesh_fiber',
      pppoePassword: 'fiberPass123!',
      status: CustomerStatus.ACTIVE,
      installationDate: new Date(),
      notes: 'Initial seed subscriber',
    },
  });

  // 5. Create FreeRADIUS credentials in radcheck and radreply
  await prisma.radCheck.createMany({
    data: [
      {
        username: customer.username,
        attribute: 'Cleartext-Password',
        op: ':=',
        value: customer.pppoePassword,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.radReply.createMany({
    data: [
      {
        username: customer.username,
        attribute: 'Mikrotik-Rate-Limit',
        op: '=',
        value: '100M/100M',
      },
    ],
    skipDuplicates: true,
  });

  // 6. Create MikroTik Router & NAS
  const router = await prisma.router.upsert({
    where: {
      organizationId_host: {
        organizationId: org.id,
        host: '192.168.88.1',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Main BNG CCR2004',
      host: '192.168.88.1',
      port: 8728,
      username: 'admin',
      encryptedCredential: '00112233445566778899aabbccddeeff:00112233445566778899aabbccddeeff:0011223344556677',
      radiusSecret: 'testing123',
    },
  });

  await prisma.nas.upsert({
    where: { nasname: router.host },
    update: {},
    create: {
      nasname: router.host,
      shortname: router.name,
      type: 'other',
      secret: router.radiusSecret || 'testing123',
      description: 'Main BNG MikroTik Router',
    },
  });

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
