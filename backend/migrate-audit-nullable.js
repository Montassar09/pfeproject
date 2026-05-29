// ============================================================
// MIGRATION : rendre audit_log.id_user nullable
// Exécuter une seule fois : node migrate-audit-nullable.js
// ============================================================
const db = require('./config/db');

async function migrate() {
  try {
    // Rendre la colonne nullable (si elle ne l'est pas déjà)
    await db.query(`
      ALTER TABLE audit_log
        ALTER COLUMN id_user DROP NOT NULL
    `);
    console.log('✅ audit_log.id_user est maintenant nullable.');

    // Supprimer la contrainte FK si elle existe avec ON DELETE RESTRICT
    // et la recréer avec ON DELETE SET NULL
    const fkResult = await db.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'audit_log'
        AND constraint_type = 'FOREIGN KEY'
    `);

    for (const row of fkResult.rows) {
      await db.query(`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS "${row.constraint_name}"`);
      console.log(`🗑️  Contrainte FK supprimée : ${row.constraint_name}`);
    }

    // Recréer la FK avec ON DELETE SET NULL
    await db.query(`
      ALTER TABLE audit_log
        ADD CONSTRAINT fk_audit_log_user
        FOREIGN KEY (id_user)
        REFERENCES utilisateurs(id)
        ON DELETE SET NULL
    `);
    console.log('✅ FK recréée avec ON DELETE SET NULL.');
    console.log('\n✅ Migration terminée. Les logs sont maintenant immuables.');
  } catch (err) {
    console.error('❌ Erreur migration:', err.message);
  } finally {
    process.exit(0);
  }
}

migrate();
