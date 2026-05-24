// ============================================================
// SCAN INTERVENTION PAGE
// Flux : login → sélection → form (ouverture) ou clôture
// ============================================================
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { equipementsAPI, monitoringAPI } from '../../api';
import { useAuth } from '../../context/AuthContext';

const today   = new Date().toISOString().split('T')[0];
const heureNow = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const parseDescription = (desc = '') => {
  const parts = {};
  desc.split(' | ').forEach(p => {
    const m = p.match(/^(.*?):\s*(.*)$/);
    if (m) parts[m[1].trim()] = m[2].trim();
  });
  return parts;
};

const formatDate = (v) => v ? new Date(v).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
const formatDateShort = (v) => v ? new Date(v).toLocaleDateString('fr-FR') : '';

const ScanInterventionPage = () => {
  const { equipementId } = useParams();
  const { user, login }  = useAuth();

  // ── Étape 1 : login ───────────────────────────────────────
  const [loginForm, setLoginForm]       = useState({ email: '', password: '' });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginErreur, setLoginErreur]   = useState('');

  // ── Étape 2 : données ─────────────────────────────────────
  const [equipement, setEquipement]   = useState(null);
  const [planifiees, setPlanifiees]   = useState([]);
  const [ouvertes, setOuvertes]       = useState([]);   // staging records ouverts (non clôturés)

  // ── Étape 3 : form ouverture ──────────────────────────────
  const [selectedIntervention, setSelected] = useState(null);
  const [modeLibre, setModeLibre]           = useState(false);
  const [action, setAction]                 = useState('Ouverture');
  const [typeIntervention, setType]         = useState('Curative');
  const [description, setDescription]      = useState('');

  // ── Étape 4 : form clôture d'un staging ouvert ───────────
  const [selectedOuvert, setSelectedOuvert] = useState(null);
  const [descCloture, setDescCloture]       = useState('');

  const [saving, setSaving]   = useState(false);
  const [erreur, setErreur]   = useState('');
  const [etape, setEtape]     = useState('login'); // login | selection | form | cloture | succes

  const isLoggedIn   = !!user;
  const technicienNom = `${user?.prenom || ''} ${user?.nom || ''}`.trim();

  // Charger après login
  useEffect(() => {
    if (!isLoggedIn) return;
    const charger = async () => {
      try {
        const [equipRes, planRes, ouvertesRes] = await Promise.all([
          equipementsAPI.getById(equipementId),
          monitoringAPI.getInterventionsPlanifieesParEquipement(equipementId),
          monitoringAPI.getMesOuvertesStaging(technicienNom, null),
        ]);
        setEquipement(equipRes.data);
        setPlanifiees(planRes.data || []);
        // Filtrer les ouvertes pour cet équipement (par nom)
        const equipNom = equipRes.data?.nom || '';
        setOuvertes((ouvertesRes.data || []).filter(o =>
          !o.equipement || o.equipement.toLowerCase() === equipNom.toLowerCase()
        ));
        setEtape('selection');
      } catch {
        setErreur('Impossible de charger les données.');
        setEtape('selection');
      }
    };
    charger();
  }, [isLoggedIn, equipementId]);

  // ── Login ─────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginForm.email.trim() || !loginForm.password)
      return setLoginErreur('Veuillez remplir tous les champs.');
    setLoginLoading(true);
    setLoginErreur('');
    try {
      await login(loginForm.email.trim(), loginForm.password);
    } catch (err) {
      setLoginErreur(err.response?.data?.message || 'Identifiants incorrects.');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Sélection intervention planifiée → form ouverture ─────
  const choisirIntervention = (interv) => {
    setSelected(interv);
    setAction(interv.statut === 'En cours' ? 'Cloture' : 'Ouverture');
    setType(interv.type_intervention || 'Preventive');
    setDescription('');
    setEtape('form');
  };

  const choisirLibre = () => {
    setSelected(null);
    setModeLibre(true);
    setAction('Ouverture');
    setType('Curative');
    setDescription('');
    setEtape('form');
  };

  // ── Sélection d'une intervention ouverte → form clôture ───
  const choisirCloture = (staging) => {
    setSelectedOuvert(staging);
    setDescCloture('');
    setEtape('cloture');
  };

  // ── Soumission ouverture ──────────────────────────────────
  const handleSubmitOuverture = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErreur('');
    try {
      await monitoringAPI.addInterventionStaging({
        date_intervention: today,
        heure:             heureNow(),
        action,
        type_intervention: typeIntervention,
        description:       description.trim(),
        technicien:        technicienNom,
        equipement:        equipement?.nom || null,
        intervention_id:   selectedIntervention?.id || null,
      });
      setEtape('succes');
    } catch {
      setErreur("Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  // ── Soumission clôture ────────────────────────────────────
  const handleSubmitCloture = async (e) => {
    e.preventDefault();
    if (!descCloture.trim()) return setErreur('La description des travaux est obligatoire.');
    setSaving(true);
    setErreur('');
    try {
      await monitoringAPI.cloturerInterventionStaging(selectedOuvert.id, {
        date_cloture:        today,
        heure_cloture:       heureNow(),
        description_cloture: descCloture.trim(),
      });
      setEtape('succes');
    } catch (err) {
      setErreur(err.response?.data?.message || "Erreur lors de la clôture.");
    } finally {
      setSaving(false);
    }
  };

  const recommencer = () => {
    setEtape('login');
    setSelected(null);
    setSelectedOuvert(null);
    setModeLibre(false);
    setDescription('');
    setDescCloture('');
    setErreur('');
  };

  // ── LOGIN ─────────────────────────────────────────────────
  if (!isLoggedIn || etape === 'login') {
    return (
      <div style={s.page}>
        <form onSubmit={handleLogin} style={s.card}>
          <div style={s.logoWrap}><div style={s.logoBadge}>E</div></div>
          <p style={s.kicker}>ELEONETECH</p>
          <h1 style={s.title}>Fiche Intervention</h1>
          <p style={s.muted}>Connectez-vous pour continuer</p>
          {loginErreur && <div style={s.errorBox}>{loginErreur}</div>}
          <label style={s.label}>Adresse e-mail</label>
          <input type="email" value={loginForm.email}
            onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
            style={s.input} placeholder="votre@email.com" required />
          <label style={s.label}>Mot de passe</label>
          <input type="password" value={loginForm.password}
            onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
            style={s.input} placeholder="••••••••" required />
          <button type="submit" disabled={loginLoading} style={loginLoading ? s.btnDisabled : s.btn}>
            {loginLoading ? 'Vérification...' : '🔐 Se connecter'}
          </button>
        </form>
      </div>
    );
  }

  // ── SÉLECTION ─────────────────────────────────────────────
  if (etape === 'selection') {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <p style={s.kicker}>ELEONETECH</p>
          <h1 style={s.title}>Intervention</h1>
          {equipement && (
            <div style={s.equipBadge}>
              <span style={s.equipId}>#{equipement.id}</span>
              <span style={s.equipNom}>{equipement.nom}</span>
            </div>
          )}
          {erreur && <div style={s.errorBox}>{erreur}</div>}

          {/* Interventions en cours (ouvertes, non clôturées) */}
          {ouvertes.length > 0 && (
            <>
              <p style={s.sectionTitle}>🔴 Interventions en cours (à clôturer)</p>
              {ouvertes.map(o => (
                <button key={o.id} type="button" onClick={() => choisirCloture(o)} style={s.planCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <span style={s.badgeEnCours}>⚡ En cours</span>
                      <div style={s.planDate}>Ouverte le {formatDateShort(o.date_intervention)} à {o.heure || '—'}</div>
                      <div style={s.planTaches}>{o.type_intervention} — {o.description || 'sans description'}</div>
                    </div>
                    <span style={{ ...s.planAction, color: '#b45309' }}>🔒 Clôturer →</span>
                  </div>
                </button>
              ))}
              <div style={s.divider}><span>ou</span></div>
            </>
          )}

          {/* Interventions planifiées */}
          {planifiees.length > 0 && (
            <>
              <p style={s.sectionTitle}>📅 Interventions planifiées</p>
              {planifiees.map(interv => {
                const det = parseDescription(interv.description);
                const isEnCours = interv.statut === 'En cours';
                return (
                  <button key={interv.id} type="button" onClick={() => choisirIntervention(interv)} style={s.planCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span style={isEnCours ? s.badgeEnCours : s.badgePlanifie}>
                          {isEnCours ? '⚡ En cours' : '📅 Planifiée'}
                        </span>
                        <div style={s.planDate}>{formatDate(interv.date_intervention)}</div>
                        {det.Taches && <div style={s.planTaches}>{det.Taches}</div>}
                      </div>
                      <span style={s.planAction}>
                        {isEnCours ? '🔒 Clôturer →' : '🔓 Ouvrir →'}
                      </span>
                    </div>
                  </button>
                );
              })}
              <div style={s.divider}><span>ou</span></div>
            </>
          )}

          <button type="button" onClick={choisirLibre} style={s.btnSecondary}>
            + Nouvelle intervention (curative / autre)
          </button>
        </div>
      </div>
    );
  }

  // ── FORMULAIRE CLÔTURE d'un staging ouvert ────────────────
  if (etape === 'cloture') {
    return (
      <div style={s.page}>
        <form onSubmit={handleSubmitCloture} style={s.card}>
          <div style={s.headerRow}>
            <div>
              <p style={s.kicker}>ELEONETECH</p>
              <h1 style={s.title}>Clôture</h1>
              <p style={s.muted}>{today}</p>
            </div>
            <button type="button" onClick={() => setEtape('selection')} style={s.backBtn}>← Retour</button>
          </div>

          {equipement && (
            <div style={s.equipBadge}>
              <span style={s.equipId}>#{equipement.id}</span>
              <span style={s.equipNom}>{equipement.nom}</span>
            </div>
          )}

          {/* Résumé de l'ouverture */}
          <div style={s.ouvertureBox}>
            <p style={s.ouvertureLabel}>🔓 Ouverture</p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span style={s.ouvertureItem}>📅 {formatDateShort(selectedOuvert?.date_intervention)}</span>
              <span style={s.ouvertureItem}>🕐 {selectedOuvert?.heure || '—'}</span>
              <span style={s.ouvertureItem}>🔧 {selectedOuvert?.type_intervention}</span>
            </div>
            {selectedOuvert?.description && (
              <p style={s.ouvertureDesc}>{selectedOuvert.description}</p>
            )}
          </div>

          {erreur && <div style={s.errorBox}>{erreur}</div>}

          <div style={{ ...s.actionBadgeCloture, marginBottom: 8 }}>
            🔒 Clôture — maintenant {heureNow()}
          </div>

          <label style={s.label}>Travaux effectués / Observations <span style={s.required}>*</span></label>
          <textarea
            value={descCloture}
            onChange={e => setDescCloture(e.target.value)}
            rows={5}
            style={{ ...s.input, resize: 'vertical', minHeight: 110, fontFamily: 'inherit' }}
            placeholder="Décrivez les travaux effectués, pièces remplacées, état final de l'équipement..."
            required
          />

          <button type="submit" disabled={saving}
            style={saving ? s.btnDisabled : { ...s.btn, background: '#1d4ed8' }}>
            {saving ? 'Enregistrement...' : '🔒 Confirmer la clôture'}
          </button>
        </form>
      </div>
    );
  }

  // ── SUCCÈS ────────────────────────────────────────────────
  if (etape === 'succes') {
    const isCloture = etape === 'succes' && selectedOuvert;
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: 'center' }}>
          <div style={s.successIcon}>✓</div>
          <h1 style={s.title}>Enregistrée</h1>
          <p style={s.muted}>
            Votre fiche a été soumise.<br />
            Elle sera validée par le responsable.
          </p>
          <div style={s.summaryBox}>
            <p style={s.summaryLine}><strong>Équipement :</strong> {equipement?.nom}</p>
            <p style={s.summaryLine}><strong>Action :</strong> {selectedOuvert ? 'Clôture' : action}</p>
            <p style={s.summaryLine}><strong>Par :</strong> {user?.prenom} {user?.nom}</p>
          </div>
          <button onClick={recommencer} style={{ ...s.btn, marginTop: 20 }}>
            Nouvelle fiche
          </button>
        </div>
      </div>
    );
  }

  // ── FORMULAIRE OUVERTURE (form) ───────────────────────────
  return (
    <div style={s.page}>
      <form onSubmit={handleSubmitOuverture} style={s.card}>
        <div style={s.headerRow}>
          <div>
            <p style={s.kicker}>ELEONETECH</p>
            <h1 style={s.title}>Fiche Intervention</h1>
            <p style={s.muted}>{today}</p>
          </div>
          <button type="button" onClick={() => setEtape('selection')} style={s.backBtn}>← Retour</button>
        </div>

        {equipement && (
          <div style={s.equipBadge}>
            <span style={s.equipId}>#{equipement.id}</span>
            <span style={s.equipNom}>{equipement.nom}</span>
          </div>
        )}

        {selectedIntervention && (
          <div style={s.linkedBadge}>
            <span style={s.linkedLabel}>Intervention planifiée liée</span>
            <span style={s.linkedDate}>
              {new Date(selectedIntervention.date_intervention).toLocaleDateString('fr-FR')}
            </span>
          </div>
        )}

        {erreur && <div style={s.errorBox}>{erreur}</div>}

        {/* Action */}
        <label style={s.label}>Action *</label>
        {selectedIntervention ? (
          <div style={action === 'Cloture' ? s.actionBadgeCloture : s.actionBadgeOuverture}>
            {action === 'Cloture' ? '🔒 Clôture' : '🔓 Ouverture'}
            <span style={s.actionFixed}> (imposée par le statut)</span>
          </div>
        ) : (
          <div style={s.segmented}>
            {[{ v: 'Ouverture', l: '🔓 Ouverture' }, { v: 'Cloture', l: '🔒 Clôture' }].map(a => (
              <button key={a.v} type="button" onClick={() => setAction(a.v)}
                style={action === a.v ? s.segActive : s.seg}>{a.l}</button>
            ))}
          </div>
        )}

        {/* Type */}
        {!selectedIntervention && (
          <>
            <label style={s.label}>Type d'intervention *</label>
            <div style={s.segmented3}>
              {[{ v: 'Curative', l: '🔧 Curative' }, { v: 'Preventive', l: '🛡️ Préventive' }, { v: 'Autre', l: '📋 Autre' }].map(t => (
                <button key={t.v} type="button" onClick={() => setType(t.v)}
                  style={typeIntervention === t.v ? s.segActive : s.seg}>{t.l}</button>
              ))}
            </div>
          </>
        )}

        {/* Description */}
        <label style={s.label}>
          Description / Observations
          {action === 'Cloture' && <span style={s.required}> *</span>}
        </label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
          style={{ ...s.input, resize: 'vertical', minHeight: 100, fontFamily: 'inherit' }}
          placeholder={action === 'Cloture'
            ? 'Travaux effectués, pièces remplacées, observations...'
            : 'Observations initiales, état de l\'équipement...'}
          required={action === 'Cloture'}
        />

        <button type="submit" disabled={saving}
          style={saving ? s.btnDisabled : { ...s.btn, background: action === 'Cloture' ? '#1d4ed8' : '#16a34a' }}>
          {saving ? 'Envoi...' : `Enregistrer — ${action}`}
        </button>
      </form>
    </div>
  );
};

// ── Styles ────────────────────────────────────────────────────────
const s = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    width: '100%', maxWidth: 460, background: '#fff', borderRadius: 24,
    padding: 28, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 0,
  },
  logoWrap: { textAlign: 'center', marginBottom: 8 },
  logoBadge: {
    width: 52, height: 52, background: '#1e3a8a', color: '#fff', borderRadius: '50%',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 24, fontWeight: 900, boxShadow: '0 8px 16px rgba(30,58,138,0.3)',
  },
  kicker: { margin: '0 0 2px', color: '#1d4ed8', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' },
  title:  { margin: '2px 0 4px', color: '#0f172a', fontSize: 24, fontWeight: 800 },
  muted:  { margin: '0 0 16px', color: '#64748b', fontSize: 13 },
  label: { display: 'block', color: '#334155', fontSize: 13, fontWeight: 700, margin: '14px 0 6px' },
  required: { color: '#ef4444' },
  sectionTitle: { margin: '12px 0 8px', color: '#334155', fontSize: 13, fontWeight: 700 },
  input: {
    width: '100%', border: '1px solid #cbd5e1', borderRadius: 12,
    padding: '12px 14px', fontSize: 15, color: '#0f172a',
    boxSizing: 'border-box', outline: 'none', background: '#f8fafc',
  },
  errorBox: {
    background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
    borderRadius: 10, padding: 12, fontSize: 14, margin: '8px 0',
  },
  btn: {
    width: '100%', marginTop: 16, border: 'none', borderRadius: 14, padding: 14,
    background: '#16a34a', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer',
  },
  btnDisabled: {
    width: '100%', marginTop: 16, border: 'none', borderRadius: 14, padding: 14,
    background: '#94a3b8', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'not-allowed',
  },
  btnSecondary: {
    width: '100%', marginTop: 8, border: '1.5px dashed #cbd5e1', borderRadius: 14,
    padding: 13, background: '#f8fafc', color: '#475569', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  backBtn: {
    padding: '6px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1',
    borderRadius: 8, color: '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  equipBadge: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'linear-gradient(135deg,#eff6ff,#dbeafe)', border: '1px solid #bfdbfe',
    borderRadius: 12, padding: '10px 14px', marginBottom: 14,
  },
  equipId:  { color: '#1e3a8a', fontSize: 20, fontWeight: 900 },
  equipNom: { color: '#1e293b', fontSize: 14, fontWeight: 700 },
  linkedBadge: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
    padding: '8px 12px', marginBottom: 4,
  },
  linkedLabel: { color: '#15803d', fontSize: 12, fontWeight: 700 },
  linkedDate:  { color: '#166534', fontSize: 12, fontWeight: 600 },
  ouvertureBox: {
    background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12,
    padding: '10px 14px', marginBottom: 10,
  },
  ouvertureLabel: { margin: '0 0 6px', color: '#92400e', fontSize: 12, fontWeight: 800 },
  ouvertureItem:  { color: '#78350f', fontSize: 13, fontWeight: 600 },
  ouvertureDesc:  { margin: '6px 0 0', color: '#92400e', fontSize: 12 },
  planCard: {
    width: '100%', background: '#f8fafc', border: '1.5px solid #e2e8f0',
    borderRadius: 14, padding: '14px 16px', marginBottom: 10,
    cursor: 'pointer', textAlign: 'left',
  },
  badgePlanifie: {
    display: 'inline-block', padding: '2px 8px', background: '#eff6ff',
    color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 20, fontSize: 11, fontWeight: 700,
  },
  badgeEnCours: {
    display: 'inline-block', padding: '2px 8px', background: '#fffbeb',
    color: '#b45309', border: '1px solid #fde68a', borderRadius: 20, fontSize: 11, fontWeight: 700,
  },
  planDate:   { color: '#334155', fontSize: 13, fontWeight: 700, marginTop: 6 },
  planTaches: { color: '#64748b', fontSize: 12, marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  planAction: { color: '#1d4ed8', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', paddingLeft: 8 },
  divider: {
    display: 'flex', alignItems: 'center', margin: '12px 0 8px', gap: 10,
    color: '#94a3b8', fontSize: 12,
  },
  segmented:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 },
  segmented3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 4 },
  seg: {
    padding: 12, border: '1px solid #cbd5e1', background: '#fff',
    color: '#334155', borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer',
  },
  segActive: {
    padding: 12, border: '2px solid #1d4ed8', background: '#eff6ff',
    color: '#1d4ed8', borderRadius: 12, fontWeight: 800, fontSize: 13, cursor: 'pointer',
  },
  actionBadgeOuverture: {
    background: '#f0fdf4', border: '2px solid #16a34a', borderRadius: 12,
    padding: '12px 16px', color: '#15803d', fontWeight: 800, fontSize: 14, marginBottom: 4,
  },
  actionBadgeCloture: {
    background: '#eff6ff', border: '2px solid #1d4ed8', borderRadius: 12,
    padding: '12px 16px', color: '#1d4ed8', fontWeight: 800, fontSize: 14, marginBottom: 4,
  },
  actionFixed: { color: '#94a3b8', fontSize: 11, fontWeight: 500 },
  successIcon: {
    width: 64, height: 64, margin: '0 auto 12px', borderRadius: '50%',
    background: '#dcfce7', color: '#15803d', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 28,
  },
  summaryBox: {
    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12,
    padding: 14, marginTop: 12, textAlign: 'left',
  },
  summaryLine: { margin: '4px 0', fontSize: 13, color: '#334155' },
};

export default ScanInterventionPage;
