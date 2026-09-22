process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://wasphere:wasphere_dev@localhost:5432/wasphere_test?sslmode=disable';
process.env.ARGON2_MEMORY_KB = process.env.ARGON2_MEMORY_KB || '1024';
process.env.ARGON2_TIME_COST = process.env.ARGON2_TIME_COST || '2';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const argon2 = require('argon2');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const { hashInviteToken } = require('../dist/team/team.service.js');

const prisma = new PrismaService();
const auth = new AuthService(
  prisma,
  { sign: (payload) => `access:${payload.sub}` },
  { sendPasswordResetEmail: async () => true },
);

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function clearUsers() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
}

async function seedWorkspace(email) {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'not-used-by-this-test' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Auth concurrency test', ownerId: user.id },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
  });
  return { user, workspace };
}

async function seedInvite(workspaceId, rawToken) {
  return prisma.workspaceInvite.create({
    data: {
      workspaceId,
      tokenHash: hashInviteToken(rawToken),
      role: 'MEMBER',
      createdBy: (await prisma.workspace.findUnique({ where: { id: workspaceId } })).ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

function assertOneWinner(results, loserMessage) {
  const summary = results.map((result) =>
    result.status === 'fulfilled' ? 'fulfilled' : String(result.reason?.message ?? result.reason),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, summary.join(' | '));
  const loser = results.find((result) => result.status === 'rejected');
  assert.ok(loser);
  assert.match(String(loser.reason?.message ?? loser.reason), loserMessage);
}

test.before(async () => {
  await prisma.$connect();
});

test.after(async () => {
  await clearUsers();
  await prisma.$disconnect();
});

test.beforeEach(async () => {
  await clearUsers();
});

test('bootstrap registration gives exactly one concurrent request the owner slot', async () => {
  const results = await Promise.allSettled([
    auth.register({ email: 'bootstrap-a@example.com', password: 'password-a' }),
    auth.register({ email: 'bootstrap-b@example.com', password: 'password-b' }),
  ]);

  assertOneWinner(results, /registration_locked/i);
  assert.equal(await prisma.user.count(), 1);
  assert.equal(await prisma.workspace.count(), 1);
  assert.equal(await prisma.workspaceMember.count({ where: { role: 'OWNER' } }), 1);
});

test('invite acceptance consumes one invite and rolls back the losing new account', async () => {
  const { workspace } = await seedWorkspace('invite-owner@example.com');
  const rawInviteToken = 'invite-race-token';
  await seedInvite(workspace.id, rawInviteToken);

  const emails = ['invite-a@example.com', 'invite-b@example.com'];
  const results = await Promise.allSettled(
    emails.map((email) => auth.acceptInvite({ token: rawInviteToken, email, password: 'invite-password' })),
  );

  assertOneWinner(results, /invite is invalid or has expired/i);
  const users = await prisma.user.findMany({ where: { email: { in: emails } } });
  assert.equal(users.length, 1);
  assert.equal(
    await prisma.workspaceMember.count({ where: { userId: { in: users.map((user) => user.id) } } }),
    1,
  );
  const invite = await prisma.workspaceInvite.findUnique({ where: { tokenHash: hashInviteToken(rawInviteToken) } });
  assert.ok(invite.acceptedAt);
});

test('concurrent refresh requests have one winner and preserve reuse detection', async () => {
  const { user } = await seedWorkspace('refresh-owner@example.com');
  const rawRefreshToken = 'refresh-race-token';
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: tokenHash(rawRefreshToken),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const results = await Promise.allSettled([
    auth.refresh(rawRefreshToken),
    auth.refresh(rawRefreshToken),
  ]);

  assertOneWinner(results, /refresh token reuse detected/i);
  const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((token) => token.revokedAt));
});

test('concurrent password resets have one winner and one token consumption', async () => {
  const passwordHash = await argon2.hash('old-password');
  const user = await prisma.user.create({ data: { email: 'reset-owner@example.com', passwordHash } });
  const rawResetToken = 'reset-race-token';
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: tokenHash(rawResetToken),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const results = await Promise.allSettled([
    auth.resetPassword(rawResetToken, 'new-password-a'),
    auth.resetPassword(rawResetToken, 'new-password-b'),
  ]);

  assertOneWinner(results, /invalid or expired reset token/i);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(rawResetToken) } });
  assert.ok(resetToken.usedAt);
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
  assert.ok(updatedUser);
  assert.notEqual(
    await argon2.verify(updatedUser.passwordHash, 'new-password-a'),
    await argon2.verify(updatedUser.passwordHash, 'new-password-b'),
  );
});
