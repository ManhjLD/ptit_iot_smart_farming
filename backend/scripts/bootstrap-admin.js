import 'dotenv/config';
import { prisma } from '../src/database/connection.js';
import { createUser } from '../src/services/auth.service.js';

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

try {
    if (!email || !password) {
        throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD for this command');
    }
    if (password.length < 12 || password.length > 128) {
        throw new Error('The initial administrator password must contain 12 to 128 characters');
    }
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (adminCount > 0) {
        throw new Error('An administrator already exists; use the authenticated user-management API');
    }

    await createUser({ email, password, role: 'ADMIN' });
    console.log(`Created initial administrator account: ${email.trim().toLowerCase()}`);
} finally {
    await prisma.$disconnect();
}
