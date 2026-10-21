import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { pool } from '@repo/database';

// Sign-in is enabled when a GitHub OAuth app is configured (AUTH_GITHUB_ID, AUTH_GITHUB_SECRET, AUTH_SECRET).
// Without it Open Eye runs as a single shared workspace (lib/auth/context.ts).
export const authConfigured = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && process.env.AUTH_SECRET);

/** Creates the user on first sign-in, with a personal workspace in which they are the maintainer. */
async function provisionUser(profile: { id?: unknown; login?: unknown; name?: unknown; email?: unknown; avatar_url?: unknown }): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(
      `INSERT INTO users (github_id, login, name, email, avatar_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login, name = EXCLUDED.name,
         email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url, last_seen_at = NOW()
       RETURNING id, (xmax = 0) AS created`,
      [Number(profile.id), String(profile.login || ''), profile.name ? String(profile.name) : null,
       profile.email ? String(profile.email) : null, profile.avatar_url ? String(profile.avatar_url) : null]
    );
    const userId: string = user.rows[0].id;
    const member = await client.query('SELECT 1 FROM workspace_members WHERE user_id = $1 LIMIT 1', [userId]);
    if (member.rowCount === 0) {
      const ws = await client.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [`${String(profile.login || 'My')} workspace`]);
      await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'maintainer')`, [ws.rows[0].id, userId]);
    }
    await client.query('COMMIT');
    return userId;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: authConfigured ? [GitHub] : [],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) token.userId = await provisionUser(profile as any);
      return token;
    },
    async session({ session, token }) {
      if (token.userId) (session as any).userId = token.userId;
      return session;
    }
  }
});
