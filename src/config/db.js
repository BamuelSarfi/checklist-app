const { Pool } = require('pg');

const SCHEMA_NAME = process.env.SCHEMA_NAME || 'kiosk';

let pool;

function getPool() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not configured');
    }

    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
            options: `-c search_path=${SCHEMA_NAME},public`,
        });

        // pg emits 'error' on the pool when an idle client hits a backend/network error
        // (e.g. Postgres restarts). With no listener, Node treats that as an uncaught
        // exception and kills the whole process - every concurrent kitchen session, not
        // just whatever query was in flight. Logging it lets the pool evict/replace the
        // bad connection on the next query instead.
        pool.on('error', (err) => {
            console.error('Unexpected Postgres pool error:', err.message);
        });
    }

    return pool;
}

async function query(text, params = []) {
    return getPool().query(text, params);
}

module.exports = {
    SCHEMA_NAME,
    getPool,
    query,
};
