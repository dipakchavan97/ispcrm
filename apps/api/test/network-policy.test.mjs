import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeedUnit,
  NetworkPolicyGenerator,
  buildNetworkPolicyFromPlan,
  translateNetworkPolicyToRadius,
} from '@isp-crm/shared';

test('Tier 1 to Tier 3: 100 Mbps Download / 50 Mbps Upload Network Policy Generation', () => {
  // Input: Commercial Internet Plan
  const plan = {
    name: 'SuperFast 100M',
    code: 'SF-100M',
    downloadSpeed: 100, // 100 Mbps
    uploadSpeed: 50,   // 50 Mbps
    speedUnit: SpeedUnit.MBPS,
  };

  // Step 1: Plan -> NetworkPolicy
  const networkPolicy = NetworkPolicyGenerator.fromPlan(plan);

  assert.ok(networkPolicy, 'NetworkPolicy must be defined');
  assert.equal(networkPolicy.policyName, 'SF-100M');
  assert.equal(networkPolicy.rateLimit.downloadSpeed, 100);
  assert.equal(networkPolicy.rateLimit.uploadSpeed, 50);
  assert.equal(networkPolicy.rateLimit.unit, SpeedUnit.MBPS);
  assert.equal(networkPolicy.rateLimit.downloadSpeedBps, 100_000_000, 'Download must be 100,000,000 bps');
  assert.equal(networkPolicy.rateLimit.uploadSpeedBps, 50_000_000, 'Upload must be 50,000,000 bps');
  assert.equal(networkPolicy.qosPriority, 8, 'Default priority must be 8');

  // Step 2: NetworkPolicy -> RadiusAttributes
  const radiusAttributes = NetworkPolicyGenerator.toRadiusAttributes(networkPolicy);

  assert.ok(radiusAttributes, 'RadiusAttributes must be defined');
  // In MikroTik rate-limit, rx = upload (50M), tx = download (100M)
  assert.equal(
    radiusAttributes['Mikrotik-Rate-Limit'],
    '50M/100M',
    'MikroTik-Rate-Limit must be formatted as rx/tx (50M/100M)',
  );
  assert.equal(radiusAttributes['WISPr-Bandwidth-Max-Down'], 100_000_000);
  assert.equal(radiusAttributes['WISPr-Bandwidth-Max-Up'], 50_000_000);
  assert.equal(radiusAttributes['Framed-Protocol'], 'PPP');
  assert.equal(radiusAttributes['Service-Type'], 'Framed-User');
  assert.equal(radiusAttributes['Ascend-Data-Rate'], 100_000_000);
  assert.equal(radiusAttributes['Ascend-Xmit-Rate'], 50_000_000);
});

test('End-to-End Pipeline: NetworkPolicyGenerator.generate(plan)', () => {
  const result = NetworkPolicyGenerator.generate({
    name: 'Enterprise 100M',
    downloadSpeed: 100,
    uploadSpeed: 50,
  });

  assert.equal(result.plan.downloadSpeed, 100);
  assert.equal(result.plan.uploadSpeed, 50);
  assert.equal(result.networkPolicy.rateLimit.downloadSpeedBps, 100_000_000);
  assert.equal(result.networkPolicy.rateLimit.uploadSpeedBps, 50_000_000);
  assert.equal(result.radiusAttributes['Mikrotik-Rate-Limit'], '50M/100M');
  assert.equal(result.radiusAttributes['WISPr-Bandwidth-Max-Down'], 100_000_000);
  assert.equal(result.radiusAttributes['WISPr-Bandwidth-Max-Up'], 50_000_000);
});

test('FreeRADIUS radreply Database Tuples Generation', () => {
  const result = NetworkPolicyGenerator.generate({
    name: 'Standard 100M',
    downloadSpeed: 100,
    uploadSpeed: 50,
  });

  const radEntries = NetworkPolicyGenerator.toRadReplyEntries(result.radiusAttributes, 'subscriber_testuser');
  assert.ok(Array.isArray(radEntries));
  
  const rateLimitEntry = radEntries.find((e) => e.attribute === 'Mikrotik-Rate-Limit');
  assert.ok(rateLimitEntry);
  assert.equal(rateLimitEntry.username, 'subscriber_testuser');
  assert.equal(rateLimitEntry.op, ':=');
  assert.equal(rateLimitEntry.value, '50M/100M');

  const wisprDown = radEntries.find((e) => e.attribute === 'WISPr-Bandwidth-Max-Down');
  assert.ok(wisprDown);
  assert.equal(wisprDown.value, '100000000');
});

test('MikroTik RouterOS Simple Queue Command Generation', () => {
  const result = NetworkPolicyGenerator.generate({
    name: 'Gigabit Edge 100M',
    code: 'GE-100M',
    downloadSpeed: 100,
    uploadSpeed: 50,
  });

  const cmd = NetworkPolicyGenerator.toMikrotikSimpleQueueCommand(
    result.networkPolicy,
    '192.168.10.55/32',
    'pppoe-subscriber-100m',
  );

  assert.equal(
    cmd,
    '/queue simple add name="pppoe-subscriber-100m" max-limit=50M/100M target=192.168.10.55/32 priority=8/8',
  );
});

test('Burst Policy: Plan -> NetworkPolicy -> RadiusAttributes with Burst parameters', () => {
  const burstPlan = {
    name: 'Burst Turbo 100M',
    code: 'TURBO-100',
    downloadSpeed: 100,
    uploadSpeed: 50,
    burstDownloadMbps: 150,
    burstUploadMbps: 75,
    burstThresholdMbps: 80,
    burstTimeSecs: 30,
    priority: 5,
  };

  const { networkPolicy, radiusAttributes } = NetworkPolicyGenerator.generate(burstPlan);

  assert.equal(networkPolicy.burst.enabled, true);
  assert.equal(networkPolicy.burst.burstDownloadSpeed, 150);
  assert.equal(networkPolicy.burst.burstUploadSpeed, 75);
  assert.equal(networkPolicy.qosPriority, 5);

  // MikroTik syntax: rx/tx rx-burst/tx-burst rx-thresh/tx-thresh duration priority
  assert.equal(
    radiusAttributes['Mikrotik-Rate-Limit'],
    '50M/100M 75M/150M 80M/80M 30/30 5',
  );
});
