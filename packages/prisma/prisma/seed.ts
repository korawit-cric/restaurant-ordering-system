import 'dotenv/config';
import { randomBytes, scryptSync } from 'node:crypto';
import prisma from '../src';
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      'Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD (12+ characters) to seed a platform operator.',
    );
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.platformRole !== 'OPERATOR')
    throw new Error(
      'This email belongs to a restaurant user; choose a different operator email.',
    );
  if (!existing) {
    const salt = randomBytes(16).toString('hex');
    await prisma.user.create({
      data: {
        email,
        platformRole: 'OPERATOR',
        passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      },
    });
  }
  console.log('Platform operator ready. Restaurants register through /signup.');
}
main().finally(() => prisma.$disconnect());
