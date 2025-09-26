import pg from 'pg';

const testConnection = async () => {
    const pool = new pg.Pool({
        connectionString: 'postgresql://db_ghip_user:CuHnDo1hIo0RmtxDX28CbWs4sKX2lgQa@dpg-d3b3novfte5s739ejob0-a.oregon-postgres.render.com:5432/db_ghip',
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log('Attempting to connect to the database...');
        const client = await pool.connect();
        console.log('Successfully connected to the database!');
        
        // Test a simple query
        const result = await client.query('SELECT NOW()');
        console.log('Current database time:', result.rows[0].now);
        
        client.release();
    } catch (error) {
        console.error('Error connecting to the database:');
        console.error(error);
    } finally {
        await pool.end();
    }
};

testConnection();
