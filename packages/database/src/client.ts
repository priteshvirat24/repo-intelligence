import { Pool, QueryResult, QueryResultRow } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root if not already set
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const connectionString =
  process.env.DATABASE_POOLED_URL ||
  process.env.DATABASE_URL ||
  'postgres://postgres:postgrespassword@localhost:5432/repo_intelligence';

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (process.env.DEBUG_SQL === 'true') {
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('Database query error:', { text, error });
    throw error;
  }
}

export async function checkConnection(): Promise<boolean> {
  try {
    const res = await query('SELECT 1 as connected');
    return res.rows[0]?.connected === 1;
  } catch (err) {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
