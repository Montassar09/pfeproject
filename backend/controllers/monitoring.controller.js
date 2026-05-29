// ============================================================
// MONITORING CONTROLLER
// Water, Electricity, Photovoltaic, and Interventions monitoring
// ============================================================
const db = require('../config/db');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const os = require('os');

const getLocalIp = () => {
  const interfaces = os.networkInterfaces();

  // Mots-clés des adaptateurs virtuels à ignorer (VirtualBox, VMware, etc.)
  const virtualKeywords = ['virtualbox', 'vmware', 'vethernet', 'loopback', 'pseudo', 'virtual', 'vbox'];

  // 1er passage : chercher Wi-Fi ou Ethernet réel en priorité
  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    const isVirtual = virtualKeywords.some(k => lowerName.includes(k));
    if (isVirtual) continue;

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Exclure aussi les plages VirtualBox (192.168.56.x) et VMware (192.168.VMnet)
        if (iface.address.startsWith('192.168.56.')) continue;
        return iface.address;
      }
    }
  }

  // 2e passage : fallback — n'importe quelle IPv4 non-interne hors 192.168.56.x
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('192.168.56.')) {
        return iface.address;
      }
    }
  }

  return 'localhost';
};

// ── Helper : enregistrer dans audit_log ──────────────────
const logAction = async (idUser, action, tableCible = null, ip = null) => {
  try {
    await db.query(
      'INSERT INTO audit_log (id_user, action, table_cible, ip_address) VALUES (?, ?, ?, ?)',
      [idUser, action, tableCible, ip]
    );
  } catch (err) {
    console.error('Erreur audit_log:', err.message);
  }
};

// ── Water Consumption ─────────────────────────────────────
const getWaterConsumption = async (req, res) => {
  try {
    const data = await db.query(`
      SELECT 
        id, 
        date_releve, 
        compteur,
        consommation_jour,
        cout_total,
        CASE 
          WHEN LAG(compteur, 1, compteur) OVER (ORDER BY date_releve) = compteur THEN 0
          ELSE compteur - LAG(compteur, 1, compteur) OVER (ORDER BY date_releve)
        END as consommation_journaliere
      FROM consommation_eau 
      ORDER BY date_releve DESC
    `);
    console.log('Water consumption data loaded:', data.rows.length, 'records');
    res.json(data.rows);
  } catch (err) {
    console.error('Erreur getWaterConsumption:', err);
    
    // Check if table doesn't exist
    if (err.message.includes('does not exist') || err.message.includes('relation') || err.code === '42P01') {
      console.log('consommation_eau table does not exist');
      return res.json([]);
    }
    
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
};

const getWaterConsumptionStats = async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_readings,
        MIN(date_releve) as first_reading,
        MAX(date_releve) as last_reading,
        COALESCE(MAX(compteur) - MIN(compteur), 0) as total_consumption
      FROM consommation_eau
    `);
    const result = stats.rows[0];
    // Convert string values to numbers
    res.json({
      total_readings: parseInt(result.total_readings),
      first_reading: result.first_reading,
      last_reading: result.last_reading,
      total_consumption: parseFloat(result.total_consumption)
    });
  } catch (err) {
    console.error('Erreur getWaterConsumptionStats:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── Electricity Consumption ───────────────────────────────
const getElectricityConsumption = async (req, res) => {
  try {
    const data = await db.query(`
      SELECT id, date_releve, phase1, phase2, phase3,
      consommation_jour, cout_total
      FROM consommation_electricite 
      ORDER BY date_releve DESC
    `);
    console.log('Electricity consumption data loaded:', data.rows.length, 'records');
    res.json(data.rows);
  } catch (err) {
    console.error('Erreur getElectricityConsumption:', err);
    
    // Check if table doesn't exist
    if (err.message.includes('does not exist') || err.message.includes('relation') || err.code === '42P01') {
      console.log('consommation_electricite table does not exist');
      return res.json([]);
    }
    
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
};

const getElectricityConsumptionStats = async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        COUNT(*) as total_readings,
        MIN(date_releve) as first_reading,
        MAX(date_releve) as last_reading,
        AVG(consommation_jour) FILTER (WHERE consommation_jour IS NOT NULL AND consommation_jour > 0) as avg_consumption
      FROM consommation_electricite
    `);

    const result = stats.rows[0];
    res.json({
      total_readings: parseInt(result.total_readings),
      first_reading: result.first_reading,
      last_reading: result.last_reading,
      avg_consumption: parseFloat(result.avg_consumption) || 0
    });
  } catch (err) {
    console.error('Erreur getElectricityConsumptionStats:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── Photovoltaic Production ───────────────────────────────
const getPhotovoltaicProduction = async (req, res) => {
  try {
    // Check multiple possible table names based on your database structure
    const possibleTables = ['production_photovoltaique', 'production_photovoltaic', 'photovoltaic_production'];
    let data = null;
    let usedTable = null;
    
    for (const tableName of possibleTables) {
      try {
        const tableCheck = await db.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = '${tableName}'
          );
        `);
        
        if (tableCheck.rows[0].exists) {
          console.log(`Found table: ${tableName}`);
          usedTable = tableName;
          
          // Get all fields to see what's available
          const columnInfo = await db.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = '${tableName}' AND table_schema = 'public'
          `);
          
          console.log(`Available columns in ${tableName}:`, columnInfo.rows.map(r => r.column_name));
          
          // Fetch all records ordered by date descending
          data = await db.query(`
            SELECT 
              id,
              date,
              mois,
              puissance_installee_kwp,
              production_journaliere_kwh,
              production_cumulee_kwh,
              heures_equivalentes_h
            FROM ${tableName} 
            ORDER BY date DESC
          `);
          
          if (data.rows.length > 0) {
            console.log(`Found ${data.rows.length} records in ${tableName}`);
            break;
          }
        }
      } catch (err) {
        console.log(`Error checking table ${tableName}:`, err.message);
        continue;
      }
    }
    
    if (!data || data.rows.length === 0) {
      console.log('No photovoltaic data found in any table');
      return res.json([]);
    }
    
    // Map the data with clean, consistent field names
    const mappedData = data.rows.map(row => ({
      id: row.id,
      date: row.date,
      mois: row.mois,
      puissance_installee_kwp: row.puissance_installee_kwp !== null ? parseFloat(row.puissance_installee_kwp) : null,
      production_journaliere_kwh: row.production_journaliere_kwh !== null ? parseFloat(row.production_journaliere_kwh) : null,
      production_cumulee_kwh: row.production_cumulee_kwh !== null ? parseFloat(row.production_cumulee_kwh) : null,
      heures_equivalentes_h: row.heures_equivalentes_h !== null ? parseFloat(row.heures_equivalentes_h) : null,
    }));
    
    console.log(`Returning ${mappedData.length} photovoltaic records from table: ${usedTable}`);
    res.json(mappedData);
  } catch (err) {
    console.error('Erreur getPhotovoltaicProduction:', err);
    console.log('Returning empty data due to database error');
    return res.json([]);
  }
};

const getPhotovoltaicProductionStats = async (req, res) => {
  try {
    // Check multiple possible table names based on your database structure
    const possibleTables = ['production_photovoltaique', 'production_photovoltaic', 'photovoltaic_production'];
    let stats = null;
    let usedTable = null;
    
    for (const tableName of possibleTables) {
      try {
        const tableCheck = await db.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = '${tableName}'
          );
        `);
        
        if (tableCheck.rows[0].exists) {
          console.log(`Found stats table: ${tableName}`);
          usedTable = tableName;
          
          // Try to get stats from this table
          stats = await db.query(`
            SELECT 
              COUNT(*) as total_records,
              COUNT(*) as records_with_data,
              0 as records_without_data,
              AVG(puissance_installee_kwp) as installed_power,
              SUM(production_journaliere_kwh) as total_production,
              AVG(production_journaliere_kwh) as avg_production,
              MAX(production_journaliere_kwh) as max_production,
              MIN(production_journaliere_kwh) as min_production
            FROM ${tableName}
          `);
          
          if (stats.rows[0].total_records > 0) {
            console.log(`Found stats for ${stats.rows[0].total_records} records in ${tableName}`);
            break;
          }
        }
      } catch (err) {
        console.log(`Error checking stats table ${tableName}:`, err.message);
        continue;
      }
    }
    
    if (!stats || stats.rows[0].total_records === 0) {
      console.log('No photovoltaic stats found in any table');
      return res.json({
        total_records: 0,
        records_with_data: 0,
        records_without_data: 0,
        installed_power: '0.0',
        total_production: '0.0',
        avg_production: '0.0',
        max_production: '0.0',
        min_production: '0.0',
        efficiency: '0.00'
      });
    }
    
    const result = stats.rows[0];
    
    // Calculate efficiency only if we have valid data
    const totalProduction = parseFloat(result.total_production) || 0;
    const installedPower = parseFloat(result.installed_power) || 0;
    const efficiency = (installedPower > 0 && totalProduction > 0) 
      ? (totalProduction / (installedPower * 365 * 5)) * 100 
      : 0;
    
    console.log(`Calculated photovoltaic stats from table: ${usedTable}`, {
      totalRecords: result.total_records,
      totalProduction: totalProduction.toFixed(1),
      efficiency: efficiency.toFixed(2)
    });
    
    res.json({
      total_records: parseInt(result.total_records) || 0,
      records_with_data: parseInt(result.records_with_data) || 0,
      records_without_data: parseInt(result.records_without_data) || 0,
      installed_power: installedPower.toFixed(1),
      total_production: totalProduction.toFixed(1),
      avg_production: parseFloat(result.avg_production).toFixed(1) || '0.0',
      max_production: parseFloat(result.max_production).toFixed(1) || '0.0',
      min_production: parseFloat(result.min_production).toFixed(1) || '0.0',
      efficiency: efficiency.toFixed(2)
    });
  } catch (err) {
    console.error('Erreur getPhotovoltaicProductionStats:', err);
    console.log('Returning default stats due to database error');
    return res.json({
      total_records: 0,
      records_with_data: 0,
      records_without_data: 0,
      installed_power: '0.0',
      total_production: '0.0',
      avg_production: '0.0',
      max_production: '0.0',
      min_production: '0.0',
      efficiency: '0.00'
    });
  }
};

// ── Interventions ─────────────────────────────────────────
const getInterventions = async (req, res) => {
  try {
    const data = await db.query(`
      SELECT id, date_intervention, type_intervention, description, 
      technicien, statut, cout
      FROM interventions 
      ORDER BY date_intervention DESC
    `);
    console.log('Interventions data loaded:', data.rows.length, 'records');
    res.json(data.rows);
  } catch (err) {
    console.error('Erreur getInterventions:', err);
    
    // Check if table doesn't exist
    if (err.message.includes('does not exist') || err.message.includes('relation') || err.code === '42P01') {
      console.log('interventions table does not exist');
      return res.json([]);
    }
    
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
};

const getInterventionsStats = async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_interventions,
        COUNT(DISTINCT type_intervention) as unique_pannes,
        COALESCE(SUM(cout), 0) as total_quantity
      FROM interventions
    `);
    const result = stats.rows[0];
    res.json({
      total_interventions: parseInt(result.total_interventions),
      unique_pannes: parseInt(result.unique_pannes),
      total_quantity: parseFloat(result.total_quantity)
    });
  } catch (err) {
    console.error('Erreur getInterventionsStats:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── CRUD Operations for Water Consumption ─────────────────────
const addWaterConsumption = async (req, res) => {
  try {
    const { date_releve, compteur } = req.body;
    
    if (!date_releve || !compteur) {
      return res.status(400).json({ message: 'Date et compteur sont requis.' });
    }
    
    const result = await db.query(
      'INSERT INTO consommation_eau (date_releve, compteur) VALUES ($1, $2) RETURNING *',
      [date_releve, parseFloat(compteur)]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur addWaterConsumption:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const updateWaterConsumption = async (req, res) => {
  try {
    const { id } = req.params;
    const { date_releve, compteur } = req.body;
    
    const result = await db.query(
      'UPDATE consommation_eau SET date_releve = $1, compteur = $2 WHERE id = $3 RETURNING *',
      [date_releve, parseFloat(compteur), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enregistrement non trouvé.' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur updateWaterConsumption:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const deleteWaterConsumption = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query('DELETE FROM consommation_eau WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enregistrement non trouvé.' });
    }
    
    res.json({ message: 'Enregistrement supprimé avec succès.' });
  } catch (err) {
    console.error('Erreur deleteWaterConsumption:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── CRUD Operations for Electricity Consumption ───────────────────
const addElectricityConsumption = async (req, res) => {
  try {
    const { date_releve, phase1, phase2, phase3 } = req.body;
    
    if (!date_releve || phase1 === undefined || phase2 === undefined || phase3 === undefined) {
      return res.status(400).json({ message: 'Date et toutes les phases sont requises.' });
    }
    
    const result = await db.query(
      'INSERT INTO consommation_electricite (date_releve, phase1, phase2, phase3) VALUES ($1, $2, $3, $4) RETURNING *',
      [date_releve, parseFloat(phase1), parseFloat(phase2), parseFloat(phase3)]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur addElectricityConsumption:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const updateElectricityConsumption = async (req, res) => {
  try {
    const { id } = req.params;
    const { date_releve, phase1, phase2, phase3 } = req.body;
    
    const result = await db.query(
      'UPDATE consommation_electricite SET date_releve = $1, phase1 = $2, phase2 = $3, phase3 = $4 WHERE id = $5 RETURNING *',
      [date_releve, parseFloat(phase1), parseFloat(phase2), parseFloat(phase3), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enregistrement non trouvé.' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur updateElectricityConsumption:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const deleteElectricityConsumption = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query('DELETE FROM consommation_electricite WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enregistrement non trouvé.' });
    }
    
    res.json({ message: 'Enregistrement supprimé avec succès.' });
  } catch (err) {
    console.error('Erreur deleteElectricityConsumption:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── CRUD Operations for Photovoltaic Production ────────────────────
const addPhotovoltaicProduction = async (req, res) => {
  try {
    const { date, production_journaliere_kwh, puissance_installee_kwp } = req.body;
    
    if (!date || production_journaliere_kwh === undefined || puissance_installee_kwp === undefined) {
      return res.status(400).json({ message: 'Date, production et puissance installée sont requises.' });
    }
    
    // Extract month from date
    const dateObj = new Date(date);
    const mois = (dateObj.getMonth() + 1).toString();
    
    const result = await db.query(
      'INSERT INTO production_photovoltaique (date, mois, production_journaliere_kwh, puissance_installee_kwp) VALUES ($1, $2, $3, $4) RETURNING *',
      [date, mois, parseFloat(production_journaliere_kwh), parseFloat(puissance_installee_kwp)]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur addPhotovoltaicProduction:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const updatePhotovoltaicProduction = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, production_journaliere_kwh, puissance_installee_kwp } = req.body;
    
    const result = await db.query(
      'UPDATE production_photovoltaique SET date = $1, production_journaliere_kwh = $2, puissance_installee_kwp = $3 WHERE id = $4 RETURNING *',
      [date, parseFloat(production_journaliere_kwh), parseFloat(puissance_installee_kwp), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enregistrement non trouvé.' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur updatePhotovoltaicProduction:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const deletePhotovoltaicProduction = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query('DELETE FROM production_photovoltaique WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enregistrement non trouvé.' });
    }
    
    res.json({ message: 'Enregistrement supprimé avec succès.' });
  } catch (err) {
    console.error('Erreur deletePhotovoltaicProduction:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── CRUD Operations for Interventions ─────────────────────────────
const addIntervention = async (req, res) => {
  try {
    const { date_intervention, type_intervention, description, technicien, statut, cout } = req.body;
    
    if (!date_intervention || !type_intervention || !technicien || !statut) {
      return res.status(400).json({ message: 'Date, type, technicien et statut sont requis.' });
    }
    
    const result = await db.query(
      'INSERT INTO interventions (date_intervention, type_intervention, description, technicien, statut, cout) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [date_intervention, type_intervention, description, technicien, statut, parseFloat(cout || 0)]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur addIntervention:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const updateIntervention = async (req, res) => {
  try {
    const { id } = req.params;
    const { date_intervention, type_intervention, description, technicien, statut, cout } = req.body;
    
    const result = await db.query(
      'UPDATE interventions SET date_intervention = $1, type_intervention = $2, description = $3, technicien = $4, statut = $5, cout = $6 WHERE id = $7 RETURNING *',
      [date_intervention, type_intervention, description, technicien, statut, parseFloat(cout || 0), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enregistrement non trouvé.' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur updateIntervention:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const deleteIntervention = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query('DELETE FROM interventions WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enregistrement non trouvé.' });
    }
    
    res.json({ message: 'Enregistrement supprimé avec succès.' });
  } catch (err) {
    console.error('Erreur deleteIntervention:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── Verification credentials technicien (public, sans JWT) ────────
const verifierTechnicienPublic = async (req, res) => {
  const { email, mot_de_passe } = req.body;
  if (!email || !mot_de_passe) {
    return res.status(400).json({ message: 'Email et mot de passe requis.' });
  }
  try {
    const result = await db.query(
      `SELECT id, prenom, nom, role, mot_de_passe, est_actif
       FROM utilisateurs WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }
    const user = result.rows[0];
    if (!user.est_actif) {
      return res.status(401).json({ message: 'Compte desactive. Contactez l\'administrateur.' });
    }
    if (!['Technicien', 'Responsable'].includes(user.role)) {
      return res.status(403).json({ message: 'Acces reserve aux techniciens et responsables.' });
    }
    const valide = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!valide) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }
    res.json({ prenom: user.prenom, nom: user.nom, role: user.role });
  } catch (err) {
    console.error('Erreur verifierTechnicienPublic:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── Interventions planifiées pour un équipement (scan QR) ─────────
// SQL MIGRATION requise (une seule fois) :
// ALTER TABLE interventions_staging ADD COLUMN IF NOT EXISTS intervention_id INTEGER REFERENCES interventions(id) ON DELETE SET NULL;
const getInterventionsPlanifieesParEquipement = async (req, res) => {
  const { equipementId } = req.params;
  try {
    const equip = await db.query('SELECT id, nom FROM equipements WHERE id = $1', [equipementId]);
    if (equip.rows.length === 0) return res.json({ equipement: null, interventions: [] });
    const { id: equipId, nom } = equip.rows[0];
    const rows = await db.query(
      `SELECT * FROM interventions
       WHERE statut IN ('Planifiee', 'En cours')
         AND type_intervention = 'Preventive'
         AND description LIKE $1
       ORDER BY date_intervention ASC`,
      [`%Equipement: ${nom}%`]
    );
    res.json({ equipement: { id: equipId, nom }, interventions: rows.rows });
  } catch (err) {
    console.error('Erreur getInterventionsPlanifieesParEquipement:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── CRUD Operations for Interventions Staging ─────────────────────
const addInterventionStaging = async (req, res) => {
  try {
    const { date_intervention, heure, action, type_intervention, description, technicien, equipement, intervention_id, sous_equipement } = req.body;

    if (!date_intervention || !type_intervention || !technicien) {
      return res.status(400).json({ message: 'Date, type et technicien sont requis.' });
    }

    const result = await db.query(
      `INSERT INTO interventions_staging
         (date_intervention, heure, action, type_intervention, description, technicien, equipement, intervention_id, sous_equipement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [date_intervention, heure || null, action || 'Ouverture', type_intervention, description || '', technicien, equipement || null, intervention_id || null, sous_equipement || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur addInterventionStaging:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const getInterventionsStaging = async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT * FROM interventions_staging ORDER BY created_at DESC`
    );
    res.json(rows.rows);
  } catch (err) {
    console.error('Erreur getInterventionsStaging:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const validerInterventionStaging = async (req, res) => {
  const { id } = req.params;
  try {
    const staging = await db.query('SELECT * FROM interventions_staging WHERE id = $1', [id]);
    if (staging.rows.length === 0) {
      return res.status(404).json({ message: 'Intervention introuvable.' });
    }

    const s = staging.rows[0];

    // Déterminer le statut final : clôturée si date_cloture renseignée
    const estClotureee = !!s.date_cloture;

    if (s.intervention_id) {
      // Workflow planifié : mettre à jour le statut de l'intervention parente
      const nouveauStatut = estClotureee ? 'Terminee' : 'En cours';
      await db.query('UPDATE interventions SET statut = $1 WHERE id = $2', [nouveauStatut, s.intervention_id]);
    } else {
      // Curatif / libre : créer une entrée dans interventions
      const descParts = [
        s.heure            ? `Heure: ${s.heure}`                       : null,
        s.equipement       ? `Equipement: ${s.equipement}`             : null,
        s.sous_equipement  ? `Sous-equipement: ${s.sous_equipement}`   : null,
        `Technicien: ${s.technicien}`,
        s.description ? `Observations: ${s.description}` : null,
        estClotureee && s.heure_cloture ? `Cloture: ${s.heure_cloture}` : null,
        s.description_cloture ? `Travaux: ${s.description_cloture}` : null,
      ].filter(Boolean);

      await db.query(
        `INSERT INTO interventions (date_intervention, type_intervention, description, technicien, statut, cout)
         VALUES ($1, $2, $3, $4, $5, 0)`,
        [s.date_intervention, s.type_intervention, descParts.join(' | '), s.technicien,
         estClotureee ? 'Terminee' : 'En cours']
      );
    }

    await db.query('UPDATE interventions_staging SET statut = $1 WHERE id = $2', ['Validee', id]);
    res.json({ message: 'Intervention validee.' });
  } catch (err) {
    console.error('Erreur validerInterventionStaging:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const rejeterInterventionStaging = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'UPDATE interventions_staging SET statut = $1 WHERE id = $2 RETURNING *',
      ['Rejetee', id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Intervention introuvable.' });
    }
    res.json({ message: 'Intervention rejetee.' });
  } catch (err) {
    console.error('Erreur rejeterInterventionStaging:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── GET open staging records for a technician (public — used from scan QR page) ──
const getMesOuvertesStaging = async (req, res) => {
  const { technicien, equipement } = req.query;
  if (!technicien) return res.status(400).json({ message: 'Technicien requis.' });
  try {
    let query = `SELECT * FROM interventions_staging
                 WHERE action = 'Ouverture'
                   AND date_cloture IS NULL
                   AND statut = 'En attente'
                   AND LOWER(technicien) = LOWER($1)`;
    const params = [technicien];
    if (equipement) {
      query += ` AND LOWER(equipement) = LOWER($2)`;
      params.push(equipement);
    }
    query += ` ORDER BY created_at DESC`;
    const rows = await db.query(query, params);
    res.json(rows.rows);
  } catch (err) {
    console.error('Erreur getMesOuvertesStaging:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── PUT close an open staging record (public — used from scan QR page) ──
const cloturerInterventionStaging = async (req, res) => {
  const { id } = req.params;
  const { date_cloture, heure_cloture, description_cloture } = req.body;
  if (!date_cloture || !heure_cloture) {
    return res.status(400).json({ message: 'Date et heure de clôture sont requises.' });
  }
  try {
    const result = await db.query(
      `UPDATE interventions_staging
       SET date_cloture = $1, heure_cloture = $2, description_cloture = $3
       WHERE id = $4 AND action = 'Ouverture' AND date_cloture IS NULL
       RETURNING *`,
      [date_cloture, heure_cloture, description_cloture || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Intervention ouverte introuvable (déjà clôturée ?).' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur cloturerInterventionStaging:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const getPersonnelPublic = async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, prenom, nom, role
       FROM utilisateurs
       WHERE role IN ('Technicien', 'Responsable') AND est_actif = true
       ORDER BY role DESC, prenom, nom`
    );
    res.json(rows.rows);
  } catch (err) {
    console.error('Erreur getPersonnelPublic:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const supprimerInterventionStaging = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM interventions_staging WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Introuvable.' });
    res.json({ message: 'Supprimé.' });
  } catch (err) {
    console.error('Erreur supprimerInterventionStaging:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const getInterventionFormQr = async (req, res) => {
  const { baseUrl } = req.query;
  try {
    let appUrl = baseUrl || process.env.APP_URL || req.get('origin') || 'http://localhost:3000';
    
    // Remplacer localhost ou 127.0.0.1 par l'adresse IP locale du serveur
    if (appUrl.includes('localhost') || appUrl.includes('127.0.0.1')) {
      const localIp = getLocalIp();
      appUrl = appUrl.replace('localhost', localIp).replace('127.0.0.1', localIp);
    }
    
    const url = `${appUrl.replace(/\/$/, '')}/intervention/nouveau`;
    const qrCode = await QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.json({ url, qrCode });
  } catch (err) {
    console.error('Erreur getInterventionFormQr:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = {
  // Water
  getWaterConsumption,
  getWaterConsumptionStats,
  addWaterConsumption,
  updateWaterConsumption,
  deleteWaterConsumption,
  
  // Electricity
  getElectricityConsumption,
  getElectricityConsumptionStats,
  addElectricityConsumption,
  updateElectricityConsumption,
  deleteElectricityConsumption,
  
  // Photovoltaic
  getPhotovoltaicProduction,
  getPhotovoltaicProductionStats,
  addPhotovoltaicProduction,
  updatePhotovoltaicProduction,
  deletePhotovoltaicProduction,
  
  // Interventions
  getInterventions,
  getInterventionsStats,
  addIntervention,
  updateIntervention,
  deleteIntervention,
  getInterventionFormQr,
  // Staging
  verifierTechnicienPublic,
  addInterventionStaging,
  getInterventionsStaging,
  validerInterventionStaging,
  rejeterInterventionStaging,
  supprimerInterventionStaging,
  getMesOuvertesStaging,
  cloturerInterventionStaging,
  getPersonnelPublic,
  getInterventionsPlanifieesParEquipement,
};
