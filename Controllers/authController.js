const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../Models/User');

const signToken = (user) =>
  jwt.sign(
    { id: user._id, role: user.role, isSuperUser: user.isSuperUser },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

// POST /api/auth/register  (solo superuser o admin crea usuarios)
exports.register = async (req, res, next) => {
  try {
    const { email, name, password, role = 'clerk', isSuperUser = false, hospital } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ ok: false, message: 'email, name y password son requeridos' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ ok: false, message: 'Email ya registrado' });

    const hash = await bcrypt.hash(password, 12);

    const user = await User.create({
      email,
      name,
      password: hash,
      role,
      isSuperUser: !!isSuperUser,
      hospital: hospital || undefined,
      createdBy: req.user?.id,
    });

    const token = signToken(user);
    return res.status(201).json({ ok: true, data: { user: user.toSafeObject(), token } });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ ok: false, message: 'email y password son requeridos' });

    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(400).json({ ok: false, message: 'Credenciales inválidas' });

    // cuenta bloqueada?
    if (user.status === 'blocked')
      return res.status(403).json({ ok: false, message: 'Cuenta bloqueada' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      await User.findByIdAndUpdate(user._id, { $inc: { failedLoginCount: 1 } });
      return res.status(400).json({ ok: false, message: 'Credenciales inválidas' });
    }

    await User.findByIdAndUpdate(user._id, {
      failedLoginCount: 0,
      lastLoginAt: new Date(),
    });

    const token = signToken(user);
    return res.json({ ok: true, data: { user: user.toSafeObject(), token } });
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
  res.json({ ok: true, data: user.toSafeObject() });
};

exports.listUsers = async (req, res, next) => {
  try {
    const filter = {};
    if (!req.user.isSuperUser && req.user.role !== 'admin') {
      if (req.user.hospital) filter.hospital = req.user.hospital;
    }
    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json({ ok: true, data: users.map(u => u.toSafeObject()) });
  } catch (err) {
    next(err);
  }
};