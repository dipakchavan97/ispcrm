import { NetworkPolicyGenerator, SpeedUnit } from '@isp-crm/shared';

console.log('\n===============================================================');
console.log('   NETWORK POLICY GENERATION: 3-TIER ABSTRACTION PIPELINE');
console.log('===============================================================\n');

// -----------------------------------------------------------------
// TIER 1: Plan (Commercial / Business Input)
// -----------------------------------------------------------------
const planInput = {
  name: 'Ultra High-Speed Fiber 100M',
  code: 'FIBER-100M-50M',
  downloadSpeed: 100, // 100 Mbps
  uploadSpeed: 50,   // 50 Mbps
  speedUnit: SpeedUnit.MBPS,
};

console.log('📦 [TIER 1] Plan Input (Commercial Specification):');
console.log(JSON.stringify(planInput, null, 2));
console.log('\n                             │');
console.log('                             ▼\n');

// -----------------------------------------------------------------
// TIER 2: NetworkPolicy (Vendor-Neutral QoS & Traffic Shaping)
// -----------------------------------------------------------------
const networkPolicy = NetworkPolicyGenerator.fromPlan(planInput);

console.log('🌐 [TIER 2] NetworkPolicy (Vendor-Neutral Abstraction):');
console.log(JSON.stringify(networkPolicy, null, 2));
console.log('\n                             │');
console.log('                             ▼\n');

// -----------------------------------------------------------------
// TIER 3: RadiusAttributes (Compiled RADIUS / MikroTik Policy)
// -----------------------------------------------------------------
const radiusAttributes = NetworkPolicyGenerator.toRadiusAttributes(networkPolicy);

console.log('📡 [TIER 3] RadiusAttributes (MikroTik / FreeRADIUS Authorization Policy):');
console.log(JSON.stringify(radiusAttributes, null, 2));
console.log('\n---------------------------------------------------------------');

// -----------------------------------------------------------------
// Ready for FreeRADIUS SQL (radreply table)
// -----------------------------------------------------------------
console.log('💾 Database Rows for FreeRADIUS `radreply` table (PPPoE subscriber authorization):');
const radEntries = NetworkPolicyGenerator.toRadReplyEntries(radiusAttributes, 'testuser');
console.table(radEntries);

// -----------------------------------------------------------------
// RouterOS Simple Queue Command
// -----------------------------------------------------------------
console.log('⚡ MikroTik RouterOS Dynamic Queue Command:');
const queueCmd = NetworkPolicyGenerator.toMikrotikSimpleQueueCommand(
  networkPolicy,
  '<pppoe-testuser>',
  'queue-testuser',
);
console.log(queueCmd);
console.log('\n===============================================================\n');
