const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/hospitalController');
const { requireAuth } = require('../Middlewares/auth');

// listar: superuser ve todos; otros, solo su hospital (el controller ya lo aplica)
router.get('/', requireAuth, ctrl.listHospitals);

// crear: superuser o admin (si quieres solo superuser, cámbialo por un middleware de rol)
router.post('/', requireAuth, ctrl.createHospital);

// eliminar: solo superuser (validación también en controller)
router.delete('/:id', requireAuth, ctrl.deleteHospital);

module.exports = router;
