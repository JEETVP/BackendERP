const mongoose = require('mongoose');
const Medication = require('../Models/Medication');
const InventoryTransaction = require('../Models/InventoryTransaction');
const Notification = require('../Models/Notification');
const PurchaseOrder = require('../Models/PurchaseOrder');
const Supplier = require('../Models/Supplier');

/* ============ Helpers ============ */

// Expresión para sumar qty con signo en pipelines
const signedQtyExpr = {
  $switch: {
    branches: [
      { case: { $eq: ['$type', 'IN'] }, then: '$qty' },
      { case: { $eq: ['$type', 'OUT'] }, then: { $multiply: ['$qty', -1] } },
      {
        case: { $and: [{ $eq: ['$type', 'ADJUST'] }, { $eq: ['$adjustSign', 'IN'] }] },
        then: '$qty'
      },
      {
        case: { $and: [{ $eq: ['$type', 'ADJUST'] }, { $eq: ['$adjustSign', 'OUT'] }] },
        then: { $multiply: ['$qty', -1] }
      }
    ],
    default: 0
  }
};

// Stock actual por hospital/medicamento (y opcionalmente por lote/caducidad)
async function getCurrentStock({ hospitalId, medicationId, lot, expiryDate }) {
  const match = {
    hospital: new mongoose.Types.ObjectId(hospitalId),
    medication: new mongoose.Types.ObjectId(medicationId),
  };
  if (lot) match.lot = lot;
  if (expiryDate) match.expiryDate = expiryDate;

  const agg = await InventoryTransaction.aggregate([
    { $match: match },
    { $group: { _id: null, stock: { $sum: signedQtyExpr } } },
  ]);
  return agg[0]?.stock || 0;
}

// Si cae en punto de reorden: crea notificación y (si hay proveedor) PO DRAFT
async function maybeTriggerReorder({ hospitalId, medication }) {
  const stock = await getCurrentStock({ hospitalId, medicationId: medication._id });

  const reorderPoint = medication.policy?.reorderPoint || 0;
  const avgMonthly = medication.policy?.avgMonthlyConsumption || 0;
  const daily = avgMonthly > 0 ? avgMonthly / 30 : 0;
  const daysCoverage = daily ? Math.floor(stock / daily) : null;

  if (stock > reorderPoint) return { created: false };

  // Notificación LOW_STOCK
  const notif = await Notification.create({
    hospital: hospitalId,
    type: 'LOW_STOCK',
    title: `Stock bajo: ${medication.name}`,
    message: `Stock ${stock} ≤ Reorden ${reorderPoint}. Considera generar OC.`,
    medication: medication._id,
    priority: 'high',
    meta: {
      stockQty: stock,
      reorderPoint,
      dailyConsumption: daily,
      daysCoverage,
    }
  });

  // PO DRAFT sugerida si hay proveedor preferido
  let po = null;
  if (medication.preferredSupplier) {
    const supplier = await Supplier.findById(medication.preferredSupplier);
    if (supplier) {
      const code = `PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*9000+1000)}`;
      const safety = medication.policy?.safetyStock || 0;
      const target = safety + (avgMonthly || 0); // safety + 1 ciclo
      const toBuy = Math.max(0, target - stock);

      if (toBuy > 0) {
        po = await PurchaseOrder.create({
          code,
          hospital: hospitalId,
          supplier: supplier._id,
          status: 'DRAFT',
          currency: supplier.defaultCurrency || 'MXN',
          taxRate: 0.16,
          lines: [{
            medication: medication._id,
            description: medication.name,
            qty: toBuy,
            uom: medication.uom || 'unit',
            unitPrice: medication.unitPrice || 0,
            subtotal: (medication.unitPrice || 0) * toBuy
          }]
        });
        await Notification.create({
          hospital: hospitalId,
          type: 'ORDER_STATUS',
          title: `PO sugerida: ${code}`,
          message: `Borrador de OC por ${toBuy} de ${medication.name}.`,
          purchaseOrder: po._id,
          priority: 'medium',
          meta: { poCode: code }
        });
      }
    }
  }

  return { created: true, notificationId: notif._id, purchaseOrderId: po?._id || null };
}

/* ============ Controllers ============ */

// POST /api/medications
exports.createMedication = async (req, res, next) => {
  try {
    const doc = await Medication.create({
      code: req.body.code,
      name: req.body.name,
      form: req.body.form,
      strength: req.body.strength,
      uom: req.body.uom,
      packSize: req.body.packSize,
      unitPrice: req.body.unitPrice,
      barcodes: req.body.barcodes,
      atcCode: req.body.atcCode,
      sku: req.body.sku,
      preferredSupplier: req.body.preferredSupplier,
      policy: req.body.policy,
      storage: req.body.storage,
      isControlled: req.body.isControlled,
      isActive: req.body.isActive,
      createdBy: req.user?.id,
    });
    return res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

// GET /api/medications?q=parac
exports.listMedications = async (req, res, next) => {
  try {
    const { q } = req.query;
    const filter = q
      ? { $or: [
          { name: new RegExp(q, 'i') },
          { code: new RegExp(q, 'i') },
          { strength: new RegExp(q, 'i') }
        ] }
      : {};
    const meds = await Medication.find(filter).sort({ name: 1 });
    res.json({ ok: true, data: meds });
  } catch (err) {
    next(err);
  }
};

// GET /api/medications/:id
exports.getMedication = async (req, res, next) => {
  try {
    const med = await Medication.findById(req.params.id);
    if (!med) return res.status(404).json({ ok: false, message: 'Medication not found' });
    res.json({ ok: true, data: med });
  } catch (err) {
    next(err);
  }
};
// Helper local para escapar caracteres especiales en regex
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /api/medications/search/by-name?q=ibupro
 * Busca SOLO por nombre (case-insensitive, contiene).
 * Soporta paginación opcional: ?page=&limit=
 */
exports.searchMedicationByName = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;

    const term = (q || '').trim();
    if (!term) {
      return res.status(400).json({
        ok: false,
        message: 'El parámetro q (nombre del medicamento) es requerido'
      });
    }

    // Reglas de negocio suaves: evitar búsquedas de 1 letra
    if (term.length < 2) {
      return res.status(400).json({
        ok: false,
        message: 'Ingresa al menos 2 caracteres para buscar por nombre'
      });
    }

    const pg  = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const skip = (pg - 1) * lim;

    const regex = new RegExp(escapeRegex(term), 'i');

    const [rows, total] = await Promise.all([
      Medication.find({ name: regex })
        .sort({ name: 1 })
        .skip(skip)
        .limit(lim),
      Medication.countDocuments({ name: regex })
    ]);

    return res.json({
      ok: true,
      data: rows,
      meta: {
        page: pg,
        limit: lim,
        total,
        pages: Math.ceil(total / lim),
        query: term
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/medications/:id/stock
 * body: { hospitalId, action?: 'increment'|'decrement'|'set', qty, lot?, expiryDate?, reason?, unitCost? }
 * - Crea transacciones de inventario.
 * - Trigger de reorden si cae a <= reorderPoint.
 * - Regla de safetyStock: BLOQUEA operaciones cuyo stock proyectado quede < safetyStock.
 */
exports.updateStock = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    const { hospitalId, action = 'increment', qty, lot, expiryDate, reason, unitCost } = req.body;

    if (!hospitalId || qty == null) {
      return res.status(400).json({ ok: false, message: 'hospitalId y qty son requeridos' });
    }

    const med = await Medication.findById(id);
    if (!med) return res.status(404).json({ ok: false, message: 'Medication not found' });

    const hId = new mongoose.Types.ObjectId(hospitalId);
    const mId = new mongoose.Types.ObjectId(id);

    // Stock actual y proyección
    const current = await getCurrentStock({ hospitalId: hId, medicationId: mId, lot, expiryDate });

    let delta = 0;
    if (action === 'increment') delta = Number(qty);
    else if (action === 'decrement') delta = -Number(qty);
    else if (action === 'set') delta = Number(qty) - current;
    else return res.status(400).json({ ok: false, message: 'action inválida' });

    if (delta === 0) {
      return res.json({ ok: true, message: 'Sin cambios (delta=0)', data: { stock: current } });
    }

    const projected = current + delta;

    // === Regla de safety stock (bloquea si projected < safetyStock) ===
    const safety = med.policy?.safetyStock || 0;
    if (safety > 0 && projected < safety) {
      return res.status(409).json({
        ok: false,
        message: `Operación bloqueada: el stock proyectado (${projected}) quedaría por debajo del safetyStock (${safety}).`
      });
    }

    // Transacción (ACID)
    await session.withTransaction(async () => {
      const tx = new InventoryTransaction({
        hospital: hId,
        medication: mId,
        type: 'ADJUST',
        adjustSign: delta > 0 ? 'IN' : 'OUT',
        qty: Math.abs(delta),
        uom: med.uom || 'unit',
        lot: lot || undefined,
        expiryDate: expiryDate || undefined,
        unitCost: unitCost ?? med.unitPrice ?? 0,
        reason: delta > 0 ? 'ADJUST_POS' : 'ADJUST_NEG',
        refType: 'ADJ',
        notes: reason || undefined,
        createdBy: req.user?.id
      });
      await tx.save({ session });
    });

    // Recalcular y disparar reorder si aplica
    const after = await getCurrentStock({ hospitalId: hId, medicationId: mId });
    const trigger = await maybeTriggerReorder({ hospitalId: hId, medication: med });

    return res.json({
      ok: true,
      message: 'Stock actualizado',
      data: {
        before: current,
        after,
        triggerReorder: trigger.created,
        notificationId: trigger.notificationId || null,
        purchaseOrderId: trigger.purchaseOrderId || null
      }
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};
