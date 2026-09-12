require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { getPool, SCHEMA_NAME } = require('../src/config/db');

async function ensureMigrationsTable(client) {
    await client.query(`
        CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME};
        CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}.schema_migrations (
            id bigserial PRIMARY KEY,
            filename text NOT NULL UNIQUE,
            applied_at timestamptz NOT NULL DEFAULT now()
        );
    `);
}

async function getAppliedMigrations(client) {
    const result = await client.query(`SELECT filename FROM ${SCHEMA_NAME}.schema_migrations ORDER BY filename ASC;`);
    return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(client, filePath) {
    const sql = fs.readFileSync(filePath, 'utf8');

    await client.query('BEGIN;');
    try {
        await client.query(sql);
        await client.query(`INSERT INTO ${SCHEMA_NAME}.schema_migrations (filename) VALUES ($1);`, [path.basename(filePath)]);
        await client.query('COMMIT;');
        console.log(`Applied ${path.basename(filePath)}`);
    } catch (error) {
        await client.query('ROLLBACK;');
        throw error;
    }
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required to run migrations');
    }

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

    if (!migrationFiles.length) {
        console.log('No migrations found.');
        return;
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
        await ensureMigrationsTable(client);
        const applied = await getAppliedMigrations(client);

        for (const file of migrationFiles) {
            if (applied.has(file)) {
                continue;
            }

            await applyMigration(client, path.join(migrationsDir, file));
        }
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
});
