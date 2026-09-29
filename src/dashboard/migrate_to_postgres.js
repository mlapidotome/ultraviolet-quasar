const Database = require('better-sqlite3');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const sqlitePath = path.join(__dirname, '../../data/bali.sqlite');
const sqliteDb = new Database(sqlitePath, { fileMustExist: true });

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrateTable(client, tableName) {
  console.log(`Migrating ${tableName}...`);
  let rows;
  try {
    rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
  } catch (err) {
    console.error(`Error reading ${tableName} from SQLite: ${err.message}`);
    return;
  }
  
  if (rows.length === 0) {
    console.log(`No records found in ${tableName}.`);
    return;
  }
  
  let successCount = 0;
  for (const row of rows) {
    const keys = Object.keys(row);
    const values = Object.values(row);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.map(k => `"${k}"`).join(', ');
    
    try {
      await client.query(
        `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values
      );
      successCount++;
    } catch (err) {
      if (err.code === '42601') { 
        try {
          await client.query(`INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders})`, values);
          successCount++;
        } catch (innerErr) {
          // ignore duplicate key errors, etc.
        }
      } else if (err.code === '23505') {
        // ignore unique violation
      } else {
        console.error(`Insert failed for ${tableName}:`, err.message);
      }
    }
  }
  console.log(`Processed ${rows.length} records for ${tableName}.`);
}

async function migrate() {
  const client = await pgPool.connect();
  
  try {
    const tables = [
      'users',
      'sessions',
      'acompanhamentos',
      'acompanhamentos_historico',
      'reunioes_resumos'
    ];

    for (const table of tables) {
      await migrateTable(client, table);
    }

    console.log('Migrating JSON files to kv_store...');
    const jsonFiles = [
      'bali_test_33a.json',
      'telefones_cache.json',
      'cache_historicos.json'
    ];

    for (const file of jsonFiles) {
      const filePath = path.join(__dirname, '../../data', file);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        try {
          await client.query(
            'INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [file, data]
          );
          console.log(`Migrated ${file} to kv_store.`);
        } catch (err) {
           try {
             await client.query('INSERT INTO kv_store (key, value) VALUES ($1, $2)', [file, data]);
             console.log(`Migrated ${file} to kv_store (fallback).`);
           } catch(e) {
             console.error(`Failed to insert ${file} into kv_store:`, e.message);
           }
        }
      } else {
        console.log(`File not found: ${file}`);
      }
    }

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    sqliteDb.close();
    await pgPool.end();
  }
}

migrate();
