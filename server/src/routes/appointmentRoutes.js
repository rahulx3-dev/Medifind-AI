const express = require('express');
const router = express.Router();
const {
  getMarketplaceServices,
  discoverProfessionals,
  getProfessionalAvailability,
  createAppointment,
  getPatientAppointments,
  getProfessionalAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  updateProfessionalSchedule,
  getAdminAppointments
} = require('../controllers/appointmentController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// 1. Healthcare Services Catalogue (Public / Authenticated)
router.get('/services', getMarketplaceServices);

// 2. Discover Approved Eligible Healthcare Professionals (Authenticated)
router.get('/marketplace', authenticateToken, discoverProfessionals);

// 3. Real Professional Availability & Slot Generation (Authenticated)
router.get('/availability/:professionalId', authenticateToken, getProfessionalAvailability);

// 4. Request Appointment (Patients only)
router.post('/', authenticateToken, createAppointment);

// 5. Patient Appointment List & History
router.get('/patient', authenticateToken, getPatientAppointments);

// 6. Professional Appointment List & Workspace
router.get('/professional', authenticateToken, getProfessionalAppointments);

// 7. Professional Schedule Management
router.put('/professional/schedule', authenticateToken, updateProfessionalSchedule);

// 8. Admin Overview of All Clinical Bookings
router.get('/admin/all', authenticateToken, requireRole('ADMIN'), getAdminAppointments);

// 9. Single Appointment Details (Strict Ownership / Address Privacy)
router.get('/:id', authenticateToken, getAppointmentById);

// 10. Appointment Lifecycle Status Progression
router.patch('/:id/status', authenticateToken, updateAppointmentStatus);

module.exports = router;
