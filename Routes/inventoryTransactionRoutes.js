const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/inventoryTransactionController');
const { requireAuth, requireRole } = require('../Middlewares/auth');

// --- Lectura ---
router.get('/', requireAuth, ctrl.listTransactions);                 // ?hospital=&medication=&type=&refType=&refId=&lot=&dateFrom=&dateTo=&page=&limit=
router.get('/kardex', requireAuth, ctrl.kardexByMedication);         // ?hospital=&medication=&dateFrom=&dateTo=
router.get('/:id', requireAuth, ctrl.getTransactionById);            // detalle por id

// --- Escritura (protegidas) ---
router.post('/in', requireAuth, requireRole('admin','manager'), ctrl.createIn);
router.post('/out', requireAuth, requireRole('admin','manager'), ctrl.createOut);
router.post('/adjust', requireAuth, requireRole('admin','manager'), ctrl.createAdjust);
router.post('/transfer', requireAuth, requireRole('admin','manager'), ctrl.transferBetweenHospitals);
router.post('/writeoff-expired', requireAuth, requireRole('admin','manager'), ctrl.writeOffExpired);

module.exports = router;
