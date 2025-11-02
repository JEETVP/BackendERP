const jwt = require('jsonwebtoken');

exports.requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'Missing token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, role, isSuperUser }
    next();
  } catch {
    return res.status(401).json({ ok: false, message: 'Invalid token' });
  }
};

exports.requireRole = (...roles) => (req, res, next) => {
  if (req.user?.isSuperUser) return next();
  if (!req.user || !roles.includes(req.user.role))
    return res.status(403).json({ ok: false, message: 'Forbidden' });
  next();
};
