// Routes/purchaseOrderRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/purchaseOrderController');
const { requireAuth, requireRole } = require('../Middlewares/auth');

// Listado y detalle (solo autenticado)
router.get('/', requireAuth, ctrl.listPOs);            // ?hospital=&supplier=&status=&code=&dateFrom=&dateTo=&page=&limit=&sort=
router.get('/:id', requireAuth, ctrl.getPOById);

// Crear OC (admin/manager)
router.post('/', requireAuth, requireRole('admin','manager'), ctrl.createPO);

// Enviar OC (DRAFT -> SENT) (admin/manager)
router.post('/:id/send', requireAuth, requireRole('admin','manager'), ctrl.markSent);

// Recepción de OC (parcial/total) (admin/manager)
router.post('/:id/receive', requireAuth, requireRole('admin','manager'), ctrl.receivePO);

module.exports = router;
