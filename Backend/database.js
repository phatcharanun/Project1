const { Pool } = require('pg');

const requiredEnvironment = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const name of requiredEnvironment) {
    if (!process.env[name]) {
        throw new Error(`${name} must be set`);
    }
}

const port = Number(process.env.DB_PORT || 5432);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port');
}

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: 10,
    connectionTimeoutMillis: 5000
});

pool.on('error', error => {
    console.error('Unexpected PostgreSQL pool error:', error);
});

module.exports = pool;