// ============================================================
// MIDDLEWARE AUTHENTIFICATION
// Verifie le token JWT avant chaque route protegee
// ============================================================
const jwt = require('jsonwebtoken');
const db  = require('../config/db');

// Ensure JWT_SECRET is set
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'eleonetech_jwt_secret_key_2026';
}

// ── Verifier le token JWT ─────────────────────────────────
const verifierToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Verifier que le header Authorization existe
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token manquant. Veuillez vous connecter.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Decoder et verifier le token JWT
    console.log('Middleware JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'NOT SET');
    console.log('Token first 20 chars:', token.substring(0, 20));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Token decoded successfully:', decoded.id);

    // Verifier que l'utilisateur existe et est actif
    console.log('Checking user existence for ID:', decoded.id);
    const rows = await db.query(
      'SELECT id, nom, email, role, est_actif FROM utilisateurs WHERE id = $1',
      [decoded.id]
    );

    console.log('User query result rows:', rows.rows.length);
    if (rows.rows.length === 0 || !rows.rows[0].est_actif) {
      console.log('User not found or inactive');
      return res.status(401).json({ message: 'Utilisateur introuvable ou desactive.' });
    }

    console.log('User found and active:', rows.rows[0].email);
    // Stocker l'utilisateur dans la requete
    req.user  = rows.rows[0];
    req.token = token;
    console.log('Middleware success - calling next()');
    next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expire. Reconnectez-vous.' });
    }
    return res.status(401).json({ message: 'Token invalide.' });
  }
};

// ── Verifier le role (RBAC) ───────────────────────────────
// Usage: autoriser('Administrateur') ou autoriser('Administrateur','Responsable')
const autoriser = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Acces refuse. Role requis : ${roles.join(' ou ')}`
      });
    }
    next();
  };
};

module.exports = { verifierToken, autoriser };
