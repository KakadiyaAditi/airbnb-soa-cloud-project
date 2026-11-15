// Runs before every test file: force the separate test database.
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN = 'test-only-management-access-code-32-characters';
