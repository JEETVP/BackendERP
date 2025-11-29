const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/medicationController');
const { requireAuth, requireRole } = require('../Middlewares/auth');

// Crear medicamento
router.post('/', requireAuth, requireRole('admin','manager'), ctrl.createMedication);

// Listar / buscar por nombre (?q=)
router.get('/', requireAuth, ctrl.listMedications);

// Obtener 1 medicamento por id
router.get('/:id', requireAuth, ctrl.getMedication);

// Actualizar stock (increment/decrement/set)
router.post('/:id/stock', requireAuth, requireRole('admin','manager'), ctrl.updateStock);

// Buscar SOLO por nombre
router.get('/search/by-name', requireAuth, ctrl.searchMedicationByName);
module.exports = router;
