// Runs before any test file is imported: ConfigModule validates the
// environment at import time, so these must exist first.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://sb:sb@localhost:5432/servicebridge_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.APP_ENCRYPTION_KEYS = `v1:${Buffer.alloc(32, 1).toString('base64')}`;
process.env.CORS_ORIGINS = 'http://localhost:3000';
