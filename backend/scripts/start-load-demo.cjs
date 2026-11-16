// Fallback local experiment target when Docker image downloads are unavailable.
// This is explicitly NOT a container/AWS deployment or persistent database.
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { spawn } = require('node:child_process');
const path = require('node:path');
(async () => {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  let server, db;
  try {
    process.env.NODE_ENV = 'development';
    process.env.MONGODB_URI = mongo.getUri('airbnb_soa_loadtest');
    process.env.LOAD_TEST_DATA_ENABLED = 'true';
    process.env.ALLOW_LOAD_TEST_DATA = 'true';
    const fixture = path.resolve(__dirname, '../../performance/fixtures.local.json');
    const run = (file, args = []) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, file), ...args], {
          env: process.env,
        });
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0
            ? resolve({ stdout })
            : reject(Error(stderr || `Experiment setup exited ${code}`))
        );
      });
    await run('prepare-load-data.cjs', [fixture]);
    const probe = await run('check-multiple-instances.cjs');
    require('node:fs').writeFileSync(
      path.resolve(__dirname, '../../performance/process-probe.local.json'),
      probe.stdout
    );
    db = require('../src/config/db');
    await db.connectDB();
    const app = require('../src/app')();
    server = await new Promise((resolve) => {
      const instance = app.listen(Number(process.env.LOAD_PORT || 5188), '127.0.0.1', () =>
        resolve(instance)
      );
    });
    console.log(
      `Local Node + temporary MongoDB load target: http://localhost:${server.address().port}; NOT Docker or AWS. Stopping discards all test data.`
    );
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.disconnectDB();
    await mongo.stop();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
