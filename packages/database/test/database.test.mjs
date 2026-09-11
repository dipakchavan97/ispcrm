import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/index.js';

test('prisma client is exported properly', () => {
  assert.ok(prisma, 'Prisma instance should exist');
  assert.equal(typeof prisma.$connect, 'function');
  assert.equal(typeof prisma.$disconnect, 'function');
});
