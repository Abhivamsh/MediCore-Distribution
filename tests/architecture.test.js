'use strict';

/**
 * MediCore Distribution – Architecture & Integration Tests
 *
 * These tests validate the core structure and configurations of the
 * microservices without requiring running infrastructure.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVICES_DIR = path.join(ROOT, 'services');

const EXPECTED_SERVICES = [
  'api-gateway',
  'auth-service',
  'user-service',
  'inventory-service',
  'billing-service',
  'purchase-service',
  'analytics-service',
  'ai-assistant-service',
  'notification-service',
];

const EXPECTED_PORTS = {
  'api-gateway': 3000,
  'auth-service': 3001,
  'user-service': 3002,
  'inventory-service': 3003,
  'billing-service': 3004,
  'purchase-service': 3005,
  'analytics-service': 3006,
  'ai-assistant-service': 3007,
  'notification-service': 3008,
};

// ─── Service Structure Tests ──────────────────────────────────────────────────
describe('Microservices Directory Structure', () => {
  test('services directory exists', () => {
    expect(fs.existsSync(SERVICES_DIR)).toBe(true);
  });

  test.each(EXPECTED_SERVICES)('service "%s" directory exists', (service) => {
    expect(fs.existsSync(path.join(SERVICES_DIR, service))).toBe(true);
  });

  test.each(EXPECTED_SERVICES)('service "%s" has package.json', (service) => {
    const pkg = path.join(SERVICES_DIR, service, 'package.json');
    expect(fs.existsSync(pkg)).toBe(true);
  });

  test.each(EXPECTED_SERVICES)('service "%s" has Dockerfile', (service) => {
    const dockerfile = path.join(SERVICES_DIR, service, 'Dockerfile');
    expect(fs.existsSync(dockerfile)).toBe(true);
  });

  test.each(EXPECTED_SERVICES)('service "%s" has src/index.js', (service) => {
    const indexFile = path.join(SERVICES_DIR, service, 'src', 'index.js');
    expect(fs.existsSync(indexFile)).toBe(true);
  });
});

// ─── Package.json Validation ──────────────────────────────────────────────────
describe('Package.json Configuration', () => {
  test.each(EXPECTED_SERVICES)('service "%s" package.json is valid JSON', (service) => {
    const pkg = path.join(SERVICES_DIR, service, 'package.json');
    expect(() => JSON.parse(fs.readFileSync(pkg, 'utf8'))).not.toThrow();
  });

  test.each(EXPECTED_SERVICES)('service "%s" has start script', (service) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SERVICES_DIR, service, 'package.json'), 'utf8'));
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts.start).toBeDefined();
  });

  test.each(EXPECTED_SERVICES)('service "%s" depends on express', (service) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SERVICES_DIR, service, 'package.json'), 'utf8'));
    expect(pkg.dependencies.express).toBeDefined();
  });

  test.each(EXPECTED_SERVICES)('service "%s" depends on helmet for security', (service) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SERVICES_DIR, service, 'package.json'), 'utf8'));
    expect(pkg.dependencies.helmet).toBeDefined();
  });
});

// ─── Dockerfile Validation ────────────────────────────────────────────────────
describe('Dockerfile Configuration', () => {
  test.each(EXPECTED_SERVICES)('service "%s" Dockerfile uses node:20-alpine', (service) => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, service, 'Dockerfile'), 'utf8');
    expect(content).toContain('node:20-alpine');
  });

  test.each(EXPECTED_SERVICES)('service "%s" Dockerfile has HEALTHCHECK', (service) => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, service, 'Dockerfile'), 'utf8');
    expect(content).toContain('HEALTHCHECK');
  });

  test.each(EXPECTED_SERVICES)('service "%s" Dockerfile runs as non-root user', (service) => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, service, 'Dockerfile'), 'utf8');
    expect(content).toContain('USER medicore');
  });

  test.each(Object.entries(EXPECTED_PORTS))('service "%s" Dockerfile exposes port %i', (service, port) => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, service, 'Dockerfile'), 'utf8');
    expect(content).toContain(`EXPOSE ${port}`);
  });
});

// ─── Source Code Validation ───────────────────────────────────────────────────
describe('Service Source Code', () => {
  test.each(EXPECTED_SERVICES)('service "%s" has health endpoint', (service) => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, service, 'src', 'index.js'), 'utf8');
    expect(content).toContain('/health');
  });

  test.each(EXPECTED_SERVICES)('service "%s" uses environment variable for PORT', (service) => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, service, 'src', 'index.js'), 'utf8');
    expect(content).toContain('process.env.PORT');
  });

  test.each(EXPECTED_SERVICES)('service "%s" uses helmet security middleware', (service) => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, service, 'src', 'index.js'), 'utf8');
    expect(content).toContain('helmet');
  });

  test('auth-service has JWT token generation', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'auth-service', 'src', 'routes', 'auth.js'), 'utf8');
    expect(content).toContain('jwt.sign');
    expect(content).toContain('jwt.verify');
  });

  test('auth-service hashes passwords with bcrypt', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'auth-service', 'src', 'routes', 'auth.js'), 'utf8');
    expect(content).toContain('bcrypt.hash');
    expect(content).toContain('bcrypt.compare');
  });

  test('auth-service supports refresh token rotation', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'auth-service', 'src', 'routes', 'auth.js'), 'utf8');
    expect(content).toContain('/refresh');
    expect(content).toContain('DELETE FROM refresh_tokens');
  });

  test('auth-service implements all 4 RBAC roles', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'auth-service', 'src', 'routes', 'auth.js'), 'utf8');
    expect(content).toContain('super_admin');
    expect(content).toContain('regional_manager');
    expect(content).toContain('inventory_manager');
    expect(content).toContain('pharmacist');
  });

  test('api-gateway authenticates before proxying protected routes', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'api-gateway', 'src', 'index.js'), 'utf8');
    expect(content).toContain('authenticate');
    expect(content).toContain('/api/inventory');
    expect(content).toContain('/api/billing');
  });

  test('api-gateway does not require auth for /api/auth routes', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'api-gateway', 'src', 'index.js'), 'utf8');
    // The /api/auth proxy should NOT have authenticate in the same app.use() call
    // Look for the public auth proxy line – it should not contain 'authenticate' on that same line
    const authProxyLine = content.split('\n').find((line) => line.includes("'/api/auth'") && line.includes('createProxy'));
    expect(authProxyLine).toBeDefined();
    expect(authProxyLine).not.toContain('authenticate');
  });

  test('api-gateway applies rate limiting', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'api-gateway', 'src', 'index.js'), 'utf8');
    expect(content).toContain('rateLimit');
    expect(content).toContain('RATE_LIMIT');
  });

  test('inventory-service supports low-stock alerts query', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'inventory-service', 'src', 'routes', 'inventory.js'), 'utf8');
    expect(content).toContain('/alerts');
    expect(content).toContain('reorder_level');
  });

  test('inventory-service uses database transactions for stock adjustments', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'inventory-service', 'src', 'routes', 'inventory.js'), 'utf8');
    expect(content).toContain('BEGIN');
    expect(content).toContain('COMMIT');
    expect(content).toContain('ROLLBACK');
  });

  test('billing-service publishes events after invoice creation', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'billing-service', 'src', 'routes', 'billing.js'), 'utf8');
    expect(content).toContain('mq.publish');
    expect(content).toContain('billing.invoice.created');
  });

  test('analytics-service consumes billing events', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'analytics-service', 'src', 'index.js'), 'utf8');
    expect(content).toContain('billing.invoice.*');
    expect(content).toContain('daily_sales_snapshots');
  });

  test('analytics-service uses Redis caching', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'analytics-service', 'src', 'routes', 'analytics.js'), 'utf8');
    expect(content).toContain('redis');
    expect(content).toContain('setex');
  });

  test('auth-service rate limits login and register endpoints', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'auth-service', 'src', 'routes', 'auth.js'), 'utf8');
    expect(content).toContain('authMutationLimiter');
    expect(content).toContain('rateLimit');
  });

  test('ai-assistant-service rate limits query endpoints', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'ai-assistant-service', 'src', 'routes', 'ai.js'), 'utf8');
    expect(content).toContain('aiQueryLimiter');
    expect(content).toContain('rateLimit');
  });

  test('ai-assistant-service has fallback when no API key', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'ai-assistant-service', 'src', 'routes', 'ai.js'), 'utf8');
    expect(content).toContain('OPENAI_API_KEY');
    expect(content).toContain('generateRuleBasedResponse');
  });

  test('notification-service consumes inventory events', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'notification-service', 'src', 'index.js'), 'utf8');
    expect(content).toContain('inventory.updated');
    expect(content).toContain('low_stock');
  });
});

// ─── Infrastructure Tests ─────────────────────────────────────────────────────
describe('Infrastructure Configuration', () => {
  test('docker-compose.yml exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'docker-compose.yml'))).toBe(true);
  });

  test('docker-compose.yml is valid YAML structure', () => {
    const content = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    expect(content).toContain('services:');
    expect(content).toContain('postgres:');
    expect(content).toContain('redis:');
    expect(content).toContain('rabbitmq:');
  });

  test.each(EXPECTED_SERVICES)('docker-compose.yml includes service "%s"', (service) => {
    const content = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    expect(content).toContain(service + ':');
  });

  test('docker-compose.yml defines named volumes for data persistence', () => {
    const content = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    expect(content).toContain('postgres-data:');
    expect(content).toContain('redis-data:');
    expect(content).toContain('rabbitmq-data:');
  });

  test('.env.example exists with required variables', () => {
    const content = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(content).toContain('JWT_SECRET');
    expect(content).toContain('POSTGRES_PASSWORD');
    expect(content).toContain('REDIS_PASSWORD');
    expect(content).toContain('RABBITMQ_URL');
  });

  test('nginx configuration exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'infrastructure', 'nginx', 'nginx.conf'))).toBe(true);
  });

  test('postgres init.sql creates all service databases', () => {
    const content = fs.readFileSync(path.join(ROOT, 'infrastructure', 'postgres', 'init.sql'), 'utf8');
    ['medicore_auth', 'medicore_users', 'medicore_inventory', 'medicore_billing', 'medicore_purchase', 'medicore_analytics'].forEach((db) => {
      expect(content).toContain(db);
    });
  });
});

// ─── Shared Utilities Tests ───────────────────────────────────────────────────
describe('Shared Middleware & Utilities', () => {
  test('shared auth middleware exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'shared', 'middleware', 'auth.js'))).toBe(true);
  });

  test('shared error handler exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'shared', 'middleware', 'errorHandler.js'))).toBe(true);
  });

  test('shared message queue utility exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'shared', 'utils', 'messageQueue.js'))).toBe(true);
  });

  test('shared auth middleware exports RBAC roles', () => {
    const content = fs.readFileSync(path.join(ROOT, 'shared', 'middleware', 'auth.js'), 'utf8');
    expect(content).toContain('SUPER_ADMIN');
    expect(content).toContain('REGIONAL_MANAGER');
    expect(content).toContain('INVENTORY_MANAGER');
    expect(content).toContain('PHARMACIST');
  });

  test('shared auth middleware has branch restriction', () => {
    const content = fs.readFileSync(path.join(ROOT, 'shared', 'middleware', 'auth.js'), 'utf8');
    expect(content).toContain('restrictBranch');
  });
});

// ─── Security Tests ───────────────────────────────────────────────────────────
describe('Security Configuration', () => {
  test.each(EXPECTED_SERVICES)('service "%s" does not hardcode secrets', (service) => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, service, 'src', 'index.js'), 'utf8');
    expect(content).not.toMatch(/password\s*=\s*['"][^'"]{3,}['"]/i);
    expect(content).not.toMatch(/secret\s*=\s*['"][^'"]{3,}['"]/i);
  });

  test('.gitignore excludes .env files but not .env.example', () => {
    const content = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(content).toContain('.env');
    // .env.example should be explicitly kept (negation pattern or comment noting it's safe)
    expect(content).toContain('.env.example');
  });

  test('auth service uses SHA-256 for refresh token hashing', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'auth-service', 'src', 'routes', 'auth.js'), 'utf8');
    expect(content).toContain('sha256');
  });

  test('api-gateway CORS does not use wildcard origin', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'api-gateway', 'src', 'index.js'), 'utf8');
    // Should not have hardcoded '*' as origin - should use env var or restrictive config
    expect(content).not.toContain("origin: '*'");
    expect(content).toContain('ALLOWED_ORIGINS');
  });

  test('inventory service validates branch range (1-18)', () => {
    const content = fs.readFileSync(path.join(SERVICES_DIR, 'inventory-service', 'src', 'routes', 'inventory.js'), 'utf8');
    expect(content).toContain('max: 18');
  });

  test('notification-service uses nodemailer >=7.0.11 (fixes CVE DoS and domain confusion)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(SERVICES_DIR, 'notification-service', 'package.json'), 'utf8')
    );
    const spec = pkg.dependencies.nodemailer;
    // Strip leading range operator (^, ~, >=, etc.) to get the minimum version
    const minVersion = spec.replace(/^[^0-9]*/, '');
    const [major, minor, patch] = minVersion.split('.').map(Number);
    // Must be >= 7.0.11
    const isPatched =
      major > 7 ||
      (major === 7 && minor > 0) ||
      (major === 7 && minor === 0 && patch >= 11);
    expect(isPatched).toBe(true);
  });
});
