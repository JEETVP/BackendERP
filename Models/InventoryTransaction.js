const mongoose = require('mongoose');

/**
 * Tipos de movimiento:
 *  - IN:    entrada (compra, retorno, ajuste positivo)
 *  - OUT:   salida  (consumo, merma, ajuste negativo)
 *  - ADJUST: ajuste explícito; requiere adjustSign = 'IN' | 'OUT'
 */
const TX_TYPES = ['IN', 'OUT', 'ADJUST'];

/**
 * Referencias de documento origen (auditoría / trazabilidad):
 *  - PO:           Purchase Order (orden de compra)
 *  - PO_RECEIPT:   recepción de OC
 *  - ISSUE:        orden de salida/dispensación
 *  - ADJ:          ajuste manual
 *  - XFER:         transferencia entre hospitales/almacenes
 *  - OTHER:        otros
 */
const REF_TYPES = ['PO', 'PO_RECEIPT', 'ISSUE', 'ADJ', 'XFER', 'OTHER'];

/**
 * Razón de movimiento (business semantics, para reporting)
 */
const REASONS = [
  'PURCHASE_RECEIPT', // entrada por compra
  'CONSUMPTION',      // salida por consumo/dispensación
  'RETURN_IN',        // devolución a inventario
  'RETURN_OUT',       // devolución a proveedor
  'ADJUST_POS',       // ajuste positivo
  'ADJUST_NEG',       // ajuste negativo
  'TRANSFER_IN',      // transferencia entrante
  'TRANSFER_OUT',     // transferencia saliente
  'WRITE_OFF',        // baja por caducidad/merma
  'OTHER'
];

const inventoryTransactionSchema = new mongoose.Schema(
  {
    // Scope y clave del ítem
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      required: true,
      index: true,
    },
    medication: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medication',
      required: true,
      index: true,
    },

    // Dirección del movimiento
    type: {
      type: String,
      enum: TX_TYPES,
      required: true,
      index: true,
    },
    // Cantidad siempre positiva; la dirección la da 'type'
    qty: {
      type: Number,
      required: true,
      min: [0.000001, 'qty must be > 0'],
    },
    uom: {
      type: String,
      trim: true,
      default: 'unit',
    },

    // Para ADJUST, especifica si el ajuste suma o resta
    adjustSign: {
      type: String,
      enum: ['IN', 'OUT'],
      required: function () { return this.type === 'ADJUST'; },
    },

    // Información de lote y caducidad (opcional, útil para FEFO y trazabilidad)
    lot: { type: String, trim: true, index: true },
    expiryDate: { type: Date, index: true },

    // Valuación (opcional, útil si manejas costo promedio/PEPS)
    unitCost: { type: Number, min: 0 },

    // Referencia al documento origen (para auditoría)
    refType: { type: String, enum: REF_TYPES, default: 'OTHER', index: true },
    refId: { type: mongoose.Schema.Types.ObjectId, index: true }, // id del doc origen (PO, receipt, issue, etc.)
    refCode: { type: String, trim: true }, // código legible (ej. PO-2025-0001)

    reason: { type: String, enum: REASONS, default: 'OTHER', index: true },
    notes: { type: String, trim: true },

    // Auditoría
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

/* =========================
   Índices estratégicos
   ========================= */

// Consultas frecuentes: inventario por hospital/medicación en rango de fechas
inventoryTransactionSchema.index({ hospital: 1, medication: 1, createdAt: -1 });

// Alertas de caducidad por hospital
inventoryTransactionSchema.index({ hospital: 1, expiryDate: 1 });

// Auditoría por documento origen
inventoryTransactionSchema.index({ refType: 1, refId: 1 });

// Búsqueda por lote dentro del hospital y medicamento
inventoryTransactionSchema.index(
  { hospital: 1, medication: 1, lot: 1 },
  { sparse: true }
);

/* =========================
   Validaciones de negocio
   ========================= */
inventoryTransactionSchema.pre('validate', function (next) {
  // qty > 0 siempre; la dirección la determina type o adjustSign
  if (!(this.qty > 0)) {
    return next(new Error('qty must be > 0'));
  }

  // Para ADJUST debe existir adjustSign
  if (this.type === 'ADJUST' && !this.adjustSign) {
    return next(new Error('adjustSign is required for ADJUST transactions'));
  }

  // unitCost recomendado en entradas para valuación
  if ((this.type === 'IN' || (this.type === 'ADJUST' && this.adjustSign === 'IN')) && this.unitCost == null) {
    // No bloqueamos, pero puedes volverlo obligatorio si manejas costos
    // return next(new Error('unitCost is required for IN transactions'));
  }

  next();
});

/* =========================
   Métodos de dominio
   ========================= */

// Devuelve qty con signo (+/-) según la dirección del movimiento
inventoryTransactionSchema.methods.getSignedQty = function () {
  if (this.type === 'IN') return this.qty;
  if (this.type === 'OUT') return -this.qty;
  // ADJUST
  return this.adjustSign === 'IN' ? this.qty : -this.qty;
};

// Helper para saber si afecta a un lote/caducidad específico
inventoryTransactionSchema.methods.hasBatchInfo = function () {
  return !!(this.lot || this.expiryDate);
};

module.exports = mongoose.model('InventoryTransaction', inventoryTransactionSchema);