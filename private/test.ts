import db from '../src/config/db';

async function reportDBInfo() {
  try {
    const client = await db.connect();
    console.log('✅ Connected to PostgreSQL!');

    // List all databases
    const databases = await client.query(`
      SELECT datname AS database
      FROM pg_database
      WHERE datistemplate = false;
    `);
    console.log('📦 Databases:');
    databases.rows.forEach((db: any, index: number) => {
      console.log(`  ${index + 1}. ${db.database}`);
    });

    // Current connection info
    const connInfo = await client.query(`SELECT current_database(), current_user, inet_client_addr() AS client_ip;`);
    const info = connInfo.rows[0];
    console.log('\nℹ️ Connection Info:');
    console.log(`  Database   : ${info.current_database}`);
    console.log(`  User       : ${info.current_user}`);
    console.log(`  Client IP  : ${info.client_ip}`);

    // PostgreSQL server version
    const version = await client.query('SHOW server_version;');
    console.log(`  Version    : ${version.rows[0].server_version}`);

    // Tables in the current database
    const tables = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name;
    `);

    console.log('\n📄 Tables in current database:');
    if (tables.rows.length === 0) {
      console.log('  (no tables found)');
    } else {
      tables.rows.forEach((table: any, index: number) => {
        console.log(`  ${index + 1}. ${table.table_schema}.${table.table_name}`);
      });
    }

    client.release();
  } catch (err) {
    console.error('❌ Error reporting DB info:', err);
  } finally {
    db.end();
  }
}

reportDBInfo();
