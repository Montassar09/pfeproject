// ============================================================
// APP.JS - Routes principales de l'application
// ============================================================
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import AppLayout from './components/AppLayout';

// Pages Auth
import LoginPage                from './pages/auth/LoginPage';
import ResetPasswordDemandePage from './pages/auth/ResetPasswordDemandePage';
import ResetPasswordConfirmPage from './pages/auth/ResetPasswordConfirmPage';

// Pages Admin
import GestionUtilisateursPage from './pages/admin/GestionUtilisateursPage';
import GestionEquipementsPage  from './pages/admin/GestionEquipementsPage';
import AdminMonitoringPage     from './pages/admin/AdminMonitoringPage';
import AuditLogPage            from './pages/admin/AuditLogPage';
import InterventionsStagingPage from './pages/admin/InterventionsStagingPage';
import QrInterventionPage      from './pages/QrInterventionPage';

// Pages Responsable
import ListeEquipementsPage        from './pages/responsable/ListeEquipementsPage';
import PlanificationPreventivePage from './pages/responsable/PlanificationPreventivePage';

// Pages Technicien
import MesEquipementsPage      from './pages/technicien/MesEquipementsPage';
import TechnicienMonitoringPage from './pages/technicien/MonitoringPage';
import MesInterventionsPage    from './pages/technicien/MesInterventionsPage';
import VerificationsPage       from './pages/technicien/VerificationsPage';
import SeuilsPage              from './pages/technicien/SeuilsPage';
import ScanEauPage             from './pages/technicien/ScanEauPage';
import ScanElectricitePage     from './pages/technicien/ScanElecPage';
import ScanInterventionPage    from './pages/technicien/ScanInterventionPage';

// Pages publiques
import InterventionPubliquePage from './pages/InterventionPubliquePage';

// Page placeholder
const Dashboard = ({ titre, icone = '🔧' }) => (
  <div className="p-8 flex items-center justify-center min-h-full">
    <div className="text-center">
      <div className="text-7xl mb-4">{icone}</div>
      <h2 className="text-2xl font-bold text-gray-800">{titre}</h2>
      <p className="text-gray-500 mt-2 text-sm">Module en cours de developpement – Sprint suivant</p>
    </div>
  </div>
);

// Page 403
const NonAutorise = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-center">
      <div className="text-7xl font-bold text-red-400 mb-4">403</div>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Acces refuse</h2>
      <p className="text-gray-500 mb-6">Vous n avez pas les permissions pour cette page.</p>
      <a href="/login" className="px-6 py-3 bg-blue-900 text-white rounded-lg hover:bg-blue-800 transition">
        Retour connexion
      </a>
    </div>
  </div>
);

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>

          {/* ── Routes publiques ─────────────────────────── */}
          <Route path="/login"                 element={<LoginPage />} />
          <Route path="/reset-password"        element={<ResetPasswordDemandePage />} />
          <Route path="/reset-password/:token" element={<ResetPasswordConfirmPage />} />
          <Route path="/non-autorise"          element={<NonAutorise />} />

          {/* ── Routes Administrateur ────────────────────── */}
          <Route path="/admin" element={
            <PrivateRoute roles={['Administrateur']}>
              <AppLayout />
            </PrivateRoute>
          }>
            <Route path="utilisateurs"          element={<GestionUtilisateursPage />} />
            <Route path="equipements"           element={<GestionEquipementsPage />} />
            <Route path="monitoring"            element={<AdminMonitoringPage />} />
            <Route path="audit"                 element={<AuditLogPage />} />
            <Route path="qr-intervention"       element={<QrInterventionPage />} />
            <Route path="interventions-terrain" element={<InterventionsStagingPage />} />
          </Route>

          {/* ── Routes Responsable ───────────────────────── */}
          <Route path="/responsable" element={
            <PrivateRoute roles={['Responsable', 'Administrateur']}>
              <AppLayout />
            </PrivateRoute>
          }>
            <Route path="dashboard"             element={<Dashboard titre="Dashboard Responsable" icone="📊" />} />
            <Route path="equipements"           element={<ListeEquipementsPage />} />
            <Route path="interventions"         element={<PlanificationPreventivePage />} />
            <Route path="interventions-terrain" element={<InterventionsStagingPage />} />
            <Route path="qr-intervention"       element={<QrInterventionPage />} />
            <Route path="kpis"                  element={<Dashboard titre="KPIs Maintenance"     icone="📈" />} />
            <Route path="energie"               element={<Dashboard titre="Consommation Energie" icone="⚡" />} />
          </Route>

          {/* ── Routes Technicien ────────────────────────── */}
          <Route path="/technicien" element={
            <PrivateRoute roles={['Technicien', 'Administrateur', 'Responsable']}>
              <AppLayout />
            </PrivateRoute>
          }>
            <Route path="dashboard"     element={<Dashboard titre="Mon Dashboard"              icone="📊" />} />
            <Route path="equipements"   element={<MesEquipementsPage />} />
            <Route path="monitoring"    element={<TechnicienMonitoringPage />} />
            <Route path="seuils"        element={<SeuilsPage />} />
            <Route path="interventions" element={<MesInterventionsPage />} />
            <Route path="verifications" element={<VerificationsPage />} />
            <Route path="energie"       element={<Dashboard titre="Releves energie"            icone="⚡" />} />
          </Route>

          {/* ── Routes Lecteur ───────────────────────────── */}
          <Route path="/lecteur" element={
            <PrivateRoute roles={['Lecteur', 'Administrateur']}>
              <AppLayout />
            </PrivateRoute>
          }>
            <Route path="dashboard" element={<Dashboard titre="Tableau de bord Lecteur" icone="👁️" />} />
          </Route>

          {/* ── Routes Scan QR ───────────────────────────── */}
          <Route path="/scan/eau" element={
            <PrivateRoute roles={['Technicien', 'Administrateur']}>
              <ScanEauPage />
            </PrivateRoute>
          } />
          <Route path="/scan/electricite" element={
            <PrivateRoute roles={['Technicien', 'Administrateur']}>
              <ScanElectricitePage />
            </PrivateRoute>
          } />
          <Route path="/scan/intervention/:equipementId" element={<ScanInterventionPage />} />
          <Route path="/intervention/nouveau"            element={<InterventionPubliquePage />} />

          <Route path="/"  element={<Navigate to="/login" replace />} />
          <Route path="*"  element={<Navigate to="/login" replace />} />

        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
