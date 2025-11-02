const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'LOW_STOCK',      // Medicamento bajo punto de reorden
  'EXPIRY_SOON',    // Medicamento próximo a caducar
  'ORDER_STATUS',   // Cambio de estado de OC
  'SYSTEM_ALERT',   // Alertas del sistema
  'OTHER',          // Cualquier otro tipo
];

const notificationSchema = new mongoose.Schema(
  {
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      default: 'OTHER',
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    // Asociaciones opcionales
    medication: { type: mongoose.Schema.Types.ObjectId, ref: 'Medication' },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Meta flexible para información contextual
    meta: {
      stockQty: Number,
      reorderPoint: Number,
      expiryDate: Date,
      poCode: String,
      supplierName: String,
      customData: mongoose.Schema.Types.Mixed, // Para payloads personalizados
    },

    // Estado de la notificación
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },

    // Prioridad (opcional)
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },

    // Fecha de expiración (para limpieza automática o archivado)
    expiresAt: { type: Date },
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
   Índices estratégicos
   ========================= */
notificationSchema.index({ hospital: 1, type: 1, read: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL opcional si deseas auto-limpieza

/* =========================
   Hooks
   ========================= */
notificationSchema.pre('validate', function (next) {
  if (this.title) this.title = this.title.trim();
  if (this.message) this.message = this.message.trim();
  next();
});

/* =========================
   Métodos de dominio
   ========================= */

// Marcar como leída
notificationSchema.methods.markAsRead = function () {
  this.read = true;
  this.readAt = new Date();
  return this.save();
};

// Marcar como no leída
notificationSchema.methods.markAsUnread = function () {
  this.read = false;
  this.readAt = null;
  return this.save();
};

// Calcular si está expirada (útil para limpieza manual)
notificationSchema.methods.isExpired = function () {
  return this.expiresAt && new Date() > this.expiresAt;
};

module.exports = mongoose.model('Notification', notificationSchema);