// Models/User.js
const mongoose = require('mongoose');

const ROLES = ['admin', 'manager', 'clerk']; // ajusta si necesitas más

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'],
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },

    // Hash de contraseña (NUNCA guardes texto plano)
    password: {
      type: String,
      required: true,
      minlength: 10, // asumiendo ya hash (bcrypt ~60 chars), 10 es seguro para validar presencia
      select: false, // excluye por defecto en queries
    },

    // Rol operativo
    role: {
      type: String,
      enum: ROLES,
      default: 'clerk',
      lowercase: true,
      index: true,
    },

    // 🔒 Superusuario (omnipermisos por encima de role)
    isSuperUser: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Scope opcional por hospital
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      index: true,
    },

    // Estado de cuenta
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked'],
      default: 'active',
      index: true,
    },

    // Seguridad adicional opcional
    lastLoginAt: { type: Date },
    failedLoginCount: { type: Number, min: 0, default: 0 },
    accountLockedUntil: { type: Date },

    // Auditoría
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Para rotación de credenciales / invalidar sesiones
    passwordChangedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: true,             // __v
    optimisticConcurrency: true,  // evita "lost updates"
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.password; // no exponer hash
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

/* =========================
   Índices útiles
   ========================= */
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ hospital: 1, role: 1 });
userSchema.index({ status: 1, lastLoginAt: -1 });

/* =========================
   Normalización y reglas
   ========================= */
userSchema.pre('validate', function (next) {
  if (this.email) this.email = this.email.trim().toLowerCase();
  if (this.role) this.role = String(this.role).toLowerCase().trim();

  // Si es superusuario, ignora restricciones de rol/status (a tu criterio)
  if (this.isSuperUser && this.status === 'blocked') {
    return next(new Error('Superuser cannot be blocked (use caution)'));
  }

  next();
});

/* =========================
   Métodos de dominio
   ========================= */
// ¿Tiene el rol (o es superusuario)?
userSchema.methods.hasRole = function (...roles) {
  if (this.isSuperUser) return true;
  return roles.map(r => String(r).toLowerCase()).includes(this.role);
};

// Objeto seguro para respuestas
userSchema.methods.toSafeObject = function () {
  const { _id, email, name, role, isSuperUser, hospital, status, lastLoginAt } = this;
  return {
    id: _id,
    email,
    name,
    role,
    isSuperUser,
    hospital,
    status,
    lastLoginAt,
  };
};

// Para invalidar JWTs emitidos antes de un cambio de contraseña
userSchema.methods.changedPasswordAfter = function (jwtIatSeconds) {
  if (!this.passwordChangedAt) return false;
  const changedTimestamp = Math.floor(this.passwordChangedAt.getTime() / 1000);
  return changedTimestamp > jwtIatSeconds;
};

module.exports = mongoose.model('User', userSchema);
