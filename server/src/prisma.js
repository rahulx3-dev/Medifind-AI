const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Keep-alive heartbeat: executes a trivial 'SELECT 1' every 4 minutes (240,000ms)
// to prevent Neon Serverless compute from scaling down to zero / sleeping after 5 minutes of inactivity.
// unref() ensures this timer does not block graceful process shutdown or test exits.
const keepAliveTimer = setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    // Non-fatal: if offline or cold-starting, subsequent queries will handle reconnection
  }
}, 4 * 60 * 1000);

if (keepAliveTimer && keepAliveTimer.unref) {
  keepAliveTimer.unref();
}

module.exports = prisma;
