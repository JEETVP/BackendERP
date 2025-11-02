// Routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/notificationController');
const { requireAuth, requireRole } = require('../Middlewares/auth');

// Listar / ver detalle
router.get('/', requireAuth, ctrl.listNotifications);
router.get('/:id', requireAuth, ctrl.getNotificationById);

// Marcar leído / no leído
router.post('/:id/read', requireAuth, ctrl.markAsRead);
router.post('/:id/unread', requireAuth, ctrl.markAsUnread);

// Marcar múltiples como leídas
router.post('/mark-read', requireAuth, ctrl.bulkMarkAsRead);

// Eliminar (opcional): admin/manager o superuser
router.delete('/:id', requireAuth, requireRole('admin','manager'), ctrl.deleteNotification);

module.exports = router;
