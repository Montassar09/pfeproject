const db = require('./config/db');

async function checkTables() {
  try {
    console.log('Checking database tables...\n');
    
    // Check specific tables we need
    const tablesToCheck = [
      'consommation_eau',
      'consommation_electricite', 
      'production_photovoltaique',
      'interventions',
      'alertes',
      'seuils',
      'equipements'
    ];
    
    for (const table of tablesToCheck) {
      try {
        const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`✓ ${table}: ${result.rows[0].count} records`);
      } catch (err) {
        console.log(`✗ ${table}: ERROR - ${err.message}`);
      }
    }
    
    console.log('\nChecking all tables in database:');
    const allTables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    allTables.rows.forEach(row => {
      console.log(`- ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('Database connection error:', error);
  } finally {
    await db.end();
  }
}

checkTables();
