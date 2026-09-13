import { prisma } from '@isp-crm/database';

async function main() {
  console.log('=== 1. CUSTOMERS MATCHING dipak% OR dipak123 ===');
  const customers = await prisma.customer.findMany({
    where: {
      OR: [
        { username: { contains: 'dipak' } },
        { name: { contains: 'Dipak', mode: 'insensitive' } },
      ],
    },
    include: {
      subscriptions: {
        include: { plan: true },
      },
    },
  });
  console.log(JSON.stringify(customers, null, 2));

  console.log('\n=== 2. RADCHECK ROWS FOR CANDIDATES ===');
  const radcheck = await prisma.radCheck.findMany({
    where: {
      username: {
        in: ['dipak123', 'dipak123@ispcrm', 'dipak', 'dipak@ispcrm'],
      },
    },
  });
  console.log(JSON.stringify(radcheck, null, 2));

  console.log('\n=== 3. RADREPLY ROWS FOR CANDIDATES ===');
  const radreply = await prisma.radReply.findMany({
    where: {
      username: {
        in: ['dipak123', 'dipak123@ispcrm', 'dipak', 'dipak@ispcrm'],
      },
    },
  });
  console.log(JSON.stringify(radreply, null, 2));

  console.log('\n=== 4. RADACCT RECENT SESSIONS FOR CANDIDATES ===');
  const radacct = await prisma.radAcct.findMany({
    where: {
      username: {
        in: ['dipak123', 'dipak123@ispcrm', 'dipak', 'dipak@ispcrm'],
      },
    },
    orderBy: { radacctid: 'desc' },
    take: 5,
  });
  const serialize = (data) => JSON.stringify(data, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
  console.log(serialize(radacct));

  console.log('\n=== 5. RECENT AUDIT LOGS FOR COA_DISCONNECT OR STATUS_CHANGE ===');
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      action: {
        in: ['COA_DISCONNECT', 'STATUS_CHANGE'],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log(serialize(auditLogs));

  await prisma.$disconnect();
}

main().catch(console.error);
