// ============================================================
// TECHNICIEN MONITORING PAGE
// Water, Electricity, Photovoltaic monitoring with full CRUD
// ============================================================
import React, { useState, useEffect, useMemo } from 'react';
import { monitoringAPI } from '../../api';

const MonitoringPage = () => {
  const [activeTab, setActiveTab] = useState('eau');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [stats, setStats] = useState({});
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [search, setSearch] = useState('');

  // ── Modal state (partagé pour eau / electricite / photovoltaique) ──
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');   // 'eau' | 'electricite' | 'photovoltaique'
  const [editItem, setEditItem] = useState(null);
  const [formData, setFormData] = useState({});
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    setDateDebut('');
    setDateFin('');
    setSearch('');
    fetchData();
  }, [activeTab]);

  const filteredData = useMemo(() => {
    let result = [...data];
    const getDateStr = (item) => {
      let d;
      if (activeTab === 'eau' || activeTab === 'electricite') d = item.date_releve;
      else if (activeTab === 'photovoltaique') d = item.date;
      else d = item.date_intervention;
      return d ? String(d).slice(0, 10) : null;
    };
    if (dateDebut) {
      result = result.filter(item => { const d = getDateStr(item); return d && d >= dateDebut; });
    }
    if (dateFin) {
      result = result.filter(item => { const d = getDateStr(item); return d && d <= dateFin; });
    }
    if (search && activeTab === 'interventions') {
      const q = search.toLowerCase();
      result = result.filter(item => (item.panne_description || '').toLowerCase().includes(q));
    }
    return result;
  }, [data, dateDebut, dateFin, search, activeTab]);

  // ── Fetch data ────────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    try {
      let dataResponse, statsResponse;
      switch (activeTab) {
        case 'eau':
          dataResponse = await monitoringAPI.getWaterConsumption();
          statsResponse = await monitoringAPI.getWaterStats();
          break;
        case 'electricite':
          dataResponse = await monitoringAPI.getElectricityConsumption();
          statsResponse = await monitoringAPI.getElectricityStats();
          break;
        case 'photovoltaique':
          dataResponse = await monitoringAPI.getPhotovoltaicProduction();
          statsResponse = await monitoringAPI.getPhotovoltaicStats();
          break;
        case 'interventions':
          dataResponse = await monitoringAPI.getInterventions();
          statsResponse = await monitoringAPI.getInterventionsStats();
          break;
        default:
          return;
      }
      setData(dataResponse.data || []);
      setStats(statsResponse.data || {});
    } catch (error) {
      console.error('Error fetching monitoring data:', error);
    } finally {
      setLoading(false);
    }
  };

  // ── Ouvrir modal Eau ──────────────────────────────────────
  const openEauModal = (item = null) => {
    setModalType('eau');
    setEditItem(item);
    setFormData({
      date_releve: item ? (item.date_releve ? String(item.date_releve).slice(0, 10) : '') : '',
      compteur: item ? (item.compteur ?? '') : '',
    });
    setFormError('');
    setShowModal(true);
  };

  // ── Ouvrir modal Électricité ──────────────────────────────
  const openElecModal = (item = null) => {
    setModalType('electricite');
    setEditItem(item);
    setFormData({
      date_releve: item ? (item.date_releve ? String(item.date_releve).slice(0, 10) : '') : '',
      phase1: item ? (item.phase1 ?? '') : '',
      phase2: item ? (item.phase2 ?? '') : '',
      phase3: item ? (item.phase3 ?? '') : '',
    });
    setFormError('');
    setShowModal(true);
  };

  // ── Ouvrir modal Photovoltaïque ───────────────────────────
  const openPvModal = (item = null) => {
    setModalType('photovoltaique');
    setEditItem(item);
    setFormData({
      date: item ? (item.date ? String(item.date).slice(0, 10) : '') : '',
      production_journaliere_kwh: item ? (item.production_journaliere_kwh ?? '') : '',
      puissance_installee_kwp: item ? (item.puissance_installee_kwp ?? '') : '',
    });
    setFormError('');
    setShowModal(true);
  };

  // ── Supprimer ─────────────────────────────────────────────
  const handleDelete = async (type, id) => {
    if (!window.confirm('Confirmer la suppression de cet enregistrement ?')) return;
    try {
      if (type === 'eau') await monitoringAPI.deleteWaterConsumption(id);
      else if (type === 'electricite') await monitoringAPI.deleteElectricityConsumption(id);
      else if (type === 'photovoltaique') await monitoringAPI.deletePhotovoltaicProduction(id);
      fetchData();
    } catch (err) {
      alert('Erreur lors de la suppression : ' + (err.response?.data?.message || err.message));
    }
  };

  // ── Soumettre le formulaire (Ajout ou Modification) ───────
  const handleFormSubmit = async () => {
    setFormError('');

    // Validation par type
    if (modalType === 'eau') {
      if (!formData.date_releve || !formData.compteur) {
        setFormError('La date et la valeur du compteur sont obligatoires.');
        return;
      }
    } else if (modalType === 'electricite') {
      if (!formData.date_releve || formData.phase1 === '' || formData.phase2 === '' || formData.phase3 === '') {
        setFormError('La date et les 3 phases sont obligatoires.');
        return;
      }
    } else if (modalType === 'photovoltaique') {
      if (!formData.date || !formData.puissance_installee_kwp) {
        setFormError('La date et la puissance installée sont obligatoires.');
        return;
      }
    }

    setFormLoading(true);
    try {
      if (modalType === 'eau') {
        const payload = { date_releve: formData.date_releve, compteur: parseFloat(formData.compteur) };
        if (editItem) await monitoringAPI.updateWaterConsumption(editItem.id, payload);
        else await monitoringAPI.addWaterConsumption(payload);
      } else if (modalType === 'electricite') {
        const payload = {
          date_releve: formData.date_releve,
          phase1: parseFloat(formData.phase1),
          phase2: parseFloat(formData.phase2),
          phase3: parseFloat(formData.phase3),
        };
        if (editItem) await monitoringAPI.updateElectricityConsumption(editItem.id, payload);
        else await monitoringAPI.addElectricityConsumption(payload);
      } else if (modalType === 'photovoltaique') {
        const payload = {
          date: formData.date,
          production_journaliere_kwh: formData.production_journaliere_kwh !== '' ? parseFloat(formData.production_journaliere_kwh) : null,
          puissance_installee_kwp: parseFloat(formData.puissance_installee_kwp),
        };
        if (editItem) await monitoringAPI.updatePhotovoltaicProduction(editItem.id, payload);
        else await monitoringAPI.addPhotovoltaicProduction(payload);
      }
      setShowModal(false);
      fetchData();
    } catch (err) {
      setFormError('Erreur : ' + (err.response?.data?.message || err.message));
    } finally {
      setFormLoading(false);
    }
  };

  // ── Render Eau ────────────────────────────────────────────
  const renderWaterTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Total des relevés</h3>
          <p className="text-2xl font-bold text-blue-600">{stats.total_readings || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Consommation totale</h3>
          <p className="text-2xl font-bold text-green-600">{stats.total_consumption || 0} m³</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Période</h3>
          <p className="text-sm text-gray-900">
            {stats.first_reading && stats.last_reading
              ? `${new Date(stats.first_reading).toLocaleDateString('fr-FR')} - ${new Date(stats.last_reading).toLocaleDateString('fr-FR')}`
              : 'N/A'}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Relevés de consommation d'eau</h3>
          <button
            onClick={() => openEauModal()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            <span>+</span> Ajouter un relevé
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Compteur (m³)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conso. Journalière (m³)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Coût Total (DT)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400">Aucun relevé trouvé</td>
                </tr>
              ) : (
                filteredData.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(item.date_releve).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.compteur}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.consommation_journaliere > 0 ? item.consommation_journaliere : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-medium">
                      {item.cout_total != null ? Number(item.cout_total).toLocaleString('fr-FR', { minimumFractionDigits: 3 }) : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => openEauModal(item)}
                        className="text-blue-600 hover:text-blue-800 font-medium mr-3"
                      >
                        ✏️ Modifier
                      </button>
                      <button
                        onClick={() => handleDelete('eau', item.id)}
                        className="text-red-600 hover:text-red-800 font-medium"
                      >
                        🗑️ Supprimer
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ── Render Électricité ────────────────────────────────────
  const renderElectricityTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Total des relevés</h3>
          <p className="text-2xl font-bold text-blue-600">{stats.total_readings || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Consommation moyenne</h3>
          <p className="text-2xl font-bold text-yellow-600">{Math.round(stats.avg_consumption || 0)} kWh</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Période</h3>
          <p className="text-sm text-gray-900">
            {stats.first_reading && stats.last_reading
              ? `${new Date(stats.first_reading).toLocaleDateString('fr-FR')} - ${new Date(stats.last_reading).toLocaleDateString('fr-FR')}`
              : 'N/A'}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Relevés de consommation électrique</h3>
          <button
            onClick={() => openElecModal()}
            className="bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-yellow-600 flex items-center gap-2"
          >
            <span>+</span> Ajouter un relevé
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phase 1 (kWh)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phase 2 (kWh)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phase 3 (kWh)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conso. Jour (kWh)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Coût Total (DT)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-400">Aucun relevé trouvé</td>
                </tr>
              ) : (
                filteredData.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(item.date_releve).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.phase1}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.phase2}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.phase3}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-700 font-medium">
                      {item.consommation_jour != null ? Number(item.consommation_jour).toLocaleString('fr-FR') : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-medium">
                      {item.cout_total != null ? Number(item.cout_total).toLocaleString('fr-FR', { minimumFractionDigits: 3 }) : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => openElecModal(item)}
                        className="text-blue-600 hover:text-blue-800 font-medium mr-3"
                      >
                        ✏️ Modifier
                      </button>
                      <button
                        onClick={() => handleDelete('electricite', item.id)}
                        className="text-red-600 hover:text-red-800 font-medium"
                      >
                        🗑️ Supprimer
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ── Render Photovoltaïque ─────────────────────────────────
  const renderPhotovoltaicTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Total des enregistrements</h3>
          <p className="text-2xl font-bold text-blue-600">{stats.total_records || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Production totale</h3>
          <p className="text-2xl font-bold text-green-600">{stats.total_production || 0} kWh</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Production moyenne/jour</h3>
          <p className="text-2xl font-bold text-yellow-600">{stats.avg_production || 0} kWh</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Puissance installée</h3>
          <p className="text-2xl font-bold text-purple-600">{stats.installed_power || 0} kWp</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Production photovoltaïque</h3>
          <button
            onClick={() => openPvModal()}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2"
          >
            <span>+</span> Ajouter un enregistrement
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Puissance (kWp)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Production journalière (kWh)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Production cumulée (kWh)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Heures équiv. (h)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">Aucun enregistrement trouvé</td>
                </tr>
              ) : (
                filteredData.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(item.date).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.puissance_installee_kwp !== null ? item.puissance_installee_kwp : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.production_journaliere_kwh !== null ? item.production_journaliere_kwh : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.production_cumulee_kwh !== null ? item.production_cumulee_kwh : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.heures_equivalentes_h !== null ? item.heures_equivalentes_h : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => openPvModal(item)}
                        className="text-blue-600 hover:text-blue-800 font-medium mr-3"
                      >
                        ✏️ Modifier
                      </button>
                      <button
                        onClick={() => handleDelete('photovoltaique', item.id)}
                        className="text-red-600 hover:text-red-800 font-medium"
                      >
                        🗑️ Supprimer
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ── Render Interventions (lecture seule) ──────────────────
  const renderInterventionsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Total des interventions</h3>
          <p className="text-2xl font-bold text-blue-600">{stats.total_interventions || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Types uniques</h3>
          <p className="text-2xl font-bold text-orange-600">{stats.unique_pannes || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Coût total</h3>
          <p className="text-2xl font-bold text-green-600">{stats.total_quantity || 0}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Liste des interventions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID Panne</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID PRC</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantité</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400">Aucune intervention trouvée</td>
                </tr>
              ) : (
                filteredData.map((item) => (
                  <tr key={item.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.panne_id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.prc_id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.quantite}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{item.panne_description || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ── Render Modal ──────────────────────────────────────────
  const renderModal = () => {
    if (!showModal) return null;

    const titles = {
      eau: { add: 'Ajouter un relevé eau', edit: 'Modifier le relevé eau', color: 'bg-blue-600', hcolor: 'hover:bg-blue-700' },
      electricite: { add: 'Ajouter un relevé électricité', edit: 'Modifier le relevé électricité', color: 'bg-yellow-500', hcolor: 'hover:bg-yellow-600' },
      photovoltaique: { add: 'Ajouter une production PV', edit: 'Modifier la production PV', color: 'bg-purple-600', hcolor: 'hover:bg-purple-700' },
    };
    const t = titles[modalType] || {};

    return (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            {editItem ? t.edit : t.add}
          </h2>

          {formError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {formError}
            </div>
          )}

          <div className="space-y-4">
            {/* ── Champs EAU ── */}
            {modalType === 'eau' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date du relevé *</label>
                  <input
                    type="date"
                    value={formData.date_releve}
                    onChange={e => setFormData({ ...formData, date_releve: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valeur du compteur (m³) *</label>
                  <input
                    type="number"
                    step="0.001"
                    value={formData.compteur}
                    onChange={e => setFormData({ ...formData, compteur: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="ex: 3022.000"
                  />
                </div>
              </>
            )}

            {/* ── Champs ÉLECTRICITÉ ── */}
            {modalType === 'electricite' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date du relevé *</label>
                  <input
                    type="date"
                    value={formData.date_releve}
                    onChange={e => setFormData({ ...formData, date_releve: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phase 1 (kWh) *</label>
                    <input
                      type="number"
                      step="0.001"
                      value={formData.phase1}
                      onChange={e => setFormData({ ...formData, phase1: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                      placeholder="ex: 2560.1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phase 2 (kWh) *</label>
                    <input
                      type="number"
                      step="0.001"
                      value={formData.phase2}
                      onChange={e => setFormData({ ...formData, phase2: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                      placeholder="ex: 2401.5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phase 3 (kWh) *</label>
                    <input
                      type="number"
                      step="0.001"
                      value={formData.phase3}
                      onChange={e => setFormData({ ...formData, phase3: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                      placeholder="ex: 2389.7"
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── Champs PHOTOVOLTAÏQUE ── */}
            {modalType === 'photovoltaique' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={e => setFormData({ ...formData, date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Puissance installée (kWp) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.puissance_installee_kwp}
                    onChange={e => setFormData({ ...formData, puissance_installee_kwp: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="ex: 322.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Production journalière (kWh)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.production_journaliere_kwh}
                    onChange={e => setFormData({ ...formData, production_journaliere_kwh: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="ex: 850.00"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setShowModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Annuler
            </button>
            <button
              onClick={handleFormSubmit}
              disabled={formLoading}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${t.color} ${t.hcolor}`}
            >
              {formLoading ? 'Enregistrement...' : editItem ? '✅ Modifier' : '✅ Ajouter'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const tabs = [
    { id: 'eau', label: 'Consommation Eau', icon: '💧' },
    { id: 'electricite', label: 'Consommation Électricité', icon: '⚡' },
    { id: 'photovoltaique', label: 'Production Photovoltaïque', icon: '☀️' },
    { id: 'interventions', label: 'Interventions', icon: '🔧' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Monitoring des Énergies</h1>
        <p className="text-gray-600 mt-1">Gestion des relevés eau, électricité et production photovoltaïque</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Barre de filtre */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap gap-3 items-end mb-6">
        {activeTab !== 'interventions' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date début</label>
              <input
                type="date"
                value={dateDebut}
                onChange={e => setDateDebut(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date fin</label>
              <input
                type="date"
                value={dateFin}
                onChange={e => setDateFin(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </>
        )}
        {activeTab === 'interventions' && (
          <div className="flex-1 min-w-64">
            <label className="block text-xs font-medium text-gray-500 mb-1">Recherche (description)</label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
        <button
          onClick={() => { setDateDebut(''); setDateFin(''); setSearch(''); }}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          Réinitialiser
        </button>
        {!loading && (
          <span className="text-xs text-gray-400 self-end pb-2">
            {filteredData.length} / {data.length} enregistrement{data.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Contenu */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Chargement des données...</div>
        </div>
      ) : (
        <>
          {activeTab === 'eau' && renderWaterTab()}
          {activeTab === 'electricite' && renderElectricityTab()}
          {activeTab === 'photovoltaique' && renderPhotovoltaicTab()}
          {activeTab === 'interventions' && renderInterventionsTab()}
        </>
      )}

      {/* Modal CRUD (Eau / Électricité / Photovoltaïque) */}
      {renderModal()}
    </div>
  );
};

export default MonitoringPage;
