const mongoose = require('mongoose');

const policySchema = new mongoose.Schema(
  {
    // Punto de reorden global (no por hospital)
    reorderPoint: { type: Number, min: 0, default: 0 },
    // Stock de seguridad global
    safetyStock: { type: Number, min: 0, default: 0 },
    // Consumo mensual promedio (unidades/mes) para cobertura de días
    avgMonthlyConsumption: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const storageSchema = new mongoose.Schema(
  {
    conditions: { type: String, trim: true }, // p.ej. "Lugar fresco y seco"
    temperatureMinC: { type: Number, min: -50, max: 80 }, // °C
    temperatureMaxC: { type: Number, min: -50, max: 80 }, // °C
  },
  { _id: false }
);

const medicationSchema = new mongoose.Schema(
  {
    // Identificador único externo (catálogo)
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      immutable: true, // no permitir cambiar el código
      match: [/^[A-Z0-9\-\.]{3,40}$/, 'Invalid medication code format'],
      index: true,
    },

    // Nombre comercial o genérico
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 200,
      index: true,
    },

    // Forma farmacéutica y potencia
    form: {
      type: String,
      trim: true,
      // puedes acotar en prod con enum si tu catálogo es fijo
      // enum: ['tablet','capsule','injection','syrup','solution','cream','ointment','drops','spray']
    },
    strength: { type: String, trim: true }, // p.ej. "500 mg", "5 mg/mL"

    // Unidad de manejo y empaque
    uom: {
      type: String,
      trim: true,
      default: 'unit', // 'unit','mg','g','ml','IU', etc.
    },
    packSize: { type: Number, min: 1, default: 1 }, // unidades por empaque

    // Precios
    unitPrice: { type: Number, min: 0, default: 0 }, // precio por unidad de manejo

    // Claves, códigos auxiliares y barras
    barcodes: [
      {
        type: String,
        trim: true,
      },
    ],
    atcCode: { type: String, trim: true }, // opcional: clasificación
    sku: { type: String, trim: true },     // opcional: SKU interno

    // Relación sugerida (no obligatoria) para compras
    preferredSupplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },

    // Políticas globales (no por hospital, según tu requerimiento)
    policy: { type: policySchema, default: () => ({}) },

    // Almacenamiento y control
    storage: { type: storageSchema, default: () => ({}) },
    isControlled: { type: Boolean, default: false }, // psicotrópico/estupefaciente
    isActive: { type: Boolean, default: true, index: true },

    // Auditoría
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    // importante para evitar "lost updates" en ambientes concurrentes
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
   Índices
   ========================= */
// Búsqueda compuesta común: name + forma + potencia
medicationSchema.index({ name: 1, form: 1, strength: 1 });
// Texto para búsquedas libres (name, code, strength)
medicationSchema.index({ name: 'text', code: 'text', strength: 'text' });
// Unicidad de barcodes a nivel colección (útil si los usas globalmente)
medicationSchema.index({ barcodes: 1 }, { unique: true, sparse: true });

/* =========================
   Validaciones de consistencia
   ========================= */
medicationSchema.pre('validate', function (next) {
  if (this.code) this.code = this.code.toUpperCase().trim();
  if (this.name) this.name = this.name.trim();

  // Regla de negocio: reorderPoint >= safetyStock
  const pol = this.policy || {};
  if (
    typeof pol.reorderPoint === 'number' &&
    typeof pol.safetyStock === 'number' &&
    pol.reorderPoint < pol.safetyStock
  ) {
    return next(
      new Error('policy.reorderPoint must be >= policy.safetyStock')
    );
  }

  // Opcional: coherencia de temperaturas si ambas existen
  const st = this.storage || {};
  if (
    typeof st.temperatureMinC === 'number' &&
    typeof st.temperatureMaxC === 'number' &&
    st.temperatureMinC > st.temperatureMaxC
  ) {
    return next(
      new Error('storage.temperatureMinC must be <= storage.temperatureMaxC')
    );
  }

  next();
});

/* =========================
   Virtuales útiles
   ========================= */
// cobertura estimada en días = stock / (consumo diario)
medicationSchema.virtual('policy.dailyConsumption').get(function () {
  const m = this.policy?.avgMonthlyConsumption || 0;
  return m > 0 ? m / 30 : 0;
});

/* =========================
   Métodos de dominio (ejemplos)
   ========================= */
medicationSchema.methods.effectiveReorderPoint = function () {
  // espacio para lógica futura (por ahora: global)
  return this.policy?.reorderPoint || 0;
};

module.exports = mongoose.model('Medication', medicationSchema);