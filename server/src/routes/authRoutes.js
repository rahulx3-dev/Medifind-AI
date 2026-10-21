const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  oauthAuth,
  checkUserAvailability,
  sendOtp,
  verifyOtp,
  phoneLogin,
  updateProfile
} = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/oauth', oauthAuth);
router.get('/check-user', checkUserAvailability);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/phone-login', phoneLogin);
router.get('/me', authenticateToken, getMe);
router.put('/profile', authenticateToken, updateProfile);

module.exports = router;


