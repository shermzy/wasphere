process.env.ARGON2_MEMORY_KB = process.env.ARGON2_MEMORY_KB || '1024';
process.env.ARGON2_TIME_COST = process.env.ARGON2_TIME_COST || '2';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const argon2 = require('argon2');
const { AuthService } = require('../dist/auth/auth.service.js');
const { hashInviteToken } = require('../dist/team/team.service.js');

const jwt = { sign: () => 'access-token' };
const mail = { sendPasswordResetEmail: async () => true };

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mutex() {
  let tail = Promise.resolve();
  return async () => {
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const previous = tail;
    tail = next;
    await previous;
    return release;
  };
}

function auth(prisma) {
  return new AuthService(prisma, jwt, mail);
}

function bootstrapPrisma() {
  const state = { users: [], workspaces: [], members: [], roles: [], refreshTokens: [] };
  const acquire = mutex();
  let lockCalls = 0;
  let nextId = 1;
  const id = (prefix) => `${prefix}-${nextId++}`;

  function transaction() {
    let release;
    const tx = {
      $executeRaw: async () => {
        lockCalls += 1;
        release = await acquire();
      },
      user: {
        count: async () => state.users.length,
        findUnique: async ({ where }) => state.users.find((user) => user.email === where.email) ?? null,
        create: async ({ data }) => {
          const user = { id: id('user'), ...data };
          state.users.push(user);
          return user;
        },
      },
      workspace: {
        create: async ({ data }) => {
          const workspace = { id: id('workspace'), ...data };
          state.workspaces.push(workspace);
          return workspace;
        },
      },
      workspaceMember: {
        create: async ({ data }) => {
          state.members.push({ id: id('member'), ...data });
        },
      },
      customRole: {
        create: async ({ data }) => {
          state.roles.push({ id: id('role'), ...data });
        },
      },
    };
    return { tx, finish: () => release?.() };
  }

  return {
    state,
    lockCalls: () => lockCalls,
    user: { count: async () => state.users.length },
    refreshToken: {
      create: async ({ data }) => state.refreshTokens.push({ id: id('refresh'), ...data }),
    },
    $transaction: async (callback) => {
      const current = transaction();
      try {
        return await callback(current.tx);
      } finally {
        current.finish();
      }
    },
  };
}

function invitePrisma() {
  const state = {
    users: [{ id: 'owner', email: 'owner@example.com', passwordHash: 'unused' }],
    members: [{ workspaceId: 'workspace', userId: 'owner', role: 'OWNER' }],
    refreshTokens: [],
    invite: {
      id: 'invite',
      workspaceId: 'workspace',
      tokenHash: hashInviteToken('invite-token'),
      role: 'MEMBER',
      customRoleId: null,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      workspace: { name: 'Test workspace' },
    },
  };
  let nextId = 1;

  const root = {
    refreshToken: {
      create: async ({ data }) => state.refreshTokens.push({ id: `refresh-${nextId++}`, ...data }),
    },
    $transaction: async (callback) => {
      const createdUsers = [];
      const createdMembers = [];
      const tx = {
        workspaceInvite: {
          findFirst: async ({ where }) => {
            const invite = state.invite;
            return invite.tokenHash === where.tokenHash && invite.acceptedAt === null && invite.expiresAt > where.expiresAt.gt
              ? { ...invite }
              : null;
          },
          updateMany: async ({ where, data }) => {
            if (state.invite.id !== where.id || state.invite.acceptedAt !== null || state.invite.expiresAt <= where.expiresAt.gt) {
              return { count: 0 };
            }
            state.invite.acceptedAt = data.acceptedAt;
            return { count: 1 };
          },
        },
        user: {
          findUnique: async ({ where }) => state.users.find((user) => user.email === where.email) ?? null,
          create: async ({ data }) => {
            const user = { id: `user-${nextId++}`, ...data };
            state.users.push(user);
            createdUsers.push(user);
            return user;
          },
        },
        workspaceMember: {
          upsert: async ({ where, create }) => {
            const existing = state.members.find(
              (member) => member.workspaceId === where.workspaceId_userId.workspaceId && member.userId === where.workspaceId_userId.userId,
            );
            if (existing) return existing;
            const member = { id: `member-${nextId++}`, ...create };
            state.members.push(member);
            createdMembers.push(member);
            return member;
          },
        },
      };
      try {
        return await callback(tx);
      } catch (error) {
        for (const member of createdMembers) state.members.splice(state.members.indexOf(member), 1);
        for (const user of createdUsers) state.users.splice(state.users.indexOf(user), 1);
        throw error;
      }
    },
  };
  return { state, prisma: root };
}

function refreshPrisma() {
  const rawToken = 'refresh-token';
  const state = {
    user: { id: 'user', email: 'refresh@example.com' },
    refreshTokens: [{ id: 'old', userId: 'user', tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() + 60_000), revokedAt: null }],
  };
  const prisma = {
    state,
    refreshToken: {
      findUnique: async ({ where }) => {
        const record = where.tokenHash
          ? state.refreshTokens.find((token) => token.tokenHash === where.tokenHash)
          : state.refreshTokens.find((token) => token.id === where.id);
        if (!record) return null;
        return where.tokenHash ? { ...record, user: state.user } : { revokedAt: record.revokedAt, expiresAt: record.expiresAt };
      },
      updateMany: async ({ where, data }) => {
        const matches = state.refreshTokens.filter((token) => token.userId === where.userId && token.revokedAt === null);
        for (const token of matches) token.revokedAt = data.revokedAt;
        return { count: matches.length };
      },
      create: async ({ data }) => state.refreshTokens.push({ id: `new-${state.refreshTokens.length}`, revokedAt: null, ...data }),
    },
    $transaction: async (callback) => callback({
      refreshToken: {
        updateMany: async ({ where, data }) => {
          const token = state.refreshTokens.find((candidate) => candidate.id === where.id && candidate.revokedAt === null && candidate.expiresAt > where.expiresAt.gt);
          if (!token) return { count: 0 };
          token.revokedAt = data.revokedAt;
          return { count: 1 };
        },
        create: async ({ data }) => state.refreshTokens.push({ id: `new-${state.refreshTokens.length}`, revokedAt: null, ...data }),
      },
    }),
  };
  return { rawToken, prisma };
}

function resetPrisma(user) {
  const rawToken = 'reset-token';
  const state = {
    user: { id: user.id, email: user.email, passwordHash: user.passwordHash },
    resetToken: { id: 'reset', userId: user.id, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() + 60_000), usedAt: null },
  };
  const prisma = {
    state,
    passwordResetToken: {
      findUnique: async ({ where }) => state.resetToken.tokenHash === where.tokenHash ? { ...state.resetToken } : null,
    },
    user: {
      findUnique: async ({ where }) => where.id === state.user.id ? { ...state.user } : null,
    },
    refreshToken: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (callback) => callback({
      passwordResetToken: {
        updateMany: async ({ where, data }) => {
          if (state.resetToken.id !== where.id || state.resetToken.usedAt !== null || state.resetToken.expiresAt <= where.expiresAt.gt) return { count: 0 };
          state.resetToken.usedAt = data.usedAt;
          return { count: 1 };
        },
      },
      user: { update: async ({ data }) => Object.assign(state.user, data) },
      refreshToken: { updateMany: async () => ({ count: 0 }) },
    }),
  };
  return { rawToken, prisma };
}

function assertOneWinner(results, message) {
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const loser = results.find((result) => result.status === 'rejected');
  assert.ok(loser);
  assert.match(String(loser.reason?.message ?? loser.reason), message);
}

test('bootstrap registration serializes the first owner transition', async () => {
  const prisma = bootstrapPrisma();
  const service = auth(prisma);
  const results = await Promise.allSettled([
    service.register({ email: 'a@example.com', password: 'password-a' }),
    service.register({ email: 'b@example.com', password: 'password-b' }),
  ]);

  assertOneWinner(results, /registration_locked/i);
  assert.equal(prisma.state.users.length, 1);
  assert.equal(prisma.lockCalls(), 2);
});

test('invite acceptance consumes once and rolls back the losing account', async () => {
  const { state, prisma } = invitePrisma();
  const service = auth(prisma);
  const results = await Promise.allSettled([
    service.acceptInvite({ token: 'invite-token', email: 'a@example.com', password: 'invite-password' }),
    service.acceptInvite({ token: 'invite-token', email: 'b@example.com', password: 'invite-password' }),
  ]);

  assertOneWinner(results, /invite is invalid or has expired/i);
  assert.equal(state.users.filter((user) => user.email.endsWith('@example.com') && user.email !== 'owner@example.com').length, 1);
  assert.equal(state.members.filter((member) => member.userId !== 'owner').length, 1);
  assert.ok(state.invite.acceptedAt);
});

test('refresh transition has one winner and retains reuse detection', async () => {
  const { rawToken, prisma } = refreshPrisma();
  const results = await Promise.allSettled([auth(prisma).refresh(rawToken), auth(prisma).refresh(rawToken)]);

  assertOneWinner(results, /refresh token reuse detected/i);
  assert.equal(prisma.state.refreshTokens.length, 2);
  assert.ok(prisma.state.refreshTokens.every((token) => token.revokedAt));
});

test('password reset transition consumes the token once', async () => {
  const passwordHash = await argon2.hash('old-password');
  const { rawToken, prisma } = resetPrisma({ id: 'user', email: 'reset@example.com', passwordHash });
  const results = await Promise.allSettled([
    auth(prisma).resetPassword(rawToken, 'new-password-a'),
    auth(prisma).resetPassword(rawToken, 'new-password-b'),
  ]);

  assertOneWinner(results, /invalid or expired reset token/i);
  assert.ok(prisma.state.resetToken.usedAt);
  assert.notEqual(
    await argon2.verify(prisma.state.user.passwordHash, 'new-password-a'),
    await argon2.verify(prisma.state.user.passwordHash, 'new-password-b'),
  );
});
