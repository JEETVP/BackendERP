const mongoose = require('mongoose');

/* =========================
   Subesquema: Detalle de línea
   ========================= */
const purchaseOrderLineSchema = new mongoose.Schema(
  {
    medication: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medication',
      required: true,
      index: true,
    },
    description: { type: String, trim: true },
    qty: { type: Number, required: true, min: [0.0001, 'Quantity must be > 0'] },
    uom: { type: String, trim: true, default: 'unit' },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
      default: function () {
        return this.qty * this.unitPrice;
      },
    },
    lot: { type: String, trim: true },          // opcional, si se predefine
    expiryDate: { type: Date },                 // opcional
    notes: { type: String, trim: true },
  },
  { _id: false }
);

/* =========================
   Esquema principal: PurchaseOrder
   ========================= */
const purchaseOrderSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9\-_]{3,40}$/, 'Invalid PO code format'],
      index: true,
    },

    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      required: true,
      index: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED'],
      default: 'DRAFT',
      index: true,
    },

    lines: {
      type: [purchaseOrderLineSchema],
      validate: [
        arr => arr.length > 0,
        'Purchase order must have at least one line item',
      ],
    },

    currency: { type: String, trim: true, default: 'MXN' },
    taxRate: { type: Number, min: 0, max: 1, default: 0.16 },
    subtotal: { type: Number, min: 0, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },

    expectedDelivery: { type: Date },
    receivedAt: { type: Date },
    cancelledAt: { type: Date },

    notes: { type: String, trim: true },

    // Auditoría
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    versionKey: true,
    optimisticConcurrency: true,
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
   Índices críticos
   ========================= */
purchaseOrderSchema.index({ hospital: 1, supplier: 1, createdAt: -1 });
purchaseOrderSchema.index({ status: 1, createdAt: -1 });

/* =========================
   Hooks y cálculos automáticos
   ========================= */
purchaseOrderSchema.pre('validate', function (next) {
  if (this.code) this.code = this.code.trim().toUpperCase();

  // Recalcular totales antes de guardar
  if (this.lines && this.lines.length > 0) {
    const subtotal = this.lines.reduce(
      (acc, l) => acc + l.qty * l.unitPrice,
      0
    );
    this.subtotal = subtotal;
    this.taxAmount = this.taxRate > 0 ? subtotal * this.taxRate : 0;
    this.total = this.subtotal + this.taxAmount;
  }

  // Validación de coherencia entre status y fechas
  if (this.status === 'RECEIVED' && !this.receivedAt) {
    this.receivedAt = new Date();
  }
  if (this.status === 'CANCELLED' && !this.cancelledAt) {
    this.cancelledAt = new Date();
  }

  next();
});

/* =========================
   Métodos de dominio
   ========================= */

// Marca como enviada
purchaseOrderSchema.methods.markSent = function (userId) {
  this.status = 'SENT';
  this.updatedBy = userId;
  return this.save();
};

// Marca como recibida
purchaseOrderSchema.methods.markReceived = function (userId) {
  this.status = 'RECEIVED';
  this.receivedAt = new Date();
  this.updatedBy = userId;
  return this.save();
};

// Marca como cancelada
purchaseOrderSchema.methods.markCancelled = function (userId, reason = '') {
  this.status = 'CANCELLED';
  this.cancelledAt = new Date();
  this.notes = (this.notes ? this.notes + '\n' : '') + `Cancelled: ${reason}`;
  this.updatedBy = userId;
  return this.save();
};

// Calcula total actual (útil antes de persistir)
purchaseOrderSchema.methods.calculateTotals = function () {
  const subtotal = this.lines.reduce((acc, l) => acc + l.qty * l.unitPrice, 0);
  const taxAmount = this.taxRate > 0 ? subtotal * this.taxRate : 0;
  const total = subtotal + taxAmount;
  return { subtotal, taxAmount, total };
};

/* =========================
   Virtuales útiles
   ========================= */
purchaseOrderSchema.virtual('lineCount').get(function () {
  return this.lines?.length || 0;
});

purchaseOrderSchema.virtual('isClosed').get(function () {
  return ['RECEIVED', 'CANCELLED'].includes(this.status);
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);