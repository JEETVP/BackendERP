// Controllers/inventoryTransactionController.js
const mongoose = require('mongoose');
const InventoryTransaction = require('../Models/InventoryTransaction');
const Medication = require('../Models/Medication');

/* =========================
   Helpers
   ========================= */

// Expresión para qty con signo en pipelines
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

// Stock actual total por hospital+medicación (opcional por lote/expiración)
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

// Valida que la operación no deje el stock por debajo de safetyStock
async function assertSafetyStock({ hospitalId, medication, projected }) {
  const safety = medication.policy?.safetyStock || 0;
  if (safety > 0 && projected < safety) {
    const name = medication.name || 'medication';
    const msg = `Operación bloqueada: el stock proyectado de ${name} (${projected}) quedaría por debajo del safetyStock (${safety}).`;
    const err = new Error(msg);
    err.statusCode = 409;
    throw err;
  }
}

/* =========================
   1) listTransactions
   ========================= */
/**
 * GET /api/inventory-transactions
 * Filtros: hospital, medication, type, refType, refId, lot, dateFrom, dateTo
 * Paginación: page, limit
 */
exports.listTransactions = async (req, res, next) => {
  try {
    const {
      hospital, medication, type, refType, refId, lot,
      dateFrom, dateTo,
      page = 1, limit = 20, sort = '-createdAt'
    } = req.query;

    const filter = {};
    if (hospital)  filter.hospital  = new mongoose.Types.ObjectId(hospital);
    if (medication) filter.medication = new mongoose.Types.ObjectId(medication);
    if (type)      filter.type      = type;
    if (refType)   filter.refType   = refType;
    if (refId)     filter.refId     = new mongoose.Types.ObjectId(refId);
    if (lot)       filter.lot       = lot;
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.createdAt.$lte = new Date(dateTo);
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const skip = (pg - 1) * lim;

    const [rows, total] = await Promise.all([
      InventoryTransaction.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(lim)
        .lean(),
      InventoryTransaction.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      data: rows,
      meta: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) }
    });
  } catch (err) {
    next(err);
  }
};

/* =========================
   2) getTransactionById
   ========================= */
/**
 * GET /api/inventory-transactions/:id
 */
exports.getTransactionById = async (req, res, next) => {
  try {
    const doc = await InventoryTransaction.findById(req.params.id)
      .populate('hospital', 'name code')
      .populate('medication', 'name code')
      .lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'Transaction not found' });
    return res.json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

/* =========================
   3) createIn (entrada)
   ========================= */
/**
 * POST /api/inventory-transactions/in
 * body: { hospital, medication, qty, lot?, expiryDate?, unitCost?, reason?, refType?, refId?, refCode? }
 */
exports.createIn = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const {
      hospital, medication, qty, lot, expiryDate,
      unitCost, reason = 'PURCHASE_RECEIPT', refType = 'OTHER', refId, refCode
    } = req.body;

    if (!hospital || !medication || !qty) {
      return res.status(400).json({ ok: false, message: 'hospital, medication y qty son requeridos' });
    }

    const med = await Medication.findById(medication);
    if (!med) return res.status(404).json({ ok: false, message: 'Medication not found' });

    const hId = new mongoose.Types.ObjectId(hospital);
    const mId = new mongoose.Types.ObjectId(medication);
    const current = await getCurrentStock({ hospitalId: hId, medicationId: mId });
    const projected = current + Number(qty);

    // Entradas no violan safety stock (safety es mínimo), así que no validamos límite superior.

    await session.withTransaction(async () => {
      const tx = new InventoryTransaction({
        hospital: hId,
        medication: mId,
        type: 'IN',
        qty: Number(qty),
        uom: med.uom || 'unit',
        lot: lot || undefined,
        expiryDate: expiryDate || undefined,
        unitCost: unitCost ?? med.unitPrice ?? 0,
        reason,
        refType,
        refId: refId ? new mongoose.Types.ObjectId(refId) : undefined,
        refCode,
        createdBy: req.user?.id,
      });
      await tx.save({ session });
    });

    const after = await getCurrentStock({ hospitalId: hId, medicationId: mId });
    return res.status(201).json({ ok: true, message: 'Entrada registrada', data: { before: current, after, projected } });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};

/* =========================
   4) createOut (salida)
   ========================= */
/**
 * POST /api/inventory-transactions/out
 * body: { hospital, medication, qty, lot?, expiryDate?, reason?, refType?, refId?, refCode? }
 */
exports.createOut = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const {
      hospital, medication, qty, lot, expiryDate,
      reason = 'CONSUMPTION', refType = 'OTHER', refId, refCode
    } = req.body;

    if (!hospital || !medication || !qty) {
      return res.status(400).json({ ok: false, message: 'hospital, medication y qty son requeridos' });
    }

    const med = await Medication.findById(medication);
    if (!med) return res.status(404).json({ ok: false, message: 'Medication not found' });

    const hId = new mongoose.Types.ObjectId(hospital);
    const mId = new mongoose.Types.ObjectId(medication);

    const current = await getCurrentStock({ hospitalId: hId, medicationId: mId });
    const projected = current - Number(qty);

    // Regla de safety stock: no permitir bajar por debajo
    await assertSafetyStock({ hospitalId: hId, medication: med, projected });

    await session.withTransaction(async () => {
      const tx = new InventoryTransaction({
        hospital: hId,
        medication: mId,
        type: 'OUT',
        qty: Number(qty),
        uom: med.uom || 'unit',
        lot: lot || undefined,
        expiryDate: expiryDate || undefined,
        reason,
        refType,
        refId: refId ? new mongoose.Types.ObjectId(refId) : undefined,
        refCode,
        createdBy: req.user?.id,
      });
      await tx.save({ session });
    });

    const after = await getCurrentStock({ hospitalId: hId, medicationId: mId });
    return res.status(201).json({ ok: true, message: 'Salida registrada', data: { before: current, after, projected } });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};

/* =========================
   5) createAdjust (ajuste +/-)
   ========================= */
/**
 * POST /api/inventory-transactions/adjust
 * body: { hospital, medication, qty, adjustSign: 'IN'|'OUT', lot?, expiryDate?, reason?, refType?, refId? }
 */
exports.createAdjust = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const {
      hospital, medication, qty, adjustSign,
      lot, expiryDate, reason = (adjustSign === 'IN' ? 'ADJUST_POS' : 'ADJUST_NEG'),
      refType = 'ADJ', refId, refCode
    } = req.body;

    if (!hospital || !medication || !qty || !adjustSign) {
      return res.status(400).json({ ok: false, message: 'hospital, medication, qty y adjustSign son requeridos' });
    }
    if (!['IN', 'OUT'].includes(adjustSign)) {
      return res.status(400).json({ ok: false, message: 'adjustSign inválido' });
    }

    const med = await Medication.findById(medication);
    if (!med) return res.status(404).json({ ok: false, message: 'Medication not found' });

    const hId = new mongoose.Types.ObjectId(hospital);
    const mId = new mongoose.Types.ObjectId(medication);
    const current = await getCurrentStock({ hospitalId: hId, medicationId: mId });

    let projected = current;
    if (adjustSign === 'IN') projected = current + Number(qty);
    else projected = current - Number(qty);

    // Safety: solo aplica si reduce stock
    if (adjustSign === 'OUT') {
      await assertSafetyStock({ hospitalId: hId, medication: med, projected });
    }

    await session.withTransaction(async () => {
      const tx = new InventoryTransaction({
        hospital: hId,
        medication: mId,
        type: 'ADJUST',
        adjustSign,
        qty: Number(qty),
        uom: med.uom || 'unit',
        lot: lot || undefined,
        expiryDate: expiryDate || undefined,
        reason,
        refType,
        refId: refId ? new mongoose.Types.ObjectId(refId) : undefined,
        refCode,
        createdBy: req.user?.id,
      });
      await tx.save({ session });
    });

    const after = await getCurrentStock({ hospitalId: hId, medicationId: mId });
    return res.status(201).json({
      ok: true, message: 'Ajuste registrado',
      data: { before: current, after, projected }
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};

/* =========================
   6) transferBetweenHospitals
   ========================= */
/**
 * POST /api/inventory-transactions/transfer
 * body: { fromHospital, toHospital, medication, qty, lot?, expiryDate?, refCode? }
 * Crea OUT en origen y IN en destino en una sola transacción (session).
 */
exports.transferBetweenHospitals = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { fromHospital, toHospital, medication, qty, lot, expiryDate, refCode } = req.body;
    if (!fromHospital || !toHospital || !medication || !qty) {
      return res.status(400).json({ ok: false, message: 'fromHospital, toHospital, medication y qty son requeridos' });
    }
    if (fromHospital === toHospital) {
      return res.status(400).json({ ok: false, message: 'fromHospital y toHospital no pueden ser iguales' });
    }

    const med = await Medication.findById(medication);
    if (!med) return res.status(404).json({ ok: false, message: 'Medication not found' });

    const fromId = new mongoose.Types.ObjectId(fromHospital);
    const toId   = new mongoose.Types.ObjectId(toHospital);
    const mId    = new mongoose.Types.ObjectId(medication);

    // Validar safety stock en origen
    const currentFrom = await getCurrentStock({ hospitalId: fromId, medicationId: mId });
    const projectedFrom = currentFrom - Number(qty);
    await assertSafetyStock({ hospitalId: fromId, medication: med, projected: projectedFrom });

    await session.withTransaction(async () => {
      // OUT en origen
      const outTx = new InventoryTransaction({
        hospital: fromId,
        medication: mId,
        type: 'OUT',
        qty: Number(qty),
        uom: med.uom || 'unit',
        lot: lot || undefined,
        expiryDate: expiryDate || undefined,
        reason: 'TRANSFER_OUT',
        refType: 'XFER',
        refCode,
        createdBy: req.user?.id,
      });
      await outTx.save({ session });

      // IN en destino
      const inTx = new InventoryTransaction({
        hospital: toId,
        medication: mId,
        type: 'IN',
        qty: Number(qty),
        uom: med.uom || 'unit',
        lot: lot || undefined,
        expiryDate: expiryDate || undefined,
        reason: 'TRANSFER_IN',
        refType: 'XFER',
        refId: outTx._id, // vínculo opcional
        refCode,
        createdBy: req.user?.id,
      });
      await inTx.save({ session });
    });

    const afterFrom = await getCurrentStock({ hospitalId: fromId, medicationId: mId });
    const afterTo   = await getCurrentStock({ hospitalId: toId,   medicationId: mId });

    return res.status(201).json({
      ok: true,
      message: 'Transferencia registrada',
      data: {
        from: { before: currentFrom, after: afterFrom },
        to:   { after: afterTo }
      }
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};

/* =========================
   7) writeOffExpired (baja por caducidad)
   ========================= */
/**
 * POST /api/inventory-transactions/writeoff-expired
 * body: { hospital, cutoffDate, medication? }
 * Busca lotes con expiración <= cutoffDate y stock > 0 y genera OUT por esa cantidad.
 */
exports.writeOffExpired = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { hospital, cutoffDate, medication } = req.body;
    if (!hospital || !cutoffDate) {
      return res.status(400).json({ ok: false, message: 'hospital y cutoffDate son requeridos' });
    }
    const hId = new mongoose.Types.ObjectId(hospital);
    const cutoff = new Date(cutoffDate);

    const match = { hospital: hId, expiryDate: { $ne: null, $lte: cutoff } };
    if (medication) match.medication = new mongoose.Types.ObjectId(medication);

    // Agrupa por med+lot+expiry para hallar stock por lote
    const lots = await InventoryTransaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: { medication: '$medication', lot: '$lot', expiryDate: '$expiryDate' },
          stock: { $sum: signedQtyExpr }
        }
      },
      { $match: { stock: { $gt: 0 } } }
    ]);

    if (!lots.length) {
      return res.json({ ok: true, message: 'No hay lotes vencidos con stock positivo', data: [] });
    }

    await session.withTransaction(async () => {
      for (const l of lots) {
        const mId = l._id.medication;
        const medDoc = await Medication.findById(mId).session(session);
        if (!medDoc) continue;

        // Validar safety en total (baja por caducidad no debe dejar por debajo del safety)
        const totalCurrent = await getCurrentStock({ hospitalId: hId, medicationId: mId });
        const projected = totalCurrent - l.stock;
        await assertSafetyStock({ hospitalId: hId, medication: medDoc, projected });

        const tx = new InventoryTransaction({
          hospital: hId,
          medication: mId,
          type: 'OUT',
          qty: l.stock,
          uom: medDoc.uom || 'unit',
          lot: l._id.lot || undefined,
          expiryDate: l._id.expiryDate || undefined,
          reason: 'WRITE_OFF',
          refType: 'OTHER',
          notes: 'Write-off por caducidad',
          createdBy: req.user?.id
        });
        await tx.save({ session });
      }
    });

    return res.status(201).json({ ok: true, message: 'Bajas por caducidad registradas', data: lots });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};

/* =========================
   8) kardexByMedication (saldo acumulado)
   ========================= */
/**
 * GET /api/inventory-transactions/kardex
 * query: hospital, medication, dateFrom?, dateTo?
 * Devuelve movimientos con columna de saldo acumulado (requiere MongoDB 5+: $setWindowFields)
 */
exports.kardexByMedication = async (req, res, next) => {
  try {
    const { hospital, medication, dateFrom, dateTo } = req.query;
    if (!hospital || !medication) {
      return res.status(400).json({ ok: false, message: 'hospital y medication son requeridos' });
    }

    const match = {
      hospital: new mongoose.Types.ObjectId(hospital),
      medication: new mongoose.Types.ObjectId(medication),
    };
    if (dateFrom || dateTo) {
      match.createdAt = {};
      if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   match.createdAt.$lte = new Date(dateTo);
    }

    const rows = await InventoryTransaction.aggregate([
      { $match: match },
      { $sort: { createdAt: 1, _id: 1 } },
      {
        $set: {
          signedQty: signedQtyExpr
        }
      },
      {
        $setWindowFields: {
          sortBy: { createdAt: 1, _id: 1 },
          output: {
            runningBalance: {
              $sum: '$signedQty',
              window: { documents: ['unbounded', 'current'] }
            }
          }
        }
      }
    ]);

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
