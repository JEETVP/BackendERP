// seeders/seedSuperUser.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../Models/User');

// Puedes controlar estos datos por variables de entorno
const SUPER_EMAIL = process.env.SUPERUSER_EMAIL || 'jip@gmail.com';
const SUPER_PASSWORD = process.env.SUPERUSER_PASSWORD || 'eljipititch';
const SUPER_NAME = process.env.SUPERUSER_NAME || 'Root Admin';

async function seedSuperUser() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('❌ Falta la variable de entorno MONGO_URI');
    }

    console.log('⏳ Conectando a la base de datos...');
    await mongoose.connect(process.env.MONGO_URI);

    // 1) ¿Ya existe algún superusuario?
    let existingSuper = await User.findOne({ isSuperUser: true });

    if (existingSuper) {
      console.log('⚠️ Ya existe un superusuario:', existingSuper.email);
      return process.exit(0);
    }

    // 2) ¿Existe un usuario con el correo del superusuario?
    let userByEmail = await User.findOne({ email: SUPER_EMAIL });

    if (userByEmail) {
      // Promovemos ese usuario a superusuario
      userByEmail.isSuperUser = true;
      userByEmail.role = 'admin';     // uno de los ROLES ['admin', 'manager', 'clerk']
      userByEmail.status = 'active';  // no bloqueado
      await userByEmail.save();

      console.log('✅ Usuario existente promovido a superusuario:', userByEmail.email);
      return process.exit(0);
    }

    // 3) Crear un superusuario nuevo
    const hashedPassword = await bcrypt.hash(SUPER_PASSWORD, 12);

    const superUser = await User.create({
      email: SUPER_EMAIL,
      name: SUPER_NAME,
      password: hashedPassword,
      role: 'admin',      // válido según tu enum ROLES
      isSuperUser: true,
      status: 'active',
      // hospital: puedes dejarlo null o asignar uno si ya tienes un Hospital creado
      // createdBy: null,  // se puede omitir, Mongo lo acepta
    });

    console.log('✅ Superusuario creado correctamente:', superUser.email);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error al crear el superusuario:');
    console.error(err);
    process.exit(1);
  }
}

seedSuperUser();
