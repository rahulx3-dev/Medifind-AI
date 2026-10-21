'use strict';

/**
 * MediFind AI — Phase 1, Step 12C: Hermetic Prisma Guard & Regression Suite
 *
 * Prevents offline regression tests from accidentally communicating with
 * or executing operations against any real PostgreSQL or local development database.
 *
 * Intercepts all database-accessing operations on PrismaClient:
 * - Model delegates (create, findUnique, findMany, update, updateMany, delete, etc.)
 * - Raw SQL methods ($queryRaw, $queryRawUnsafe, $executeRaw, $executeRawUnsafe)
 * - Root transaction and connection methods ($transaction, $connect)
 *
 * If any offline test double omits a mock for an operation exercised by code under test,
 * this guard immediately fails fast with HermeticMockRequiredError rather than allowing
 * network I/O or database access.
 */

const assert = require('assert');
const crypto = require('crypto');

class HermeticMockRequiredError extends Error {
  constructor(operation, delegateName) {
    const target = delegateName ? `prisma.${delegateName}.${operation}()` : `prisma.${operation}()`;
    super(
      `[HermeticPrismaGuard] Accidental database operation blocked: "${target}" was invoked without an explicit test mock in an offline test. ` +
      `Offline regression tests must explicitly mock all database interactions.`
    );
    this.name = 'HermeticMockRequiredError';
    this.code = 'HERMETIC_MOCK_REQUIRED';
    this.target = target;
    this.delegateName = delegateName;
    this.operation = operation;
  }
}

const PRISMA_QUERY_METHODS = [
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
  'findMany', 'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
  'groupBy', 'count', 'aggregate', 'findRaw', 'aggregateRaw'
];

const ROOT_PRISMA_METHODS = [
  '$queryRaw', '$queryRawUnsafe',
  '$executeRaw', '$executeRawUnsafe',
  '$connect', '$transaction'
];

// Track saved original implementations per PrismaClient instance
const activeGuards = new WeakMap();

/**
 * Discover all model delegate names attached to a PrismaClient instance.
 */
function discoverDelegates(prismaClient) {
  const delegates = [];
  if (!prismaClient || typeof prismaClient !== 'object') return delegates;
  for (const key of Object.keys(prismaClient)) {
    if (key.startsWith('$') || key.startsWith('_')) continue;
    const prop = prismaClient[key];
    if (prop && typeof prop === 'object' && typeof prop.findMany === 'function') {
      delegates.push(key);
    }
  }
  return delegates;
}

/**
 * Installs the hermetic guard on a PrismaClient instance.
 * Replaces all unmocked delegate query methods and root database methods
 * with functions that fail fast with HermeticMockRequiredError.
 */
function installHermeticPrismaGuard(prismaClient) {
  if (!prismaClient || typeof prismaClient !== 'object') {
    throw new Error('installHermeticPrismaGuard requires a valid PrismaClient instance.');
  }

  if (activeGuards.has(prismaClient)) {
    return activeGuards.get(prismaClient);
  }

  const savedState = {
    delegates: new Map(),
    rootMethods: new Map()
  };

  const delegates = discoverDelegates(prismaClient);

  // Guard all model delegates
  for (const delegateName of delegates) {
    const delegate = prismaClient[delegateName];
    if (!delegate || typeof delegate !== 'object') continue;

    const delegateSaves = new Map();
    for (const method of PRISMA_QUERY_METHODS) {
      if (typeof delegate[method] === 'function') {
        delegateSaves.set(method, delegate[method]);
        delegate[method] = function hermeticBlockedDelegateMethod() {
          throw new HermeticMockRequiredError(method, delegateName);
        };
      }
    }
    savedState.delegates.set(delegateName, delegateSaves);
  }

  // Guard root methods ($queryRawUnsafe, $executeRawUnsafe, $transaction, etc.)
  for (const rootMethod of ROOT_PRISMA_METHODS) {
    if (typeof prismaClient[rootMethod] === 'function') {
      savedState.rootMethods.set(rootMethod, prismaClient[rootMethod]);
      prismaClient[rootMethod] = function hermeticBlockedRootMethod() {
        throw new HermeticMockRequiredError(rootMethod, null);
      };
    }
  }

  activeGuards.set(prismaClient, savedState);
  return savedState;
}

/**
 * Restores original native PrismaClient methods on the given instance.
 */
function uninstallHermeticPrismaGuard(prismaClient) {
  const savedState = activeGuards.get(prismaClient);
  if (!savedState) return;

  for (const [delegateName, methodMap] of savedState.delegates.entries()) {
    const delegate = prismaClient[delegateName];
    if (delegate && typeof delegate === 'object') {
      for (const [method, origFn] of methodMap.entries()) {
        delegate[method] = origFn;
      }
    }
  }

  for (const [rootMethod, origFn] of savedState.rootMethods.entries()) {
    prismaClient[rootMethod] = origFn;
  }

  activeGuards.delete(prismaClient);
}

/**
 * Checks whether the hermetic guard is currently installed on a client.
 */
function isHermeticGuardActive(prismaClient) {
  return activeGuards.has(prismaClient);
}

/**
 * Standard test double helpers for common delegates
 */
function createMockAuditLogDelegate(store = []) {
  return {
    _entries: store,
    create: async ({ data }) => {
      let parsedDetails = data?.details;
      if (typeof parsedDetails === 'string') {
        try {
          parsedDetails = JSON.parse(parsedDetails);
        } catch (_) {}
      }
      const record = {
        id: data?.id || crypto.randomUUID(),
        createdAt: data?.createdAt || new Date(),
        ...data,
        details: parsedDetails
      };
      store.push(record);
      return record;
    },
    findMany: async () => [...store],
    findFirst: async () => store[0] || null,
    count: async () => store.length
  };
}

function createMockPrescriptionItemDelegate(store = []) {
  return {
    create: async ({ data }) => {
      const record = {
        id: data?.id || crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data
      };
      store.push(record);
      return record;
    },
    deleteMany: async ({ where } = {}) => {
      const initialCount = store.length;
      if (where?.prescriptionId) {
        for (let i = store.length - 1; i >= 0; i--) {
          if (store[i].prescriptionId === where.prescriptionId) {
            store.splice(i, 1);
          }
        }
      }
      return { count: initialCount - store.length };
    },
    findMany: async () => [...store],
    count: async () => store.length
  };
}

function createMockDetectedMedicineDelegate(store = []) {
  return {
    create: async ({ data }) => {
      const record = { id: data?.id || crypto.randomUUID(), ...data };
      store.push(record);
      return record;
    },
    update: async ({ where, data }) => {
      const existing = store.find(i => i.id === where?.id);
      if (existing) Object.assign(existing, data);
      return existing || { id: where?.id, ...data };
    },
    deleteMany: async () => ({ count: 0 }),
    findMany: async () => [...store]
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE REGRESSION SUITE EXECUTION
// Proves that missing mocks cannot accidentally perform real database operations.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async function runHermeticRegressionTests() {
    console.log('\n=== MediFind AI — Step 12C: Hermetic Prisma Guard Regression Tests ===\n');

    const prisma = require('./src/prisma');
    const { recordPrescriptionAuditLog } = require('./src/utils/prescriptionAuditLogger');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
      try {
        await fn();
        console.log(`  ✓ PASS: ${name}`);
        passed++;
      } catch (err) {
        console.error(`  ✗ FAIL: ${name}`);
        console.error(err);
        failed++;
      }
    }

    try {
      // 1. Install guard
      installHermeticPrismaGuard(prisma);
      assert.strictEqual(isHermeticGuardActive(prisma), true, 'Hermetic guard must be active');

      // ─────────────────────────────────────────────────────────────────────────
      // TEST 1: Unmocked delegate method throws HERMETIC_MOCK_REQUIRED
      // ─────────────────────────────────────────────────────────────────────────
      await test('Unmocked delegate method throws HERMETIC_MOCK_REQUIRED without network/DB calls', async () => {
        let threw = false;
        let thrownCode = null;
        try {
          // Attempting to call create without a test mock
          await prisma.prescriptionAuditLog.create({
            data: { id: 'test-audit-fail', action: 'PRESCRIPTION_VIEWED' }
          });
        } catch (err) {
          threw = true;
          thrownCode = err.code;
          assert.ok(err.message.includes('[HermeticPrismaGuard]'), 'Must contain HermeticPrismaGuard prefix');
          assert.ok(err.message.includes('prescriptionAuditLog.create'), 'Must name the blocked method');
        }
        assert.strictEqual(threw, true, 'Unmocked delegate method must throw');
        assert.strictEqual(thrownCode, 'HERMETIC_MOCK_REQUIRED', 'Error code must be HERMETIC_MOCK_REQUIRED');
      });

      // ─────────────────────────────────────────────────────────────────────────
      // TEST 2: Unmocked raw SQL execution throws HERMETIC_MOCK_REQUIRED
      // ─────────────────────────────────────────────────────────────────────────
      await test('Unmocked raw SQL execution ($executeRawUnsafe) throws HERMETIC_MOCK_REQUIRED', async () => {
        let threw = false;
        let thrownCode = null;
        try {
          await prisma.$executeRawUnsafe('DELETE FROM "Prescription"');
        } catch (err) {
          threw = true;
          thrownCode = err.code;
          assert.ok(err.message.includes('$executeRawUnsafe'));
        }
        assert.strictEqual(threw, true, 'Unmocked $executeRawUnsafe must throw');
        assert.strictEqual(thrownCode, 'HERMETIC_MOCK_REQUIRED');
      });

      // ─────────────────────────────────────────────────────────────────────────
      // TEST 3: Unmocked raw SQL query throws HERMETIC_MOCK_REQUIRED
      // ─────────────────────────────────────────────────────────────────────────
      await test('Unmocked raw SQL query ($queryRawUnsafe) throws HERMETIC_MOCK_REQUIRED', async () => {
        let threw = false;
        let thrownCode = null;
        try {
          await prisma.$queryRawUnsafe('SELECT * FROM "Prescription"');
        } catch (err) {
          threw = true;
          thrownCode = err.code;
        }
        assert.strictEqual(threw, true, 'Unmocked $queryRawUnsafe must throw');
        assert.strictEqual(thrownCode, 'HERMETIC_MOCK_REQUIRED');
      });

      // ─────────────────────────────────────────────────────────────────────────
      // TEST 4: Unmocked root transaction throws HERMETIC_MOCK_REQUIRED
      // ─────────────────────────────────────────────────────────────────────────
      await test('Unmocked root $transaction throws HERMETIC_MOCK_REQUIRED', async () => {
        let threw = false;
        let thrownCode = null;
        try {
          await prisma.$transaction(async () => {});
        } catch (err) {
          threw = true;
          thrownCode = err.code;
        }
        assert.strictEqual(threw, true, 'Unmocked $transaction must throw');
        assert.strictEqual(thrownCode, 'HERMETIC_MOCK_REQUIRED');
      });

      // ─────────────────────────────────────────────────────────────────────────
      // TEST 5: Explicit test mock overrides guard and executes without throwing
      // ─────────────────────────────────────────────────────────────────────────
      await test('Explicit test mock double overrides guard and functions normally', async () => {
        const auditStore = [];
        const mockAudit = createMockAuditLogDelegate(auditStore);

        // Temporarily assign test double
        const origGuardedCreate = prisma.prescriptionAuditLog.create;
        prisma.prescriptionAuditLog.create = mockAudit.create;

        try {
          const res = await prisma.prescriptionAuditLog.create({
            data: { id: 'explicit-mock-1', action: 'PRESCRIPTION_VIEWED' }
          });
          assert.strictEqual(res.id, 'explicit-mock-1');
          assert.strictEqual(auditStore.length, 1);
        } finally {
          prisma.prescriptionAuditLog.create = origGuardedCreate;
        }
      });

      // ─────────────────────────────────────────────────────────────────────────
      // TEST 6: Missing mock in transaction fallback fails closed with hermetic guard
      // ─────────────────────────────────────────────────────────────────────────
      await test('Missing mock in transaction fallback fails closed via hermetic guard (no DB access)', async () => {
        // A mock transaction client that omits prescriptionAuditLog
        const partialMockTx = {
          _isTransaction: true,
          prescription: { update: async () => ({}) }
        };

        // When production fallback logic copies root prisma.prescriptionAuditLog:
        if (!partialMockTx.prescriptionAuditLog && prisma.prescriptionAuditLog) {
          partialMockTx.prescriptionAuditLog = prisma.prescriptionAuditLog;
        }

        let threw = false;
        let thrownCode = null;

        try {
          // Mandatory audit logger write should fail closed on unmocked delegate
          await recordPrescriptionAuditLog(partialMockTx, {
            prescriptionId: 'rx-guard-test-1',
            action: 'PRESCRIPTION_VERIFIED'
          });
        } catch (err) {
          threw = true;
          thrownCode = err.code;
          assert.ok(err.message.includes('[HermeticPrismaGuard]'), 'Must be intercepted by HermeticPrismaGuard');
        }

        assert.strictEqual(threw, true, 'Calling audit write with unmocked delegate must fail closed');
        assert.strictEqual(thrownCode, 'HERMETIC_MOCK_REQUIRED', 'Must throw HERMETIC_MOCK_REQUIRED');
      });

      // ─────────────────────────────────────────────────────────────────────────
      // TEST 7: Fully mocked transaction audit logger succeeds deterministically
      // ─────────────────────────────────────────────────────────────────────────
      await test('Fully mocked transaction audit logger executes deterministically offline', async () => {
        const auditStore = [];
        const fullMockTx = {
          _isTransaction: true,
          prescriptionAuditLog: createMockAuditLogDelegate(auditStore)
        };

        const res = await recordPrescriptionAuditLog(fullMockTx, {
          prescriptionId: 'rx-guard-success-1',
          action: 'PRESCRIPTION_VERIFIED'
        });

        assert.ok(res && res.id);
        assert.strictEqual(auditStore.length, 1);
        assert.strictEqual(auditStore[0].action, 'PRESCRIPTION_VERIFIED');
        assert.strictEqual(auditStore[0].prescriptionId, 'rx-guard-success-1');
      });

      console.log(`\n─────────────────────────────────────────────────────────────`);
      console.log(`Results: ${passed} / ${passed + failed} tests passed.`);

      if (failed > 0) {
        console.error(`✗ ${failed} test(s) failed!`);
        process.exit(1);
      } else {
        console.log(`✓ All Hermetic Prisma Guard Regression tests PASSED successfully!\n`);
      }
    } finally {
      uninstallHermeticPrismaGuard(prisma);
    }
  })();
}

module.exports = {
  installHermeticPrismaGuard,
  uninstallHermeticPrismaGuard,
  isHermeticGuardActive,
  HermeticMockRequiredError,
  createMockAuditLogDelegate,
  createMockPrescriptionItemDelegate,
  createMockDetectedMedicineDelegate
};
