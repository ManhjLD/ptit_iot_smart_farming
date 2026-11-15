import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from '../database/connection.js';

const scrypt = promisify(scryptCallback);
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const PASSWORD_HASH_BYTES = 64;

const normalizeEmail = (email) => email.trim().toLowerCase();
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password) {
    const salt = randomBytes(16);
    const derivedKey = await scrypt(password, salt, PASSWORD_HASH_BYTES, {
        N: 16384,
        r: 8,
        p: 1,
    });
    return `scrypt$16384$8$1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password, encodedHash) {
    const [algorithm, n, r, p, saltHex, keyHex] = encodedHash.split('$');
    if (algorithm !== 'scrypt' || !saltHex || !keyHex) {
        throw new Error('Unsupported password hash format');
    }

    const expected = Buffer.from(keyHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function login(email, password) {
    const user = await prisma.user.findUnique({
        where: { email: normalizeEmail(email) },
        include: { assignments: { select: { deviceId: true } } },
    });
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
        return null;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await prisma.userSession.create({
        data: { tokenHash: hashToken(token), userId: user.id, expiresAt },
    });
    return { token, expiresAt, user: publicUser(user) };
}

export async function authenticate(token) {
    if (!token) return null;
    const session = await prisma.userSession.findUnique({
        where: { tokenHash: hashToken(token) },
        include: {
            user: {
                include: { assignments: { select: { deviceId: true } } },
            },
        },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) {
        return null;
    }
    return {
        ...publicUser(session.user),
        deviceIds: session.user.assignments.map(({ deviceId }) => deviceId),
    };
}

export async function logout(token) {
    if (!token) return;
    await prisma.userSession.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
    });
}

export async function updateProfile({ userId, token, currentPassword, email, newPassword }) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { assignments: { select: { deviceId: true } } },
    });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
        return { error: 'INVALID_PASSWORD' };
    }

    const data = {};
    if (email !== undefined) data.email = normalizeEmail(email);
    if (newPassword !== undefined) data.passwordHash = await hashPassword(newPassword);
    return prisma.$transaction(async (transaction) => {
        const updated = await transaction.user.update({ where: { id: userId }, data });
        await transaction.auditEvent.create({
            data: {
                actorUserId: userId,
                action: 'PROFILE_UPDATED',
                targetType: 'user',
                targetId: userId,
                outcome: 'success',
                details: {
                    emailChanged: email !== undefined && email !== user.email,
                    passwordChanged: newPassword !== undefined,
                },
            },
        });
        if (newPassword !== undefined) {
            await transaction.userSession.updateMany({
                where: {
                    userId,
                    revokedAt: null,
                    tokenHash: { not: hashToken(token) },
                },
                data: { revokedAt: new Date() },
            });
        }
        return { user: publicUser({ ...updated, assignments: user.assignments }) };
    });
}



export async function createUser({ email, password, role, deviceIds = [] }, actorUserId = null) {
    const passwordHash = await hashPassword(password);
    return prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
            data: {
                email: normalizeEmail(email),
                passwordHash,
                role,
                assignments: {
                    create: [...new Set(deviceIds)].map((deviceId) => ({
                        device: { connect: { deviceId } },
                    })),
                },
            },
            include: { assignments: { select: { deviceId: true } } },
        });
        if (actorUserId) {
            await transaction.auditEvent.create({
                data: {
                    actorUserId,
                    action: 'USER_CREATED',
                    targetType: 'user',
                    targetId: user.id,
                    outcome: 'success',
                    details: { email: user.email, role: user.role },
                },
            });
        }
        return user;
    });
}

export async function updateUser(id, { role, active, deviceIds }, actorUserId) {
    return prisma.$transaction(async (transaction) => {
        const user = await transaction.user.findUnique({ where: { id } });
        if (!user) return null;

        const losesAdminAccess = user.role === 'ADMIN' &&
            (role !== undefined && role !== 'ADMIN' || active === false);
        if (losesAdminAccess) {
            const activeAdmins = await transaction.user.count({
                where: { role: 'ADMIN', active: true },
            });
            if (activeAdmins <= 1) {
                const error = new Error('At least one active administrator must remain');
                error.code = 'LAST_ADMIN';
                throw error;
            }
        }

        const data = {};
        if (role !== undefined) data.role = role;
        if (active !== undefined) data.active = active;
        if (id === actorUserId && active === false) {
            const error = new Error('Administrators cannot deactivate their own account');
            error.code = 'SELF_DEACTIVATION';
            throw error;
        }
        const updated = await transaction.user.update({ where: { id }, data });

        if (deviceIds !== undefined) {
            await transaction.deviceAssignment.deleteMany({ where: { userId: id } });
            if (deviceIds.length) {
                await transaction.deviceAssignment.createMany({
                    data: [...new Set(deviceIds)].map((deviceId) => ({ userId: id, deviceId })),
                });
            }
        }
        await transaction.auditEvent.create({
            data: {
                actorUserId,
                action: 'USER_UPDATED',
                targetType: 'user',
                targetId: id,
                outcome: 'success',
                details: {
                    role: role ?? user.role,
                    active: active ?? user.active,
                    ...(deviceIds !== undefined ? { deviceIds } : {}),
                },
            },
        });
        if (active === false) {
            await transaction.userSession.updateMany({
                where: { userId: id, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        }
        return transaction.user.findUnique({
            where: { id: updated.id },
            include: { assignments: { select: { deviceId: true } } },
        });
    }, { isolationLevel: 'Serializable' });
}

export function publicUser(user) {
    return {
        id: user.id,
        email: user.email,
        role: user.role,
        active: user.active,
        deviceIds: user.assignments?.map(({ deviceId }) => deviceId) ?? [],
    };
}

export function sessionDurationMs() {
    return SESSION_DURATION_MS;
}
