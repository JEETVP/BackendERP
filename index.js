require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

// ====== Crear app ======
const app = express();

// ====== Middlewares base ======
app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// CORS ABIERTO (permite todo). Incluye credenciales por si las usas con cookies.
// Para PROD ajusta origin con lista blanca.
app.use(
  cors({
    origin: true,         // refleja el origin que haga la petición
    credentials: true,    // permite cookies/autenticación cruzada si la usas
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
    exposedHeaders: ['Content-Length','X-Request-Id'],
  })
);
// ====== Rutas públicas mínimas ======
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'ERP API', version: '1.0.0' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy', ts: new Date().toISOString() });
});

// ====== Rutas API (protegidas por sus propios middlewares) ======
const authRoutes = require('./Routes/authRoutes');
const hospitalRoutes = require('./Routes/hospitalRoutes');
const medicationRoutes = require('./Routes/medicationRoutes');
const supplierRoutes = require('./Routes/supplierRoutes');
const inventoryTxRoutes = require('./Routes/inventoryTransactionRoutes');
const purchaseOrderRoutes = require('./Routes/purchaseOrderRoutes');
const notificationRoutes = require('./Routes/notificationRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/inventory-transactions', inventoryTxRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/notifications', notificationRoutes);

// ====== 404 handler ======
app.use((req, res, _next) => {
  res.status(404).json({ ok: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ====== Error handler (centralizado) ======
/* eslint-disable no-unused-vars */
app.use((err, _req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  const msg = err.message || 'Internal Server Error';
  // Log básico (en prod puedes integrar con un logger)
  if (process.env.NODE_ENV !== 'test') {
    console.error('❌ Error:', { status, msg, stack: err.stack });
  }
  res.status(status).json({ ok: false, message: msg });
});
/* eslint-enable no-unused-vars */

// ====== Conexión a MongoDB y arranque ======
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Missing MONGO_URI env var');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = app;
