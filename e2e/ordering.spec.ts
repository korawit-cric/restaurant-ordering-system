import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
test('self setup, mobile order retry, staff dashboard and sold-out toggle', async ({
  page,
  browser,
}) => {
  const slug = `bar-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Restaurant name').fill('Browser Bar');
  await page.getByLabel('Public slug').fill(slug);
  await page.getByLabel('Your email').fill(email);
  await page.getByLabel('Password (12+ characters)').fill('StrongPassword123!');
  await page.getByRole('button', { name: 'Create restaurant →' }).click();
  await expect(
    page.getByRole('heading', { name: 'Get ready to receive orders' }),
  ).toBeVisible();
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === 'ros_session',
  );
  expect(cookie).toBeDefined();
  const api = async (path: string, method = 'GET', body?: unknown) => {
    const r = await page.request.fetch(`http://localhost:3010/api${path}`, {
      method,
      headers: {
        Origin: 'http://localhost:3010',
        'Content-Type': 'application/json',
        Cookie: `ros_session=${cookie!.value}`,
      },
      data: body,
    });
    if (!r.ok()) throw new Error(`${path}: ${await r.text()}`);
    return r.json();
  };
  const cat = await api('/admin/categories', 'POST', {
    name: 'Beer',
    sortOrder: 1,
    active: true,
  });
  await api('/admin/products', 'POST', {
    name: 'Leo',
    categoryId: cat.id,
    price: '80',
    active: true,
    available: true,
    sortOrder: 1,
  });
  const point = await api('/restaurant/service-points', 'POST', {
    name: 'A7',
    type: 'TABLE',
  });
  await api('/restaurant/preset', 'POST', { preset: 'QUICK_SERVICE' });
  await page.goto('/staff/orders');
  await expect(
    page.getByRole('heading', { name: 'Orders to serve' }),
  ).toBeVisible();
  const customer = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await customer.newPage();
  await mobile.goto(`/q/${point.qrToken}`);
  await expect(
    mobile.getByRole('heading', { name: 'What sounds good?' }),
  ).toBeVisible();
  await mobile.getByRole('button', { name: 'Add one Leo' }).click();
  await mobile.getByRole('button', { name: 'Add one Leo' }).click();
  await mobile.screenshot({
    path: 'artifacts/customer-menu.png',
    fullPage: true,
  });
  await mobile.getByRole('button', { name: 'View order →' }).click();
  let lost = false;
  await mobile.route('**/api/public/q/*/orders', async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  const before = await prisma.order.count();
  await mobile.getByRole('button', { name: /Place order/ }).click();
  await expect(
    mobile.getByRole('button', { name: 'Retry this order safely' }),
  ).toBeVisible();
  await mobile.reload();
  await mobile.getByRole('button', { name: 'Retry this order safely' }).click();
  await expect(
    mobile.getByRole('heading', { name: 'Order received.' }),
  ).toBeVisible();
  expect(await prisma.order.count()).toBe(before + 1);
  const id = mobile.url().split('/').at(-1)!;
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
  await card.getByRole('button', { name: 'Accept →' }).click();
  await card.getByRole('button', { name: 'Preparing →' }).click();
  await card.getByRole('button', { name: 'Ready →' }).click();
  await card.getByRole('button', { name: 'Complete →' }).click();
  await expect(mobile.getByText('COMPLETED', { exact: true })).toBeVisible();
  await page.goto('/admin/menu');
  const row = page
    .locator('.management-row')
    .filter({ has: page.getByText('Leo', { exact: true }) });
  await row.getByRole('checkbox').click();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await mobile.getByRole('link', { name: 'Order again →' }).click();
  await expect(mobile.getByText('Sold out')).toBeVisible({ timeout: 15000 });
  await page.goto('/admin/service-points');
  await page.getByRole('button', { name: 'Show / print QR' }).click();
  await expect(page.getByText('SCAN TO ORDER')).toBeVisible();
  await page.screenshot({ path: 'artifacts/location-qr.png', fullPage: true });
  await customer.close();
});
