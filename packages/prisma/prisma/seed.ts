import 'dotenv/config';
import { randomBytes, scryptSync } from 'node:crypto';
import prisma from '../src';
function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
async function main() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12)
    throw new Error(
      'Set ADMIN_PASSWORD to at least 12 characters before seeding.',
    );
  for (const role of ['ADMIN', 'STAFF'] as const) {
    const email = process.env[`${role}_EMAIL`];
    const secret = process.env[`${role}_PASSWORD`];
    if (!email || !secret) continue;
    if (secret.length < 12)
      throw new Error(`${role}_PASSWORD must be at least 12 characters`);
    await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: {},
      create: {
        email: email.toLowerCase(),
        passwordHash: passwordHash(secret),
        role,
      },
    });
  }
  const menu: [string, [string, string][]][] = [
    [
      'Beer',
      [
        ['Leo', '80'],
        ['Chang', '80'],
        ['Singha', '90'],
      ],
    ],
    ['Whisky', [['Regency', '390']]],
    [
      'Mixers',
      [
        ['Soda', '25'],
        ['Drinking water', '20'],
      ],
    ],
    [
      'Soft Drinks',
      [
        ['Coke', '30'],
        ['Coke Zero', '30'],
      ],
    ],
    [
      'Food',
      [
        ['French fries', '89'],
        ['Fried chicken', '129'],
      ],
    ],
  ];
  for (const [i, [name, items]] of menu.entries()) {
    const id = `seed-category-${i}`;
    await prisma.menuCategory.upsert({
      where: { id },
      update: {},
      create: { id, name, sortOrder: i },
    });
    for (const [j, [item, price]] of items.entries())
      await prisma.menuItem.upsert({
        where: { id: `seed-item-${i}-${j}` },
        update: {},
        create: {
          id: `seed-item-${i}-${j}`,
          name: item,
          price,
          categoryId: id,
          sortOrder: j,
        },
      });
  }
  for (const name of ['A1', 'A2', 'A3', 'A7', 'B1', 'B2'])
    await prisma.table.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  console.log(
    'Seed complete. Sign in to /staff/login and open Admin → Tables for QR links.',
  );
}
main().finally(() => prisma.$disconnect());
