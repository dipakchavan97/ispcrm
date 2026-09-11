import { prisma } from '@isp-crm/database';
import {
  CustomerStatus,
  PlanStatus,
  SubscriptionStatus,
  SpeedUnit,
  BillingCycle,
  DEFAULT_TIMEZONE,
  calculateSubscriptionEndDate,
} from '@isp-crm/shared';

export async function seedRadiusTestUsers() {
  console.log('🌱 Seeding FreeRADIUS & MikroTik Test Users...');

  // 1. Find or create default organization
  let org = await prisma.organization.findFirst({
    where: { slug: 'speednet-isp' },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'SpeedNet Broadband ISP',
        slug: 'speednet-isp',
        email: 'support@speednet.in',
        phone: '9820011111',
        city: 'Mumbai',
        state: 'Maharashtra',
        stateCode: '27',
        timezone: DEFAULT_TIMEZONE,
      },
    });
  }

  // 2. Upsert Plans: 50 Mbps, 100 Mbps, 200 Mbps
  const plansData = [
    {
      name: 'Fiber Starter 50M',
      code: 'FIBER-50M',
      downloadSpeed: 50,
      uploadSpeed: 25,
      downloadSpeedMbps: 50,
      uploadSpeedMbps: 25,
      price: 499,
      rateLimit: '25M/50M',
    },
    {
      name: 'Fiber Standard 100M',
      code: 'FIBER-100M',
      downloadSpeed: 100,
      uploadSpeed: 50,
      downloadSpeedMbps: 100,
      uploadSpeedMbps: 50,
      price: 799,
      rateLimit: '50M/100M',
    },
    {
      name: 'Fiber Ultra 200M',
      code: 'FIBER-200M',
      downloadSpeed: 200,
      uploadSpeed: 100,
      downloadSpeedMbps: 200,
      uploadSpeedMbps: 100,
      price: 999,
      rateLimit: '100M/200M',
    },
  ];

  const planMap = new Map();
  for (const p of plansData) {
    let plan = await prisma.internetPlan.findFirst({
      where: { organizationId: org.id, code: p.code },
    });
    if (!plan) {
      plan = await prisma.internetPlan.create({
        data: {
          organizationId: org.id,
          name: p.name,
          code: p.code,
          downloadSpeed: p.downloadSpeed,
          uploadSpeed: p.uploadSpeed,
          speedUnit: SpeedUnit.MBPS,
          downloadSpeedMbps: p.downloadSpeedMbps,
          uploadSpeedMbps: p.uploadSpeedMbps,
          validityDays: 30,
          billingCycle: BillingCycle.MONTHLY,
          price: p.price,
          status: PlanStatus.ACTIVE,
        },
      });
    }
    planMap.set(p.code, { ...plan, rateLimit: p.rateLimit });
  }

  // 3. Define Test Users
  const testSubscribers = [
    {
      username: 'speed_50m_user',
      password: 'pass123',
      name: 'Aarav 50M Subscriber',
      code: 'CUST-50M-001',
      planCode: 'FIBER-50M',
      status: CustomerStatus.ACTIVE,
      subStatus: SubscriptionStatus.ACTIVE,
      staticIp: '100.64.10.50',
    },
    {
      username: 'speed_100m_user',
      password: 'pass123',
      name: 'Rohan 100M Subscriber',
      code: 'CUST-100M-001',
      planCode: 'FIBER-100M',
      status: CustomerStatus.ACTIVE,
      subStatus: SubscriptionStatus.ACTIVE,
      staticIp: '100.64.10.100',
    },
    {
      username: 'speed_200m_user',
      password: 'pass123',
      name: 'Neha 200M Subscriber',
      code: 'CUST-200M-001',
      planCode: 'FIBER-200M',
      status: CustomerStatus.ACTIVE,
      subStatus: SubscriptionStatus.ACTIVE,
      staticIp: '100.64.10.200',
    },
    {
      username: 'suspended_user',
      password: 'pass123',
      name: 'Sameer Suspended Subscriber',
      code: 'CUST-SUSP-001',
      planCode: 'FIBER-100M',
      status: CustomerStatus.SUSPENDED,
      subStatus: SubscriptionStatus.SUSPENDED,
    },
    {
      username: 'expired_user',
      password: 'pass123',
      name: 'Pooja Expired Subscriber',
      code: 'CUST-EXP-001',
      planCode: 'FIBER-50M',
      status: CustomerStatus.EXPIRED,
      subStatus: SubscriptionStatus.EXPIRED,
    },
  ];

  const results = [];

  for (const s of testSubscribers) {
    const planMeta = planMap.get(s.planCode);

    // Upsert Customer
    let customer = await prisma.customer.findFirst({
      where: { organizationId: org.id, username: s.username },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          organizationId: org.id,
          customerCode: s.code,
          name: s.name,
          username: s.username,
          pppoeUsername: s.username,
          pppoePassword: s.password,
          mobile: '9820099000',
          status: s.status,
          staticIp: s.staticIp || null,
        },
      });
    } else {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          status: s.status,
          pppoePassword: s.password,
          staticIp: s.staticIp || null,
        },
      });
    }

    // Upsert Subscription
    const now = new Date();
    const startDate = new Date(now.getTime() - 5 * 86400 * 1000);
    const endDate = s.subStatus === SubscriptionStatus.ACTIVE
      ? new Date(now.getTime() + 25 * 86400 * 1000)
      : new Date(now.getTime() - 2 * 86400 * 1000);

    let sub = await prisma.subscription.findFirst({
      where: { organizationId: org.id, customerId: customer.id },
    });

    if (!sub) {
      sub = await prisma.subscription.create({
        data: {
          organizationId: org.id,
          customerId: customer.id,
          planId: planMeta.id,
          status: s.subStatus,
          startDate,
          endDate,
          billingCycle: BillingCycle.MONTHLY,
          price: planMeta.price,
        },
      });
    } else {
      sub = await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          planId: planMeta.id,
          status: s.subStatus,
          endDate,
        },
      });
    }

    // Clean existing RADIUS records
    await prisma.radCheck.deleteMany({ where: { username: s.username } });
    await prisma.radReply.deleteMany({ where: { username: s.username } });

    // Populate radcheck and radreply based on status
    if (s.status === CustomerStatus.ACTIVE && s.subStatus === SubscriptionStatus.ACTIVE) {
      // Valid Credentials in radcheck
      await prisma.radCheck.create({
        data: {
          username: s.username,
          attribute: 'Cleartext-Password',
          op: ':=',
          value: s.password,
        },
      });

      // Reply Attributes in radreply
      const replies = [
        {
          username: s.username,
          attribute: 'Mikrotik-Rate-Limit',
          op: '=',
          value: planMeta.rateLimit,
        },
        {
          username: s.username,
          attribute: 'Framed-Protocol',
          op: '=',
          value: 'PPP',
        },
        {
          username: s.username,
          attribute: 'Service-Type',
          op: '=',
          value: 'Framed-User',
        },
        {
          username: s.username,
          attribute: 'Acct-Interim-Interval',
          op: '=',
          value: '300',
        },
      ];

      if (s.staticIp) {
        replies.push({
          username: s.username,
          attribute: 'Framed-IP-Address',
          op: '=',
          value: s.staticIp,
        });
      }

      await prisma.radReply.createMany({ data: replies });
    } else {
      // Invalidate password to enforce Access-Reject
      await prisma.radCheck.create({
        data: {
          username: s.username,
          attribute: 'Cleartext-Password',
          op: ':=',
          value: `DISABLED_${s.status}_${Date.now()}`,
        },
      });
    }

    results.push({
      username: s.username,
      password: s.password,
      plan: planMeta.name,
      rateLimit: planMeta.rateLimit,
      status: s.status,
      expectedRadiusAuth: s.status === CustomerStatus.ACTIVE ? 'Access-Accept' : 'Access-Reject',
    });
  }

  // 4. Ensure NAS table has localhost and docker_network clients
  await prisma.nas.deleteMany({ where: { nasname: '127.0.0.1' } });
  await prisma.nas.create({
    data: {
      nasname: '127.0.0.1',
      shortname: 'localhost',
      type: 'other',
      secret: 'testing123',
      description: 'Local development test client',
    },
  });

  console.log('✅ Seeded RADIUS Test Users:');
  console.table(results);
  return results;
}

if (process.argv[1]?.endsWith('seed-radius-test-users.mjs') || process.argv[1]?.endsWith('seed-radius-test-users.ts')) {
  seedRadiusTestUsers()
    .then(() => {
      console.log('🎉 RADIUS test users seeded successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Seeding failed:', err);
      process.exit(1);
    });
}
