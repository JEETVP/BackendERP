// Utils/ensureSuperUser.js
const bcrypt = require('bcryptjs');
const User = require('../Models/User');

const SUPER_EMAIL = process.env.SUPERUSER_EMAIL || 'jip@gmail.com';
const SUPER_PASSWORD = process.env.SUPERUSER_PASSWORD || 'eljipititch';
const SUPER_NAME = process.env.SUPERUSER_NAME || 'Root Admin';

async function ensureSuperUser() {
  try {
    const hashedPassword = await bcrypt.hash(SUPER_PASSWORD, 12);

    // 1) Buscar si ya hay un superuser
    let superUser = await User.findOne({ isSuperUser: true });

    if (superUser) {
      // 🔄 ACTUALIZARLO con los datos actuales
      superUser.email = SUPER_EMAIL;
      superUser.name = SUPER_NAME;
      superUser.password = hashedPassword;
      superUser.role = 'admin';
      superUser.status = 'active';

      await superUser.save();

      console.log('✔ Superuser actualizado:', superUser.email);
      return;
    }

    // 2) Si no hay superuser pero sí existe el email, promoverlo
    const userByEmail = await User.findOne({ email: SUPER_EMAIL });

    if (userByEmail) {
      userByEmail.isSuperUser = true;
      userByEmail.role = 'admin';
      userByEmail.status = 'active';
      userByEmail.password = hashedPassword;

      await userByEmail.save();
      console.log('🔥 Usuario existente promovido a superuser:', userByEmail.email);
      return;
    }

    // 3) Crear un superuser nuevo
    superUser = await User.create({
      email: SUPER_EMAIL,
      name: SUPER_NAME,
      password: hashedPassword,
      role: 'admin',
      isSuperUser: true,
      status: 'active',
    });

    console.log('🔥 Superuser creado automáticamente:', superUser.email);
  } catch (err) {
    console.error('❌ Error en ensureSuperUser:', err);
  }
}

module.exports = ensureSuperUser;
