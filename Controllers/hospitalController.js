// Controllers/hospitalController.js
const Hospital = require('../Models/Hospital');
const User = require('../Models/User');
const InventoryTransaction = require('../Models/InventoryTransaction');
const PurchaseOrder = require('../Models/PurchaseOrder');

// POST /api/hospitals
exports.createHospital = async (req, res, next) => {
  try {
    const { name, code, address, contact, status, settings } = req.body;

    // Solo superuser o admin (si quieres forzar solo superuser, valida en routes/middleware)
    if (!req.user?.isSuperUser && req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    const exists = await Hospital.findOne({ code: String(code).toUpperCase().trim() });
    if (exists) return res.status(409).json({ ok: false, message: 'Hospital code already exists' });

    const doc = await Hospital.create({
      name, code, address, contact, status, settings,
      createdBy: req.user?.id
    });

    return res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/hospitals/:id
exports.deleteHospital = async (req, res, next) => {
  try {
    // Solo superuser
    if (!req.user?.isSuperUser) {
      return res.status(403).json({ ok: false, message: 'Only superuser can delete hospitals' });
    }

    const { id } = req.params;

    // Reglas de integridad: no borrar si tiene dependencias
    const userCount = await User.countDocuments({ hospital: id });
    if (userCount > 0) {
      return res.status(409).json({ ok: false, message: 'Hospital has users assigned' });
    }

    const txCount = await InventoryTransaction.countDocuments({ hospital: id });
    if (txCount > 0) {
      return res.status(409).json({ ok: false, message: 'Hospital has inventory transactions' });
    }

    const poCount = await PurchaseOrder.countDocuments({ hospital: id });
    if (poCount > 0) {
      return res.status(409).json({ ok: false, message: 'Hospital has purchase orders' });
    }

    const deleted = await Hospital.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, message: 'Hospital not found' });

    return res.json({ ok: true, message: 'Hospital deleted' });
  } catch (err) {
    next(err);
  }
};

// GET /api/hospitals
exports.listHospitals = async (req, res, next) => {
  try {
    if (req.user?.isSuperUser) {
      const list = await Hospital.find().sort({ name: 1 });
      return res.json({ ok: true, data: list });
    }

    // No superuser: devuelve solo el hospital del usuario (o 403 si no tiene)
    if (!req.user?.hospital) {
      return res.status(403).json({ ok: false, message: 'Access restricted: no hospital scope' });
    }

    const h = await Hospital.findById(req.user.hospital);
    if (!h) return res.status(404).json({ ok: false, message: 'Hospital not found' });

    return res.json({ ok: true, data: [h] });
  } catch (err) {
    next(err);
  }
};
