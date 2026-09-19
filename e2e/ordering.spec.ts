import { test, expect } from '@playwright/test';
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const password = randomUUID();
let token: string;
test.beforeAll(async () => {
  const salt = randomBytes(16).toString('hex');
  await prisma.user.upsert({
    where: { email: 'browser@example.com' },
    update: {
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
    create: {
      email: 'browser@example.com',
      role: 'ADMIN',
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
  });
  const table = await prisma.table.upsert({
    where: { name: 'A7' },
    update: { active: true },
    create: { name: 'A7' },
  });
  token = table.qrToken;
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
        ['Coke', '30'],
        ['Coke Zero', '30'],
        ['Soda', '25'],
        ['Drinking water', '20'],
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
  await prisma.menuItem.updateMany({ data: { active: false } });
  await prisma.menuCategory.updateMany({ data: { active: false } });
  for (const [i, [name, items]] of menu.entries()) {
    const category = await prisma.menuCategory.upsert({
      where: { id: `browser-cat-${i}` },
      update: { active: true },
      create: { id: `browser-cat-${i}`, name, sortOrder: i },
    });
    for (const [j, [item, price]] of items.entries())
      await prisma.menuItem.upsert({
        where: { id: `browser-item-${i}-${j}` },
        update: { active: true, available: item !== 'Singha', price },
        create: {
          id: `browser-item-${i}-${j}`,
          name: item,
          price,
          categoryId: category.id,
          sortOrder: j,
          available: item !== 'Singha',
        },
      });
  }
});
test.afterAll(async () => prisma.$disconnect());
test('mobile ordering, uncertain retry, staff fulfillment and admin sold-out control', async ({
  page,
  browser,
}) => {
  await page.goto('/staff/login');
  await page.getByLabel('Email').fill('browser@example.com');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in →' }).click();
  await expect(
    page.getByRole('heading', { name: 'Keep the rounds moving.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Live connection', { exact: false }),
  ).toBeVisible();
  const customer = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await customer.newPage();
  await mobile.goto(`/t/${token}`);
  await expect(
    mobile.getByRole('heading', { name: 'What sounds good?' }),
  ).toBeVisible();
  await mobile
    .getByRole('button', { name: 'Add one Leo', exact: true })
    .click();
  await mobile
    .getByRole('button', { name: 'Add one Leo', exact: true })
    .click();
  await mobile
    .getByRole('button', { name: 'Add one Coke', exact: true })
    .click();
  await mobile.screenshot({
    path: 'artifacts/customer-menu.png',
    fullPage: true,
  });
  await mobile.getByRole('button', { name: 'View order →' }).click();
  await expect(mobile.getByText('฿190', { exact: true })).toBeVisible();
  // Let the first request commit, then lose its response. A reload must recover the same order.
  let intercepted = false;
  await mobile.route('**/api/public/tables/*/orders', async (route) => {
    if (!intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  const before = await prisma.order.count();
  await mobile.getByRole('button', { name: 'Place order · ฿190' }).click();
  await expect(
    mobile.getByRole('button', { name: 'Retry this order safely' }),
  ).toBeVisible();
  await mobile.reload();
  await expect(
    mobile.getByRole('button', { name: 'Retry this order safely' }),
  ).toBeVisible();
  await mobile.getByRole('button', { name: 'Retry this order safely' }).click();
  await expect(
    mobile.getByRole('heading', { name: 'Order received.' }),
  ).toBeVisible();
  expect(await prisma.order.count()).toBe(before + 1);
  const id = new URL(mobile.url()).pathname.split('/').at(-1)!;
  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  const card = page
    .locator('.order-card')
    .filter({ has: page.getByText(`#${order.orderNumber}`, { exact: true }) });
  await expect(card).toBeVisible();
  await page.screenshot({
    path: 'artifacts/staff-dashboard.png',
    fullPage: true,
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await card.getByRole('button', { name: 'Cash received' }).click();
  await expect(card.getByText('PAID', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Accept order →' }).click();
  await card.getByRole('button', { name: 'Start preparing →' }).click();
  await card.getByRole('button', { name: 'Mark served →' }).click();
  await expect(card).toHaveCount(0);
  await expect(mobile.getByText('SERVED', { exact: true })).toBeVisible();
  await expect(mobile.getByText('PAID', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Keep the rounds moving.' }),
  ).toBeVisible();
  await page.goto('/admin/menu');
  const row = page
    .locator('.management-row')
    .filter({ has: page.getByText('Leo', { exact: true }) });
  await row.getByRole('checkbox').click();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(row.getByText('Sold out')).toBeVisible();
  await mobile.getByRole('link', { name: 'Order another round →' }).click();
  const leo = mobile
    .locator('.menu-row')
    .filter({ has: mobile.getByRole('heading', { name: 'Leo', exact: true }) });
  await expect(leo.getByText('Sold out')).toBeVisible();
  await page.goto('/admin/tables');
  await page
    .locator('.table-card')
    .filter({ has: page.getByRole('heading', { name: 'A7', exact: true }) })
    .getByRole('button', { name: 'Print / download' })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'artifacts/table-qr.png', fullPage: true });
  expect(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await customer.close();
});
