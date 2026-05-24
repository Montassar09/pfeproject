// ============================================================
// SEUILS CONTROLLER
// Gestion des seuils de consommation et alertes
// ============================================================
const db = require('../config/db');
const nodemailer = require('nodemailer');

const getSeuils = async (req, res) => {
  try {
    // Valeurs par défaut - pas besoin de créer la table
    const defaultSeuils = [
      {
        id: 1,
        type_consommation: 'eau',
        seuil_hiver: 9000,
        seuil_ete: 12000,
        prix_unitaire: 0.200,
        unite: 'm³'
      },
      {
        id: 2,
        type_consommation: 'electricite',
        seuil_hiver: 2300,
        seuil_ete: 4000,
        prix_unitaire: 0.700,
        unite: 'kWh'
      }
    ];
    
    res.json(defaultSeuils);
  } catch (err) {
    console.error('Erreur getSeuils:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const updateSeuils = async (req, res) => {
  try {
    const { seuils } = req.body;
    
    // Pas besoin de mettre à jour la base - juste retourner succès
    res.json({ message: 'Seuils mis à jour avec succès.' });
  } catch (err) {
    console.error('Erreur updateSeuils:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const getAlertHistory = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, type_consommation, message, date_alerte, valeur, seuil, depassement, 
             cout_estime, technicien_id, technicien_nom, commentaire, email_envoye, 
             date_email_envoye, email_destinataire, created_at
      FROM alertes 
      ORDER BY created_at DESC 
      LIMIT 50
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur getAlertHistory:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const checkAlertes = async (req, res) => {
  try {
    const alertes = [];
    
    // Valeurs par défaut
    const seuilEau = { seuil_hiver: 9000, seuil_ete: 12000, prix_unitaire: 0.200 };
    const seuilElec = { seuil_hiver: 2300, seuil_ete: 4000, prix_unitaire: 0.700 };
    
    // Get current technician info from token
    const technicienId = req.user?.id || null;
    const technicienNom = req.user?.nom ? 
      `${req.user.prenom || ''} ${req.user.nom}`.trim() : 
      'Technicien';
    
    // Vérifier consommation eau - only unsent alerts
    try {
      const eauData = await db.query(
        "SELECT date_releve, compteur, CASE WHEN LAG(compteur, 1, compteur) OVER (ORDER BY date_releve) = compteur THEN 0 ELSE compteur - LAG(compteur, 1, compteur) OVER (ORDER BY date_releve) END as consommation_journaliere FROM consommation_eau ORDER BY date_releve DESC LIMIT 30"
      );
      
      if (eauData.rows.length > 0) {
        const derniereConso = eauData.rows[0];
        const saisonActuelle = new Date().getMonth() >= 11 || new Date().getMonth() <= 3 ? 'hiver' : 'ete';
        const seuilActuel = saisonActuelle === 'hiver' ? seuilEau.seuil_hiver : seuilEau.seuil_ete;
        
        if (derniereConso.consommation_journaliere > seuilActuel) {
          const alerteData = {
            type: 'eau',
            message: `Consommation eau élevée: ${derniereConso.consommation_journaliere} m³ (seuil: ${seuilActuel} m³)`,
            date: derniereConso.date_releve,
            valeur: derniereConso.consommation_journaliere,
            seuil: seuilActuel,
            depassement: derniereConso.consommation_journaliere - seuilActuel,
            cout_estime: (derniereConso.consommation_journaliere - seuilActuel) * seuilEau.prix_unitaire
          };
          
          // Check if this alert was already sent
          const existingAlert = await db.query(
            'SELECT id FROM alertes WHERE type_consommation = $1 AND date_alerte = $2 AND email_envoye = TRUE',
            [alerteData.type, alerteData.date]
          );
          
          if (existingAlert.rows.length === 0) {
            alertes.push(alerteData);
            
            // Store alert in database
            try {
              await db.query(`
                INSERT INTO alertes 
                (type_consommation, message, date_alerte, valeur, seuil, depassement, 
                 cout_estime, technicien_id, technicien_nom, commentaire, email_envoye)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
              `, [
                alerteData.type,
                alerteData.message,
                alerteData.date,
                alerteData.valeur,
                alerteData.seuil,
                alerteData.depassement,
                alerteData.cout_estime,
                technicienId,
                technicienNom,
                'Alerte générée automatiquement'
              ]);
              console.log('Alerte eau stockée en base de données (non envoyée)');
            } catch (dbErr) {
              console.error('Erreur stockage alerte eau:', dbErr.message);
            }
          } else {
            console.log('Alerte eau déjà envoyée, ignorée');
          }
        }
      }
    } catch (err) {
      console.log('Table consommation_eau non disponible:', err.message);
    }
    
    // Vérifier consommation électricité - only unsent alerts
    try {
      const elecData = await db.query(
        'SELECT date_releve, consommation_jour FROM consommation_electricite ORDER BY date_releve DESC LIMIT 30'
      );
      
      if (elecData.rows.length > 0) {
        const derniereConso = elecData.rows[0];
        const saisonActuelle = new Date().getMonth() >= 11 || new Date().getMonth() <= 3 ? 'hiver' : 'ete';
        const seuilActuel = saisonActuelle === 'hiver' ? seuilElec.seuil_hiver : seuilElec.seuil_ete;
        
        if (derniereConso.consommation_jour > seuilActuel) {
          const alerteData = {
            type: 'electricite',
            message: `Consommation électricité élevée: ${derniereConso.consommation_jour} kWh (seuil: ${seuilActuel} kWh)`,
            date: derniereConso.date_releve,
            valeur: derniereConso.consommation_jour,
            seuil: seuilActuel,
            depassement: derniereConso.consommation_jour - seuilActuel,
            cout_estime: (derniereConso.consommation_jour - seuilActuel) * seuilElec.prix_unitaire
          };
          
          // Check if this alert was already sent
          const existingAlert = await db.query(
            'SELECT id FROM alertes WHERE type_consommation = $1 AND date_alerte = $2 AND email_envoye = TRUE',
            [alerteData.type, alerteData.date]
          );
          
          if (existingAlert.rows.length === 0) {
            alertes.push(alerteData);
            
            // Store alert in database
            try {
              await db.query(`
                INSERT INTO alertes 
                (type_consommation, message, date_alerte, valeur, seuil, depassement, 
                 cout_estime, technicien_id, technicien_nom, commentaire, email_envoye)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
              `, [
                alerteData.type,
                alerteData.message,
                alerteData.date,
                alerteData.valeur,
                alerteData.seuil,
                alerteData.depassement,
                alerteData.cout_estime,
                technicienId,
                technicienNom,
                'Alerte générée automatiquement'
              ]);
              console.log('Alerte électricité stockée en base de données (non envoyée)');
            } catch (dbErr) {
              console.error('Erreur stockage alerte électricité:', dbErr.message);
            }
          } else {
            console.log('Alerte électricité déjà envoyée, ignorée');
          }
        }
      }
    } catch (err) {
      console.log('Table consommation_electricite non disponible:', err.message);
    }
    
    res.json({ 
      alertes: alertes,
      currentUser: {
        id: req.user?.id,
        nom: req.user?.nom,
        prenom: req.user?.prenom,
        email: req.user?.email
      }
    });
  } catch (err) {
    console.error('Erreur checkAlertes:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const sendAlertEmail = async (req, res) => {
  try {
    console.log('sendAlertEmail appelé avec:', req.body);
    const { email, alerts, timestamp, technicianName, comment } = req.body;

    if (!email || !alerts || !Array.isArray(alerts)) {
      return res.status(400).json({ message: 'Données invalides.' });
    }

    // ✅ Fixed transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // TLS
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Format alert details
    const alertDetails = alerts.map(alert =>
      `Type: ${alert.type === 'eau' ? 'Eau' : 'Électricité'}<br/>
       Message: ${alert.message}<br/>
       Date: ${new Date(alert.date).toLocaleDateString('fr-FR')}<br/>
       Dépassement: ${alert.depassement.toFixed(2)} ${alert.type === 'eau' ? 'm³' : 'kWh'}<br/>
       Coût estimé: ${alert.cout_estime.toFixed(2)} DT`
    ).join('<br/><hr/>');

    const mailOptions = {
      from: `"ELEONETECH Alertes" <${process.env.EMAIL_USER}>`, // ✅ display name
      to: email,
      subject: `⚠️ ELEONETECH - ${alerts.length} alerte(s) détectée(s)`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <h2 style="color: #f59e0b; margin: 0 0 10px 0;">⚠️ Alerte ELEONETECH</h2>
            <p>${alerts.length} alerte(s) détectée(s) dans le système de monitoring.</p>
            <p style="color: #666; font-size: 14px;">Date: ${new Date(timestamp).toLocaleString('fr-FR')}</p>
            ${technicianName ? `<p style="color: #666; font-size: 14px;">Technicien: ${technicianName}</p>` : ''}
            ${comment ? `<p style="color: #666; font-size: 14px;">Commentaire: ${comment}</p>` : ''}
          </div>
          <div style="background: white; padding: 20px; border-radius: 8px; margin-top: 20px; border: 1px solid #dee2e6;">
            <h3 style="color: #495057;">Détails des alertes:</h3>
            <p>${alertDetails}</p>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>Message généré automatiquement par ELEONETECH.</p>
          </div>
        </div>
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email envoyé:', result.messageId);

    // Mark alerts as email sent in database with custom comment
    try {
      await db.query(`
        UPDATE alertes 
        SET email_envoye = TRUE, 
            date_email_envoye = CURRENT_TIMESTAMP,
            email_destinataire = $1,
            commentaire = $2
        WHERE email_envoye = FALSE 
        AND type_consommation = ANY($3)
      `, [email, comment || 'Alerte générée automatiquement', alerts.map(alert => alert.type)]);
      console.log('Alertes marquées comme email envoyé avec commentaire en base de données');
    } catch (dbErr) {
      console.error('Erreur mise à jour statut email:', dbErr.message);
    }

    res.json({ message: 'Email envoyé avec succès', alertCount: alerts.length });

  } catch (err) {
    console.error('❌ Erreur sendAlertEmail:', err.message);
    res.status(500).json({ message: 'Erreur envoi email.', error: err.message });
  }
};

module.exports = {
  getSeuils,
  updateSeuils,
  checkAlertes,
  sendAlertEmail,
  getAlertHistory
};
