// ============================================================
// SCAN ELECTRICITE PAGE - Relevé manuel 3 phases
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { monitoringAPI } from '../../api/index';

const PHASES = [
  { key: 'phase1', code: '21.', label: 'Phase 1' },
  { key: 'phase2', code: '22.', label: 'Phase 2' },
  { key: 'phase3', code: '23.', label: 'Phase 3' },
];

const ScanElecPage = () => {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];

  const [step, setStep] = useState(0);
  const [valeurs, setValeurs] = useState(['', '', '']);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erreur, setErreur] = useState('');

  const current = PHASES[step];

  function handleValeurChange(val) {
    const newValeurs = [...valeurs];
    newValeurs[step] = val;
    setValeurs(newValeurs);
    setErreur('');
  }

  function handleNext() {
    if (!valeurs[step]) return setErreur('Veuillez entrer une valeur.');
    setErreur('');
    setStep(step + 1);
  }

  async function handleConfirm() {
    if (!valeurs[2]) return setErreur('Veuillez entrer la valeur.');
    setSaving(true);
    try {
      await monitoringAPI.addElectricityConsumption({
        date_releve: today,
        phase1: parseFloat(valeurs[0]),
        phase2: parseFloat(valeurs[1]),
        phase3: parseFloat(valeurs[2]),
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
        <p style={styles.successSub}>Compteur électricité — {today}</p>
        <div style={styles.successValues}>
          {PHASES.map((p, i) => (
            <div key={i} style={styles.successRow}>
              <span style={styles.successLabel}>{p.label}</span>
              <span style={styles.successNum}>{valeurs[i]} kWh</span>
            </div>
          ))}
        </div>
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
          <span style={{ fontSize: 32 }}>⚡</span>
          <h1 style={styles.title}>Relevé Électricité</h1>
          <p style={styles.subtitle}>{today}</p>
        </div>

        {/* Progress dots */}
        <div style={styles.progressRow}>
          {PHASES.map((p, i) => (
            <div key={i} style={styles.progressItem}>
              <div style={{
                ...styles.dot,
                background: i < step ? '#16a34a' : i === step ? '#1d4ed8' : '#e2e8f0',
                color: i <= step ? '#fff' : '#94a3b8',
              }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span style={{
                ...styles.dotLabel,
                color: i === step ? '#1d4ed8' : i < step ? '#16a34a' : '#94a3b8',
                fontWeight: i === step ? 700 : 400,
              }}>
                {p.label}
              </span>
            </div>
          ))}
        </div>

        {/* Error */}
        {erreur && (
          <div style={styles.erreurBox}>⚠️ {erreur}</div>
        )}

        {/* Instruction */}
        <div style={styles.instructionBox}>
          <p style={styles.instructionTitle}>
            Attendez le code <strong style={{ color: '#1d4ed8', fontSize: 20 }}>{current.code}</strong> sur le compteur
          </p>
          <p style={styles.instructionSub}>
            puis entrez la valeur du {current.label}
          </p>
        </div>

        {/* Input */}
        <div style={styles.section}>
          <label style={styles.label}>
            Valeur {current.label} (kWh) :
          </label>
          <input
            type="number"
            value={valeurs[step]}
            onChange={e => handleValeurChange(e.target.value)}
            placeholder="ex: 02560.147"
            style={styles.input}
            autoFocus
          />
        </div>

        {/* Next / Confirm */}
        {step < 2 ? (
          <button
            onClick={handleNext}
            disabled={!valeurs[step]}
            style={!valeurs[step] ? styles.btnDisabled : styles.btnNext}>
            Suivant → {PHASES[step + 1].label}
          </button>
        ) : (
          <button
            onClick={handleConfirm}
            disabled={saving || !valeurs[2]}
            style={saving || !valeurs[2] ? styles.btnDisabled : styles.btnConfirm}>
            {saving ? 'Enregistrement...' : '✅ Confirmer et enregistrer'}
          </button>
        )}

        {/* Summary of completed steps */}
        {step > 0 && (
          <div style={styles.summary}>
            {PHASES.slice(0, step).map((p, i) => (
              <div key={i} style={styles.summaryItem}>
                <span style={styles.summaryLabel}>✓ {p.label}</span>
                <span style={styles.summaryVal}>{valeurs[i]} kWh</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    background: '#fafafa',
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
    marginBottom: 20,
    paddingBottom: 16,
    borderBottom: '1px solid #f1f5f9',
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
  progressRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 24,
  },
  progressItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
  },
  dotLabel: {
    fontSize: 12,
  },
  instructionBox: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 12,
    padding: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  instructionTitle: {
    fontSize: 16,
    color: '#1e3a5f',
    margin: '0 0 4px',
  },
  instructionSub: {
    fontSize: 14,
    color: '#475569',
    margin: 0,
  },
  section: {
    marginBottom: 20,
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
  btnNext: {
    width: '100%',
    padding: '14px',
    background: '#1d4ed8',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
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
  summary: {
    marginTop: 20,
    padding: 16,
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 10,
  },
  summaryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid #dcfce7',
  },
  summaryLabel: {
    color: '#16a34a',
    fontWeight: 600,
    fontSize: 14,
  },
  summaryVal: {
    color: '#1e3a5f',
    fontWeight: 700,
    fontSize: 14,
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
    margin: '4px 0 20px',
  },
  successValues: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 16,
  },
  successRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 16px',
    background: '#f0fdf4',
    borderRadius: 8,
  },
  successLabel: {
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
  },
  successNum: {
    color: '#1e3a5f',
    fontSize: 16,
    fontWeight: 700,
  },
};

export default ScanElecPage;