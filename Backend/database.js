const { Pool } = require('pg');

function createPoolConfig(env) {
    const common = { max: 10, connectionTimeoutMillis: 5000 };

    // Cloud providers (Neon, Supabase, Render) give one connection string.
    // Include ?sslmode=require in it to connect over TLS.
    if (env.DATABASE_URL) {
        return { ...common, connectionString: env.DATABASE_URL };
    }

    for (const name of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
        if (!env[name]) {
            throw new Error(`DATABASE_URL or ${name} must be set`);
        }
    }

    const port = Number(env.DB_PORT || 5432);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('DB_PORT must be a valid TCP port');
    }

    return {
        ...common,
        host: env.DB_HOST || '127.0.0.1',
        port,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME
    };
}

const pool = new Pool(createPoolConfig(process.env));

pool.on('error', error => {
    console.error('Unexpected PostgreSQL pool error:', error);
});

module.exports = pool;
