const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

// Home page
router.get('/', authController.getHome);

// Registration routes
router.get('/register', authController.getRegister);
router.post('/register', authController.postRegister);

// Login routes
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);

// Logout route
router.get('/logout', authController.logout);

// Protected test authorization routes


module.exports = router;
