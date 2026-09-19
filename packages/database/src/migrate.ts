import * as fs from 'fs';
import * as path from 'path';
import { pool, query } from './client.js';

export async function runMigrations() {
  const dimensions = process.env.EMBEDDING_DIMENSIONS || '1024';
  console.log(`[Database] Running migrations with EMBEDDING_DIMENSIONS=${dimensions}...`);

  const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const migrationsDir = path.resolve(currentDir, '../migrations');
  
  // Read and sort all .sql migration files
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.includes('alter_embedding'))
    .sort();

  for (const file of files) {
    console.log(`[Database] Applying migration: ${file}...`);
    const filePath = path.join(migrationsDir, file);
    let sql = fs.readFileSync(filePath, 'utf8');

    // Replace configurable dimension placeholder
    sql = sql.replace(/\{\{EMBEDDING_DIMENSIONS\}\}/g, dimensions);

    try {
      await query(sql);
      console.log(`[Database] Migration ${file} applied successfully.`);
    } catch (error) {
      console.error(`[Database] Migration ${file} failed:`, error);
      throw error;
    }
  }
}

// If run directly via tsx/node
if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch(() => {
      pool.end();
      process.exit(1);
    });
}
