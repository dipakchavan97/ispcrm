import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@localhost:5432/ispcrm?schema=public' } }
});

async function main() {
  const router = await prisma.router.findFirst({
    where: { name: { contains: 'Physical' } },
    include: { organization: true }
  });

  if (!router) {
    console.log('No router found with Physical in name');
    return;
  }

  console.log('Physical Router:', {
    id: router.id,
    name: router.name,
    host: router.host,
    port: router.port,
    username: router.username,
    connectionMethod: router.connectionMethod,
    vpnIp: router.vpnIp,
    vpnUsername: router.vpnUsername,
    organizationId: router.organizationId,
    orgName: router.organization?.name
  });

  const users = await prisma.adminUser.findMany({
    where: { organizationId: router.organizationId }
  });

  console.log('Admin Users for this Org:');
  for (const u of users) {
    console.log(`- User: ${u.id} | Email: ${u.email} | Role: ${u.role}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
