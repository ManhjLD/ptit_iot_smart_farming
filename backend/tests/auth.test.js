import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../src/services/auth.service.js';
import { requireAuth, requireRole } from '../src/middleware/auth.js';

test('password hashing uses a salted non-reversible scrypt hash', async () => {
    const first = await hashPassword('a long test password');
    const second = await hashPassword('a long test password');

    assert.match(first, /^scrypt\$16384\$8\$1\$/);
    assert.notEqual(first, second);
    assert.equal(await verifyPassword('a long test password', first), true);
    assert.equal(await verifyPassword('incorrect password', first), false);
});

test('protected API rejects a request without a bearer token', async () => {
    const app = new Hono();
    app.get('/private', requireAuth, (c) => c.json({ success: true }));
    const response = await app.request('/private');

    assert.equal(response.status, 401);
});

test('role guard rejects a user without the required role', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
        c.set('authUser', { role: 'VIEWER' });
        await next();
    });
    app.get('/admin', requireRole('ADMIN'), (c) => c.json({ success: true }));
    const response = await app.request('/admin');

    assert.equal(response.status, 403);
});
