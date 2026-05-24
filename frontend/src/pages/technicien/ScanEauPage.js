// ============================================================
// SCAN EAU PAGE - Relevé manuel compteur eau
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { monitoringAPI } from '../../api/index';

const ScanEauPage = () => {
  const navigate = useNavigate();
  const [valeur, setValeur] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erreur, setErreur] = useState('');

  const today = new Date().toISOString().split('T')[0];

  async function handleConfirm() {
    if (!valeur) return setErreur('Veuillez entrer une valeur.');
    setSaving(true);
    try {
      await monitoringAPI.addWaterConsumption({
        date_releve: today,
        compteur: parseFloat(valeur)
      });
      setSaved(true);
    } catch {
      setErreur('Erreur lors de l\'enregistrement. Réessayez.');
    }
    setSaving(false);
  }

  // ── Success screen ───────────────────────────────────────
  if (saved) return (
    <div style={styles.container}>
      <div style={styles.successBox}>
        <div style={{ fontSize: 64 }}>✅</div>
        <h2 style={styles.successTitle}>Relevé enregistré !</h2>
        <p style={styles.successSub}>Compteur eau — {today}</p>
        <p style={styles.successValue}>{valeur} m³</p>
        <button onClick={() => navigate('/technicien/dashboard')} style={styles.btnSecondary}>
          Retour au dashboard
        </button>
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.card}>

        {/* Header */}
        <div style={styles.header}>
          <span style={{ fontSize: 32 }}>💧</span>
          <h1 style={styles.title}>Relevé Compteur Eau</h1>
          <p style={styles.subtitle}>{today}</p>
        </div>

        {/* Error */}
        {erreur && (
          <div style={styles.erreurBox}>⚠️ {erreur}</div>
        )}

        {/* Input */}
        <div style={styles.section}>
          <label style={styles.label}>
            Entrez la valeur du compteur (m³) :
          </label>
          <input
            type="number"
            value={valeur}
            onChange={e => { setValeur(e.target.value); setErreur(''); }}
            placeholder="ex: 3022.00"
            style={styles.input}
            autoFocus
          />
        </div>

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={saving || !valeur}
          style={!valeur || saving ? styles.btnDisabled : styles.btnConfirm}>
          {saving ? 'Enregistrement...' : '✅ Confirmer et enregistrer'}
        </button>

      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f0f9ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
  },
  card: {
    background: '#ffffff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  },
  header: {
    textAlign: 'center',
    marginBottom: 24,
    paddingBottom: 16,
    borderBottom: '1px solid #e0f2fe',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#1e3a5f',
    margin: '8px 0 4px',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    margin: 0,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    display: 'block',
    fontSize: 15,
    color: '#475569',
    marginBottom: 12,
    fontWeight: 500,
  },
  input: {
    width: '100%',
    padding: '16px',
    fontSize: 28,
    fontWeight: 700,
    color: '#1e3a5f',
    border: '2px solid #0ea5e9',
    borderRadius: 10,
    textAlign: 'center',
    boxSizing: 'border-box',
    outline: 'none',
  },
  btnConfirm: {
    width: '100%',
    padding: '14px',
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnDisabled: {
    width: '100%',
    padding: '14px',
    background: '#94a3b8',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'not-allowed',
  },
  btnSecondary: {
    padding: '12px 24px',
    background: '#1e3a5f',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 16,
  },
  erreurBox: {
    padding: 12,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    color: '#dc2626',
    fontSize: 14,
    marginBottom: 16,
  },
  successBox: {
    background: '#fff',
    borderRadius: 16,
    padding: 40,
    textAlign: 'center',
    maxWidth: 400,
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: '#16a34a',
    margin: '16px 0 8px',
  },
  successSub: {
    color: '#64748b',
    fontSize: 14,
    margin: '4px 0',
  },
  successValue: {
    fontSize: 36,
    fontWeight: 800,
    color: '#1e3a5f',
    margin: '16px 0',
  },
};

export default ScanEauPage;