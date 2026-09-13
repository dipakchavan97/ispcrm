import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const customer = await prisma.customer.findFirst({
    where: { username: { contains: 'dipak' } },
    include: { subscriptions: true }
  });

  console.log('--- CUSTOMER & SUBSCRIPTION STATE ---');
  console.log('Customer:', {
    id: customer.id,
    username: customer.username,
    status: customer.status,
    orgId: customer.organizationId
  });
  console.log('Subscriptions:', customer.subscriptions.map(s => ({
    id: s.id,
    status: s.status,
    planId: s.planId
  })));

  const radacct = await prisma.radAcct.findMany({
    where: { username: { contains: 'dipak' } },
    orderBy: { radacctid: 'desc' },
    take: 3
  });

  console.log('\n--- RECENT RADACCT SESSIONS ---');
  radacct.forEach(r => {
    console.log({
      radacctid: r.radacctid.toString(),
      username: r.username,
      acctsessionid: r.acctsessionid,
      nasipaddress: r.nasipaddress,
      framedipaddress: r.framedipaddress,
      acctstarttime: r.acctstarttime,
      acctstoptime: r.acctstoptime,
      acctterminatecause: r.acctterminatecause
    });
  });

  const radcheck = await prisma.radCheck.findMany({
    where: { username: { contains: 'dipak' } }
  });
  console.log('\n--- RADCHECK ENTRIES ---');
  console.log(radcheck);

  const radreply = await prisma.radReply.findMany({
    where: { username: { contains: 'dipak' } }
  });
  console.log('\n--- RADREPLY ENTRIES ---');
  console.log(radreply);
}

main().catch(console.error).finally(() => prisma.$disconnect());
