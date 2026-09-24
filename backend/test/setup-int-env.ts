// Integration tests use a real database: TEST_DATABASE_URL, never DATABASE_URL.
import './setup-env';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
}
