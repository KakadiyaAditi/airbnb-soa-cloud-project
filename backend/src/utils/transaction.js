const mongoose = require('mongoose');

// All writes in a callback commit together, including reservation locks.
// Requires a replica set/sharded deployment; there is deliberately no unsafe fallback.
async function transaction(work) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: 5000,
      timeoutMS: 10000,
    });
  } finally {
    await session.endSession();
  }
}
module.exports = transaction;
