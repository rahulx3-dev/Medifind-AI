const express = require('express');
const router = express.Router();
const { register, login, getMe, oauthAuth } = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/oauth', oauthAuth);
router.get('/me', authenticateToken, getMe);

module.exports = router;

