// Routes/supplierRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/supplierController');
const { requireAuth, requireRole } = require('../Middlewares/auth');

// Listar proveedores (cualquier usuario autenticado)
router.get('/', requireAuth, ctrl.listSuppliers);

// Crear proveedor (admin o manager)
router.post('/', requireAuth, requireRole('admin', 'manager'), ctrl.createSupplier);

// Eliminar proveedor (solo admin)
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.deleteSupplier);

module.exports = router;
