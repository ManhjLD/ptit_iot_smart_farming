import { authenticate } from '../services/auth.service.js';

export async function requireAuth(c, next) {
    const authorization = c.req.header('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
    const user = match ? await authenticate(match[1]) : null;
    if (!user) {
        return c.json({ success: false, message: 'Authentication required' }, 401);
    }
    c.set('authUser', user);
    await next();
}

export function requireRole(...roles) {
    return async (c, next) => {
        const user = c.get('authUser');
        if (!user || !roles.includes(user.role)) {
            return c.json({ success: false, message: 'Insufficient permissions' }, 403);
        }
        await next();
    };
}

export function accessibleDeviceIds(user) {
    return user.role === 'ADMIN' ? undefined : user.deviceIds;
}
