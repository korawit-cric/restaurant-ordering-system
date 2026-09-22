/* TEST_DATABASE_URL must point to a disposable database named *_test. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error('Use a dedicated *_test database');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_ORIGIN = 'http://localhost:3010';
process.env.RESEND_API_KEY = 're_integration_test';
process.env.EMAIL_FROM = 'Orderly <test@example.com>';

const realFetch = global.fetch;
const sent = [];
global.fetch = (input, options) => {
  if (String(input) === 'https://api.resend.com/emails') {
    sent.push(JSON.parse(options.body));
    return Promise.resolve(
      new Response(JSON.stringify({ id: randomUUID() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
  return realFetch(input, options);
};

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/app.module');
const prisma = require('@repo/prisma').default;
let app;

async function main() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuthSession","PasswordReset","StaffInvitation","BranchUser","OrderItem","Order","OrderSession","Product","MenuCategory","Menu","ServicePoint","BranchSettings","Subscription","Branch","Tenant","User" CASCADE',
  );
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function request(path, method = 'GET', body, cookie) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: process.env.APP_ORIGIN,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  async function signup(name) {
    const result = await request('/auth/signup', 'POST', {
      name,
      slug: name.toLowerCase(),
      branchName: 'Main',
      preset: 'QUICK_SERVICE',
      email: `${name.toLowerCase()}@example.com`,
      password: 'StrongPassword123!',
    });
    assert.equal(result.status, 201, JSON.stringify(result));
    return result;
  }
  const alpha = await signup('Alpha');
  const bravo = await signup('Bravo');

  const unknown = await request('/auth/password/request', 'POST', {
    email: 'missing@example.com',
  });
  assert.equal(unknown.status, 200);
  assert.equal(sent.length, 0);
  const resetRequest = await request('/auth/password/request', 'POST', {
    email: 'alpha@example.com',
  });
  assert.equal(resetRequest.status, 200);
  assert.equal(resetRequest.body.message, unknown.body.message);
  assert.equal(sent.length, 1);
  const resetToken = sent[0].text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal(
    (await prisma.passwordReset.findFirstOrThrow()).tokenHash === resetToken,
    false,
  );
  assert.equal(
    (
      await request('/auth/password/reset', 'POST', {
        token: '0'.repeat(64),
        password: 'AnotherStrong123!',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/auth/password/reset', 'POST', {
        token: resetToken,
        password: 'AnotherStrong123!',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request('/auth/password/reset', 'POST', {
        token: resetToken,
        password: 'ThirdStrong123!',
      })
    ).status,
    400,
  );
  assert.equal(
    (await request('/auth/me', 'GET', undefined, alpha.cookie)).status,
    401,
  );
  assert.equal(
    (
      await request('/auth/login', 'POST', {
        email: 'alpha@example.com',
        password: 'StrongPassword123!',
      })
    ).status,
    401,
  );
  const alphaAgain = await request('/auth/login', 'POST', {
    email: 'alpha@example.com',
    password: 'AnotherStrong123!',
  });
  assert.equal(alphaAgain.status, 200);

  const invitation = await request(
    '/restaurant/invitations',
    'POST',
    { email: 'staff@example.com', role: 'STAFF' },
    alphaAgain.cookie,
  );
  assert.equal(invitation.status, 201, JSON.stringify(invitation));
  const inviteToken = sent.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
  const detail = await request(`/auth/invitations/${inviteToken}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.restaurant, 'Alpha');
  assert.equal(detail.body.needsPassword, true);
  assert.equal(
    (
      await request(`/auth/invitations/${inviteToken}/accept`, 'POST', {
        password: 'StaffPassword123!',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/auth/invitations/${inviteToken}/accept`, 'POST', {
        password: 'StaffPassword123!',
      })
    ).status,
    400,
  );
  const staff = await request('/auth/login', 'POST', {
    email: 'staff@example.com',
    password: 'StaffPassword123!',
  });
  assert.equal(staff.status, 200);
  assert.equal(
    (await request('/restaurant/invitations', 'GET', undefined, staff.cookie))
      .status,
    403,
  );
  assert.equal(
    (await request('/restaurant/invitations', 'GET', undefined, bravo.cookie))
      .body.length,
    0,
  );

  const revocable = await request(
    '/restaurant/invitations',
    'POST',
    { email: 'revoked@example.com', role: 'STAFF' },
    alphaAgain.cookie,
  );
  assert.equal(revocable.status, 201);
  const revokedToken = sent.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal(
    (
      await request(
        `/restaurant/invitations/${revocable.body.id}`,
        'DELETE',
        {},
        bravo.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/restaurant/invitations/${revocable.body.id}`,
        'DELETE',
        {},
        alphaAgain.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/auth/invitations/${revokedToken}`)).status,
    404,
  );

  const another = await request(
    '/restaurant/invitations',
    'POST',
    { email: 'staff@example.com', role: 'MANAGER' },
    bravo.cookie,
  );
  assert.equal(another.status, 201);
  const existingToken = sent.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal(
    (await request(`/auth/invitations/${existingToken}`)).body.needsPassword,
    false,
  );
  assert.equal(
    (await request(`/auth/invitations/${existingToken}/accept`, 'POST', {}))
      .status,
    200,
  );
  const memberships = await request('/auth/me', 'GET', undefined, staff.cookie);
  assert.equal(memberships.body.memberships.length, 2);
  assert.equal(
    (
      await request(
        '/auth/context',
        'POST',
        { branchId: bravo.body.branch.id },
        staff.cookie,
      )
    ).status,
    200,
  );
  console.log(
    'PASS password reset one-use and session revocation, invitation acceptance and tenant membership',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });
