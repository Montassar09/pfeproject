// ============================================================
// PAGE GESTION ÉQUIPEMENTS (ADMIN)
// Full CRUD operations for administrators
// ============================================================
import React, { useState, useEffect } from 'react';
import { equipementsAPI } from '../../api';
import QrInterventionModal from '../../components/QrInterventionModal';

const GestionEquipementsPage = () => {
  const [equipements, setEquipements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingEquipement, setEditingEquipement] = useState(null);
  const [formData, setFormData] = useState({ nom: '' });
  const [qrModal, setQrModal] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrBaseUrl, setQrBaseUrl] = useState(window.location.origin);
  const [copied, setCopied] = useState(false);

  // Charger les équipements
  const chargerEquipements = async () => {
    try {
      setLoading(true);
      const response = await equipementsAPI.getAll();
      setEquipements(response.data);
      setErreur('');
    } catch (err) {
      setErreur('Erreur lors du chargement des équipements.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    chargerEquipements();
  }, []);

  // Gérer le formulaire
  const handleSubmit = async (e) => {
    e.preventDefault();
    setErreur('');
    
    try {
      if (editingEquipement) {
        // Modifier
        await equipementsAPI.update(editingEquipement.id, formData);
      } else {
        // Créer
        await equipementsAPI.create(formData);
      }
      
      // Réinitialiser le formulaire
      setFormData({ nom: '' });
      setEditingEquipement(null);
      setShowModal(false);
      
      // Recharger les équipements
      chargerEquipements();
    } catch (err) {
      setErreur(err.response?.data?.message || 'Erreur lors de l\'opération.');
    }
  };

  // Supprimer un équipement
  const handleSupprimer = async (id) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cet équipement ?')) {
      return;
    }
    
    try {
      await equipementsAPI.delete(id);
      chargerEquipements();
    } catch (err) {
      setErreur(err.response?.data?.message || 'Erreur lors de la suppression.');
    }
  };

  // Ouvrir le modal pour modifier
  const handleModifier = (equipement) => {
    setEditingEquipement(equipement);
    setFormData({ nom: equipement.nom });
    setShowModal(true);
  };

  // Ouvrir le modal pour créer
  const handleCreer = () => {
    setEditingEquipement(null);
    setFormData({ nom: '' });
    setShowModal(true);
  };

  const handleQr = async (equipement, baseUrl = qrBaseUrl) => {
    try {
      setQrLoading(true);
      setErreur('');
      const response = await equipementsAPI.getInterventionQr(equipement.id, baseUrl);
      setQrModal(response.data);
    } catch (err) {
      setErreur(err.response?.data?.message || 'Erreur lors de la generation du QR code.');
    } finally {
      setQrLoading(false);
    }
  };

  const imprimerQr = () => {
    window.print();
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Gestion des Équipements</h1>
        <button
          onClick={handleCreer}
          className="px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 transition"
        >
          + Ajouter un équipement
        </button>
      </div>

      {erreur && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {erreur}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-900"></div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Nom
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {equipements.map((equipement) => (
                <tr key={equipement.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {equipement.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {equipement.nom}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => handleModifier(equipement)}
                      className="text-blue-600 hover:text-blue-900 mr-3"
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => handleQr(equipement)}
                      className="text-green-700 hover:text-green-900 mr-3"
                      disabled={qrLoading}
                    >
                      QR intervention
                    </button>
                    <button
                      onClick={() => handleSupprimer(equipement.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {equipements.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Aucun équipement trouvé
            </div>
          )}
        </div>
      )}

      {/* Modal pour ajouter/modifier */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingEquipement ? 'Modifier l\'équipement' : 'Ajouter un équipement'}
            </h2>
            
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom de l'équipement
                </label>
                <input
                  type="text"
                  value={formData.nom}
                  onChange={(e) => setFormData({ nom: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800"
                >
                  {editingEquipement ? 'Modifier' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <QrInterventionModal
        qrModal={qrModal}
        onClose={() => { setQrModal(null); setCopied(false); }}
        copied={copied}
        onCopy={() => {
          navigator.clipboard.writeText(qrModal.url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      />
    </div>
  );
};

export default GestionEquipementsPage;
