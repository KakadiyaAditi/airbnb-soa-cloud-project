/**
 * Centralised configuration. All values come from environment variables
 * (loaded from backend/.env in development) so that no secrets live in code.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';

const mongoUri = isTest
  ? process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/airbnb_soa_test'
  : process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/airbnb_soa';

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const port = Number.parseInt(process.env.PORT, 10) || 5000;

module.exports = {
  nodeEnv,
  isTest,
  isProduction: nodeEnv === 'production',
  port,
  mongoUri,
  corsOrigins,
  adminToken: process.env.ADMIN_API_TOKEN || '',
  metricsEnabled: process.env.METRICS_ENABLED === 'true',
  metricsEnvironment: process.env.METRICS_ENVIRONMENT || nodeEnv,
  loadTestingAllowed:
    process.env.LOAD_TEST_DATA_ENABLED === 'true' &&
    require('../utils/databaseName')(mongoUri).endsWith('_loadtest'),
  mongoMaxPoolSize: Math.max(
    1,
    Math.min(100, Number.parseInt(process.env.MONGO_MAX_POOL_SIZE || '20', 10) || 20)
  ),
};
