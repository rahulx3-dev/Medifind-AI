const express = require('express');
const router = express.Router();
const {
  getAvailableTasks,
  getMyTasks,
  acceptTask,
  progressTaskStatus,
  getAssistantProfile,
  updateAssistantProfile,
  discoverAssistants
} = require('../controllers/assistantController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// Public/Patient discovery of active and available assistants by service capability
router.get('/discover', authenticateToken, discoverAssistants);
router.get('/assistants', authenticateToken, discoverAssistants);

router.get('/profile', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), getAssistantProfile);
router.put('/profile', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), updateAssistantProfile);
router.get('/available', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), getAvailableTasks);
router.get('/my-tasks', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), getMyTasks);
router.put('/tasks/:id/accept', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), acceptTask);
router.put('/tasks/:id/progress', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), progressTaskStatus);

module.exports = router;

