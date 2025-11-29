const bcrypt = require('bcrypt');
const User = require('../Models/User');

const SUPER_EMAIL = process.env.SUPERUSER_EMAIL || 'root@sideways.com';
const SUPER_PASSWORD = process.env.SUPERUSER_PASSWORD || 'SuperAdmin123!';
const SUPER_NAME = process.env.SUPERUSER_NAME || 'Root Admin';

async function ensureSuperUser() {
  try {
    // 1. Verificar si ya existe superuser
    const exists = await User.findOne({ isSuperUser: true });
    if (exists) {
      console.log("✔ Superuser ya existe:", exists.email);
      return;
    }

    // 2. Crear superuser automáticamente
    const hashed = await bcrypt.hash(SUPER_PASSWORD, 12);

    await User.create({
      email: SUPER_EMAIL,
      name: SUPER_NAME,
      password: hashed,
      role: 'admin',
      isSuperUser: true,
      status: 'active',
    });

    console.log("🔥 Superuser creado automáticamente:", SUPER_EMAIL);

  } catch (err) {
    console.error("❌ Error creando superuser automático:", err);
  }
}

module.exports = ensureSuperUser;
