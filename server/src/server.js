const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Deterministically load server/.env relative to this file, regardless of process.cwd()
const serverEnvPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: serverEnvPath });

const authRoutes = require('./routes/authRoutes');
const medicineRoutes = require('./routes/medicineRoutes');
const pharmacyRoutes = require('./routes/pharmacyRoutes');
const prescriptionRoutes = require('./routes/prescriptionRoutes');
const orderRoutes = require('./routes/orderRoutes');
const assistantRoutes = require('./routes/assistantRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const addressRoutes = require('./routes/addressRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const clinicalAssistanceRoutes = require('./routes/clinicalAssistanceRoutes');
const { getPaymentConfigStatus } = require('./utils/paymentConfig');
const { startClinicalTimeoutWorker } = require('./utils/clinicalTimeoutWorker');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// NOTE: /uploads is NOT served as public static to protect sensitive prescription images.
// Prescription images are served through GET /api/prescriptions/:id/image (authenticated).

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'MediFind AI Core Server',
    version: '1.0.0-academic',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/pharmacies', pharmacyRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/clinical-assistance', clinicalAssistanceRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// Process-level safety guards to prevent background thread terminations
process.on('uncaughtException', (err) => {
  console.error('Process uncaughtException captured safely:', err.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Process unhandledRejection captured safely:', reason);
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint ${req.method} ${req.originalUrl} not found.`
  });
});

app.listen(PORT, () => {
  const paymentStatus = getPaymentConfigStatus();
  console.log(`====================================================`);
  console.log(`🏥 MediFind AI Backend API is running on port ${PORT}`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🕒 Started at: ${new Date().toLocaleString()}`);
  console.log(`💳 Razorpay configuration:`);
  console.log(`   - KEY_ID present: ${paymentStatus.keyIdPresent}`);
  console.log(`   - KEY_SECRET present: ${paymentStatus.keySecretPresent}`);
  console.log(`   - TEST MODE key: ${paymentStatus.isTestMode}`);
  console.log(`   - Configured: ${paymentStatus.isConfigured}`);
  console.log(`====================================================`);
  
  // Start the Gate 8 Clinical Assistance timeout escalation background worker
  startClinicalTimeoutWorker();
});

module.exports = app;
// Server reloaded with IPv4 direct routing
