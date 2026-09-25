/** Environment for integration tests (loaded in every test worker before modules). */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/cws_test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.LOG_LEVEL = 'silent';
process.env.STORAGE_DRIVER = 'local';
process.env.SWAGGER_ENABLED = 'false';
