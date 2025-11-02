// Models/Hospital.js
const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zip: { type: String, trim: true },
    country: { type: String, trim: true, default: 'MX' },
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    emails: [{ type: String, lowercase: true, trim: true }],
    phones: [{ type: String, trim: true }],
  },
  { _id: false }
);

const hospitalSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 150,
      index: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      // Ej: HGP-001, IMSS45, etc.
      match: [/^[A-Z0-9\-]{3,20}$/, 'Invalid hospital code format'],
    },
    address: addressSchema,
    contact: contactSchema,
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    settings: {
      timezone: { type: String, default: 'America/Mexico_City' },
      currency: { type: String, default: 'MXN' },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // opcional
  },
  {
    timestamps: true,
    versionKey: false,
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

// Índices compuestos útiles para búsquedas
hospitalSchema.index({ code: 1 }, { unique: true });
hospitalSchema.index({ name: 1, status: 1 });

// Normaliza code antes de validar/guardar
hospitalSchema.pre('validate', function (next) {
  if (this.code) this.code = this.code.toUpperCase().trim();
  next();
});

module.exports = mongoose.model('Hospital', hospitalSchema);
