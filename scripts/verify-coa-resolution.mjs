import { prisma } from '@isp-crm/database';
import { getRadiusUsernameCandidates, toPhysicalRadiusUsername } from '@isp-crm/shared';

async function testResolution() {
  console.log('--- 1. Testing Helper Functions ---');
  const testUsers = ['dipak123', 'dipak123@ispcrm', 'dipak', 'dipak@ispcrm', 'sharad'];
  for (const u of testUsers) {
    const candidates = getRadiusUsernameCandidates(u);
    const physical = toPhysicalRadiusUsername(u);
    console.log(`Input: "${u}" -> Candidates: ${JSON.stringify(candidates)}, Physical: "${physical}"`);
  }

  console.log('\n--- 2. Testing Session Lookup with Candidate Resolution in DB ---');
  for (const inputUser of ['dipak123', 'dipak', 'dipak@ispcrm']) {
    const candidates = getRadiusUsernameCandidates(inputUser);
    const session = await prisma.radAcct.findFirst({
      where: {
        username: { in: candidates },
        acctstoptime: null,
      },
      orderBy: { acctstarttime: 'desc' },
    });

    if (session) {
      console.log(`Lookup for "${inputUser}": MATCHED active session id ${session.radacctid} for physical username "${session.username}", NAS: ${session.nasipaddress}, IP: ${session.framedipaddress}, SessionID: ${session.acctsessionid}`);
    } else {
      console.log(`Lookup for "${inputUser}": No active session currently, resolves to default physical username "${toPhysicalRadiusUsername(inputUser)}"`);
    }
  }

  console.log('\n--- 3. Testing RadCheck Credential Candidate Matching ---');
  for (const inputUser of ['dipak123', 'dipak']) {
    const candidates = getRadiusUsernameCandidates(inputUser);
    const radcheckRows = await prisma.radCheck.findMany({
      where: { username: { in: candidates } },
    });
    console.log(`Radcheck rows for "${inputUser}" (${candidates.join(', ')}):`);
    for (const r of radcheckRows) {
      console.log(`  - [${r.id}] ${r.username} | ${r.attribute} | ${r.op} | ${r.value}`);
    }
  }

  await prisma.$disconnect();
}

testResolution().catch(console.error);
