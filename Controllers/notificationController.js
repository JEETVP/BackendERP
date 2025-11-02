// Controllers/notificationController.js
const mongoose = require('mongoose');
const Notification = require('../Models/Notification');

// Normaliza filtros comunes
function buildFilter(query) {
  const {
    hospital, type, read, priority, dateFrom, dateTo, medication, purchaseOrder
  } = query;

  const filter = {};
  if (hospital)       filter.hospital = new mongoose.Types.ObjectId(hospital);
  if (type)           filter.type = type; // LOW_STOCK | EXPIRY_SOON | ORDER_STATUS | ...
  if (priority)       filter.priority = priority; // low|medium|high|critical
  if (medication)     filter.medication = new mongoose.Types.ObjectId(medication);
  if (purchaseOrder)  filter.purchaseOrder = new mongoose.Types.ObjectId(purchaseOrder);

  // read: 'true' | 'false' | undefined
  if (typeof read === 'string') {
    if (read.toLowerCase() === 'true')  filter.read = true;
    if (read.toLowerCase() === 'false') filter.read = false;
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo)   filter.createdAt.$lte = new Date(dateTo);
  }

  return filter;
}

/**
 * GET /api/notifications
 * Filtros: hospital, type, read(true|false), priority, medication, purchaseOrder, dateFrom, dateTo
 * Paginación: page, limit; Orden: sort (ej. -createdAt)
 * Caso de uso: "ver todas las notificaciones pendientes" -> usar ?read=false&hospital=<id>
 */
exports.listNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, sort = '-createdAt' } = req.query;

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const skip = (pg - 1) * lim;

    const filter = buildFilter(req.query);

    // Si no es superuser y tiene hospital asignado, limitamos por alcance
    if (!req.user?.isSuperUser && req.user?.hospital) {
      filter.hospital = new mongoose.Types.ObjectId(req.user.hospital);
    }

    const [rows, total] = await Promise.all([
      Notification.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(lim)
        .lean(),
      Notification.countDocuments(filter)
    ]);

    res.json({
      ok: true,
      data: rows,
      meta: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/notifications/:id
 */
exports.getNotificationById = async (req, res, next) => {
  try {
    const doc = await Notification.findById(req.params.id)
      .populate('hospital', 'name code')
      .populate('medication', 'name code')
      .populate('purchaseOrder', 'code status')
      .lean();

    if (!doc) return res.status(404).json({ ok: false, message: 'Notification not found' });

    // Alcance (si no es superuser, debe pertenecer a su hospital)
    if (!req.user?.isSuperUser && req.user?.hospital && String(doc.hospital?._id) !== String(req.user.hospital)) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    res.json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/notifications/:id/read
 * Marca como leída
 */
exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Notification.findById(id);
    if (!doc) return res.status(404).json({ ok: false, message: 'Notification not found' });

    if (!req.user?.isSuperUser && req.user?.hospital && String(doc.hospital) !== String(req.user.hospital)) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    if (!doc.read) {
      doc.read = true;
      doc.readAt = new Date();
      await doc.save();
    }
    res.json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/notifications/:id/unread
 * Marca como NO leída
 */
exports.markAsUnread = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Notification.findById(id);
    if (!doc) return res.status(404).json({ ok: false, message: 'Notification not found' });

    if (!req.user?.isSuperUser && req.user?.hospital && String(doc.hospital) !== String(req.user.hospital)) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    if (doc.read) {
      doc.read = false;
      doc.readAt = null;
      await doc.save();
    }
    res.json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/notifications/mark-read
 * body: { ids: [id1,id2,...] }
 * Marca múltiples como leídas
 */
exports.bulkMarkAsRead = async (req, res, next) => {
  try {
    const { ids = [] } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, message: 'ids es requerido (array no vacío)' });
    }

    // Si el usuario no es superuser, restringe por hospital
    const filter = { _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } };
    if (!req.user?.isSuperUser && req.user?.hospital) {
      filter.hospital = new mongoose.Types.ObjectId(req.user.hospital);
    }

    const result = await Notification.updateMany(filter, { $set: { read: true, readAt: new Date() } });
    res.json({ ok: true, data: { matched: result.matchedCount, modified: result.modifiedCount } });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/notifications/:id
 * (Opcional) Eliminar una notificación (admin/manager o superuser)
 */
exports.deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;

    const doc = await Notification.findById(id);
    if (!doc) return res.status(404).json({ ok: false, message: 'Notification not found' });

    if (!req.user?.isSuperUser && req.user?.hospital && String(doc.hospital) !== String(req.user.hospital)) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    await Notification.findByIdAndDelete(id);
    res.json({ ok: true, message: 'Notification deleted' });
  } catch (err) {
    next(err);
  }
};
