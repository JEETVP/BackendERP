// Models/Supplier.js
const mongoose = require('mongoose');

/* =========================
   Subesquemas
   ========================= */
const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city:  { type: String, trim: true },
    state: { type: String, trim: true },
    zip:   { type: String, trim: true },
    country: { type: String, trim: true, default: 'MX' },
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    name:  { type: String, trim: true },
    role:  { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const bankAccountSchema = new mongoose.Schema(
  {
    bankName:  { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    clabe: { type: String, trim: true, match: [/^\d{18}$/, 'CLABE must be 18 digits'] },
    swift: { type: String, trim: true },
    currency: { type: String, trim: true, default: 'MXN' },
  },
  { _id: false }
);

const paymentTermsSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ['transfer', 'cash', 'card', 'check', 'other'],
      default: 'transfer',
    },
    days: { type: Number, min: 0, max: 180, default: 30 }, // días de crédito
    creditLimit: { type: Number, min: 0, default: 0 },
    currency: { type: String, trim: true, default: 'MXN' },
  },
  { _id: false }
);

/* =========================
   Supplier
   ========================= */
const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 200,
      index: true,
    },

    // RFC de México (12/13 chars). Se valida formato general.
    rfc: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/, 'Invalid RFC format'],
      unique: true,
      sparse: true, // permite múltiples null/undefined
    },

    emails: [{ type: String, trim: true, lowercase: true }],
    phones: [{ type: String, trim: true }],

    contacts: [contactSchema],
    address: addressSchema,

    paymentTerms: { type: paymentTermsSchema, default: () => ({}) },
    bankAccounts: [bankAccountSchema],

    leadTimeDays: { type: Number, min: 0, max: 180, default: 7 }, // tiempo de entrega típico
    defaultCurrency: { type: String, trim: true, default: 'MXN' },
    preferredIncoterm: { type: String, trim: true }, // opcional

    isActive: { type: Boolean, default: true, index: true },

    notes: { type: String, trim: true },

    // Auditoría / relaciones
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
   Índices adicionales
   ========================= */
supplierSchema.index({ name: 1, isActive: 1 });
supplierSchema.index({ 'contacts.email': 1 }, { sparse: true });

/* =========================
   Normalización y reglas
   ========================= */
supplierSchema.pre('validate', function (next) {
  if (this.name) this.name = this.name.trim();
  if (this.rfc) this.rfc = this.rfc.toUpperCase().trim();

  // Si hay límite de crédito, requiere método != 'cash' (regla opcional)
  if (
    this.paymentTerms &&
    this.paymentTerms.creditLimit > 0 &&
    this.paymentTerms.method === 'cash'
  ) {
    return next(new Error('creditLimit requires a non-cash payment method'));
  }

  next();
});

module.exports = mongoose.model('Supplier', supplierSchema);
