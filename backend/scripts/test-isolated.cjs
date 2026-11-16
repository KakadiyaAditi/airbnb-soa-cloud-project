const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { spawn } = require('node:child_process');
(async () => {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  try {
    process.exitCode = await new Promise((resolve) => {
      const test = spawn(
        process.execPath,
        [
          '--experimental-vm-modules',
          'node_modules/jest/bin/jest.js',
          '--runInBand',
          ...process.argv.slice(2),
        ],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            NODE_ENV: 'test',
            MONGODB_URI_TEST: mongo.getUri('airbnb_isolated_test'),
          },
        }
      );
      test.once('error', (error) => {
        console.error(error.message);
        resolve(1);
      });
      test.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    await mongo.stop();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
