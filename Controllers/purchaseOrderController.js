// Controllers/purchaseOrderController.js
const mongoose = require('mongoose');
const PurchaseOrder = require('../Models/PurchaseOrder');
const InventoryTransaction = require('../Models/InventoryTransaction');
const Notification = require('../Models/Notification');
const Medication = require('../Models/Medication');
const Supplier = require('../Models/Supplier');

/* =========================
   Helpers
   ========================= */

function calcTotals(po) {
  const subtotal = (po.lines || []).reduce((acc, l) => acc + (Number(l.qty) * Number(l.unitPrice)), 0);
  const taxAmount = po.taxRate > 0 ? subtotal * po.taxRate : 0;
  const total = subtotal + taxAmount;
  return { subtotal, taxAmount, total };
}

async function notifyOrderStatus({ hospital, po, title, message, priority = 'medium' }) {
  return Notification.create({
    hospital,
    type: 'ORDER_STATUS',
    title,
    message,
    purchaseOrder: po._id,
    priority,
    meta: { poCode: po.code, status: po.status }
  });
}

// Suma recibida por medicamento para una PO (a partir de transacciones IN ref a la PO)
async function getReceivedQtyByMedication(poId) {
  const rows = await InventoryTransaction.aggregate([
    { $match: { refType: 'PO', refId: new mongoose.Types.ObjectId(poId), type: 'IN' } },
    { $group: { _id: '$medication', received: { $sum: '$qty' } } }
  ]);
  const map = new Map();
  for (const r of rows) map.set(String(r._id), Number(r.received));
  return map;
}

/* =========================
   1) createPO
   ========================= */
/**
 * POST /api/purchase-orders
 * body: { code?, hospital, supplier, taxRate?, currency?, lines:[{medication, qty, unitPrice, uom?, description?}], notes? }
 * Crea en DRAFT, calcula totales y genera Notification(ORDER_STATUS).
 */
exports.createPO = async (req, res, next) => {
  try {
    const { hospital, supplier, taxRate = 0.16, currency = 'MXN', lines = [], notes, code } = req.body;

    if (!hospital || !supplier) {
      return res.status(400).json({ ok: false, message: 'hospital y supplier son requeridos' });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ ok: false, message: 'Debe incluir al menos una línea' });
    }

    // Validaciones básicas de línea
    for (const l of lines) {
      if (!l.medication || !l.qty || l.qty <= 0 || l.unitPrice == null) {
        return res.status(400).json({ ok: false, message: 'Cada línea requiere medication, qty>0 y unitPrice' });
      }
      // opcional: validar que el medicamento exista
      // const med = await Medication.findById(l.medication); if (!med) ...
    }

    const poCode =
      code ||
      `PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*9000+1000)}`;

    const poData = {
      code: poCode,
      hospital,
      supplier,
      status: 'DRAFT',
      currency,
      taxRate,
      lines: lines.map(l => ({
        medication: l.medication,
        description: l.description || undefined,
        qty: Number(l.qty),
        uom: l.uom || 'unit',
        unitPrice: Number(l.unitPrice),
        subtotal: Number(l.qty) * Number(l.unitPrice),
        lot: l.lot || undefined,
        expiryDate: l.expiryDate || undefined,
        notes: l.notes || undefined
      })),
      notes,
      createdBy: req.user?.id
    };

    const totals = calcTotals(poData);
    poData.subtotal = totals.subtotal;
    poData.taxAmount = totals.taxAmount;
    poData.total = totals.total;

    const po = await PurchaseOrder.create(poData);

    await notifyOrderStatus({
      hospital,
      po,
      title: `OC creada: ${po.code}`,
      message: `Orden de compra creada en estado DRAFT por ${po.lines.length} línea(s).`,
      priority: 'medium'
    });

    return res.status(201).json({ ok: true, data: po });
  } catch (err) {
    next(err);
  }
};

/* =========================
   2) listPOs
   ========================= */
/**
 * GET /api/purchase-orders
 * Filtros: hospital, supplier, status, code, dateFrom, dateTo
 * Paginación: page, limit; Orden: sort (ej. -createdAt)
 */
exports.listPOs = async (req, res, next) => {
  try {
    const { hospital, supplier, status, code, dateFrom, dateTo, page = 1, limit = 20, sort = '-createdAt' } = req.query;

    const filter = {};
    if (hospital) filter.hospital = hospital;
    if (supplier) filter.supplier = supplier;
    if (status)   filter.status = status;
    if (code)     filter.code = new RegExp(code, 'i');
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.createdAt.$lte = new Date(dateTo);
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const skip = (pg - 1) * lim;

    const [rows, total] = await Promise.all([
      PurchaseOrder.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(lim)
        .lean(),
      PurchaseOrder.countDocuments(filter)
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
   3) getPOById
   ========================= */
/**
 * GET /api/purchase-orders/:id
 * Popula hospital/supplier y regresa info recibida por medicamento.
 */
exports.getPOById = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id)
      .populate('hospital', 'name code')
      .populate('supplier', 'name rfc')
      .lean();

    if (!po) return res.status(404).json({ ok: false, message: 'PO no encontrada' });

    // Calcular recibido por medicamento (para mostrar progreso)
    const receivedMap = await getReceivedQtyByMedication(po._id);
    const lines = (po.lines || []).map(l => {
      const medId = String(l.medication);
      const received = receivedMap.get(medId) || 0;
      return { ...l, received, pending: Math.max(0, Number(l.qty) - received) };
    });

    return res.json({ ok: true, data: { ...po, lines } });
  } catch (err) {
    next(err);
  }
};

/* =========================
   5) markSent
   ========================= */
/**
 * POST /api/purchase-orders/:id/send
 * Cambia DRAFT -> SENT. Notifica.
 */
exports.markSent = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ ok: false, message: 'PO no encontrada' });

    if (po.status !== 'DRAFT') {
      return res.status(409).json({ ok: false, message: `Solo DRAFT puede enviarse (actual: ${po.status})` });
    }

    po.status = 'SENT';
    po.updatedBy = req.user?.id;
    await po.save();

    await notifyOrderStatus({
      hospital: po.hospital,
      po,
      title: `OC enviada: ${po.code}`,
      message: `Orden de compra marcada como SENT.`,
      priority: 'medium'
    });

    return res.json({ ok: true, data: po });
  } catch (err) {
    next(err);
  }
};

/* =========================
   6) receivePO (recepción)
   ========================= */
/**
 * POST /api/purchase-orders/:id/receive
 * body: { items: [{ medication, qty, lot?, expiryDate?, unitCost? }], note? }
 * - Crea InventoryTransaction IN por cada item (refType: 'PO', refId: po._id) en una session.
 * - Si todas las líneas quedan recibidas (>= qty ordenada), marca la PO como RECEIVED y setea receivedAt.
 * - Notifica recepción (parcial o total).
 */
exports.receivePO = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { items = [], note } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: 'items es requerido y no puede estar vacío' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ ok: false, message: 'PO no encontrada' });

    if (!['SENT', 'RECEIVED'].includes(po.status) && po.status !== 'DRAFT') {
      // Permitimos recepción también si por error quedó en DRAFT
      return res.status(409).json({ ok: false, message: `Estado inválido para recepción: ${po.status}` });
    }

    // Validar que los items correspondan a medicamentos de la PO
    const lineMedIds = new Set(po.lines.map(l => String(l.medication)));
    for (const it of items) {
      if (!it.medication || !it.qty || it.qty <= 0) {
        return res.status(400).json({ ok: false, message: 'Cada item requiere medication y qty>0' });
      }
      if (!lineMedIds.has(String(it.medication))) {
        return res.status(400).json({ ok: false, message: 'Item contiene medicamento que no está en la PO' });
      }
    }

    await session.withTransaction(async () => {
      for (const it of items) {
        const med = await Medication.findById(it.medication).session(session);
        if (!med) throw new Error('Medication not found');

        const tx = new InventoryTransaction({
          hospital: po.hospital,
          medication: it.medication,
          type: 'IN',
          qty: Number(it.qty),
          uom: med.uom || 'unit',
          lot: it.lot || undefined,
          expiryDate: it.expiryDate || undefined,
          unitCost: it.unitCost ?? med.unitPrice ?? 0,
          reason: 'PURCHASE_RECEIPT',
          refType: 'PO',
          refId: po._id,
          refCode: po.code,
          notes: note || undefined,
          createdBy: req.user?.id,
        });
        await tx.save({ session });
      }

      // Recalcular recibido y, si corresponde, cerrar la PO
      const receivedMap = await getReceivedQtyByMedication(po._id);
      const allReceived = po.lines.every(l => {
        const received = receivedMap.get(String(l.medication)) || 0;
        return received >= Number(l.qty);
      });

      if (allReceived) {
        po.status = 'RECEIVED';
        po.receivedAt = new Date();
        po.updatedBy = req.user?.id;
        await po.save({ session });
      } else if (po.status === 'DRAFT') {
        // Si estaba en DRAFT y se recibió algo, lo movemos al menos a SENT
        po.status = 'SENT';
        po.updatedBy = req.user?.id;
        await po.save({ session });
      }
    });

    // Notificación según el estado final
    const freshPO = await PurchaseOrder.findById(po._id).lean();
    const receivedMap = await getReceivedQtyByMedication(po._id);
    const receivedTotals = (freshPO.lines || []).map(l => ({
      medication: l.medication,
      ordered: Number(l.qty),
      received: receivedMap.get(String(l.medication)) || 0,
      pending: Math.max(0, Number(l.qty) - (receivedMap.get(String(l.medication)) || 0))
    }));

    await notifyOrderStatus({
      hospital: freshPO.hospital,
      po: freshPO,
      title: freshPO.status === 'RECEIVED'
        ? `OC recibida COMPLETA: ${freshPO.code}`
        : `OC con recepción PARCIAL: ${freshPO.code}`,
      message: freshPO.status === 'RECEIVED'
        ? 'Todas las líneas fueron recibidas.'
        : 'Se registró recepción parcial.',
      priority: freshPO.status === 'RECEIVED' ? 'high' : 'medium'
    });

    return res.status(201).json({
      ok: true,
      data: {
        po: freshPO,
        receivedSummary: receivedTotals
      }
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};
