import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../database/connection.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
    createUser,
    login,
    logout,
    publicUser,
    updateProfile,
    updateUser,
} from '../services/auth.service.js';

export const authRouter = new Hono();

const LoginSchema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(128),
});
const CreateUserSchema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(12).max(128),
    role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']),
    deviceIds: z.array(z.string().trim().min(1)).max(100).optional(),
});
const UpdateUserSchema = z.object({
    role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']).optional(),
    active: z.boolean().optional(),
    deviceIds: z.array(z.string().trim().min(1)).max(100).optional(),
}).refine((value) => Object.keys(value).length > 0);
const UpdateProfileSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    email: z.string().email().max(254).optional(),
    newPassword: z.string().min(12).max(128).optional(),
}).refine(({ email, newPassword }) => email !== undefined || newPassword !== undefined);

authRouter.post('/login', async (c) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, message: 'Invalid email or password' }, 400);
    }
    const session = await login(parsed.data.email, parsed.data.password);
    if (!session) {
        return c.json({ success: false, message: 'Invalid email or password' }, 401);
    }
    return c.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: session.user,
    });
});

authRouter.get('/me', requireAuth, async (c) => {
    const { id, email, role, active, deviceIds } = c.get('authUser');
    return c.json({ success: true, user: { id, email, role, active, deviceIds } });
});

authRouter.post('/logout', requireAuth, async (c) => {
    await logout(c.req.header('authorization').slice(7));
    return c.json({ success: true });
});

authRouter.patch('/me', requireAuth, async (c) => {
    const parsed = UpdateProfileSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, message: 'Invalid profile update', issues: parsed.error.flatten() }, 400);
    }
    try {
        const result = await updateProfile({
            userId: c.get('authUser').id,
            token: c.req.header('authorization').slice(7),
            ...parsed.data,
        });
        if (result.error === 'INVALID_PASSWORD') {
            return c.json({ success: false, message: 'Current password is incorrect' }, 401);
        }
        return c.json({ success: true, user: result.user });
    } catch (error) {
        if (error?.code === 'P2002') {
            return c.json({ success: false, message: 'An account with this email already exists' }, 409);
        }
        throw error;
    }
});

authRouter.get('/users', requireAuth, requireRole('ADMIN'), async (c) => {
    const users = await prisma.user.findMany({
        orderBy: { email: 'asc' },
        include: { assignments: { select: { deviceId: true } } },
    });
    return c.json({ success: true, users: users.map(publicUser) });
});

authRouter.post('/users', requireAuth, requireRole('ADMIN'), async (c) => {
    const parsed = CreateUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, message: 'Invalid user data', issues: parsed.error.flatten() }, 400);
    }
    try {
        const user = await createUser(parsed.data, c.get('authUser').id);
        return c.json({ success: true, user: publicUser(user) }, 201);
    } catch (error) {
        if (error?.code === 'P2002') {
            return c.json({ success: false, message: 'An account with this email already exists' }, 409);
        }
        if (error?.code === 'P2003') {
            return c.json({ success: false, message: 'One or more assigned devices do not exist' }, 400);
        }
        throw error;
    }
});

authRouter.patch('/users/:id', requireAuth, requireRole('ADMIN'), async (c) => {
    const parsed = UpdateUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, message: 'Invalid user update', issues: parsed.error.flatten() }, 400);
    }
    try {
        const user = await updateUser(c.req.param('id'), parsed.data, c.get('authUser').id);
        return user
            ? c.json({ success: true, user: publicUser(user) })
            : c.json({ success: false, message: 'User not found' }, 404);
    } catch (error) {
        if (error?.code === 'LAST_ADMIN' || error?.code === 'SELF_DEACTIVATION') {
            return c.json({ success: false, message: error.message }, 409);
        }
        if (error?.code === 'P2003') {
            return c.json({ success: false, message: 'One or more assigned devices do not exist' }, 400);
        }
        throw error;
    }
});
