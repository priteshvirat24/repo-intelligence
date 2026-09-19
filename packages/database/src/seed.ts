import * as fs from 'fs';
import * as path from 'path';
import { pool, query } from './client.js';

async function seed() {
  console.log('Seeding canonical capabilities...');
  const seedPath = path.resolve(__dirname, '../seed/canonical_capabilities.sql');
  const sql = fs.readFileSync(seedPath, 'utf8');

  try {
    await query(sql);
    console.log('Canonical capabilities seeded successfully.');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
