const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/authController');
const { requireAuth, requireRole } = require('../Middlewares/auth');

router.post('/register', requireAuth, requireRole('admin'), ctrl.register);

router.post('/login', ctrl.login);

router.get('/me', requireAuth, ctrl.me);

router.get('/users', requireAuth, requireRole('admin'), ctrl.listUsers);

module.exports = router;
