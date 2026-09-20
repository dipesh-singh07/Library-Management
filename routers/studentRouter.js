const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

// Student dashboard route (Strict server-side student authorization)
router.get('/student', requireAuth, requireRole('student'), studentController.getStudentDashboard);
router.get('/student/profile', requireAuth, requireRole('student'), studentController.getStudentProfile);
router.post('/student/profile', requireAuth, requireRole('student'), studentController.postUpdateStudentProfile);
router.get('/student/books', requireAuth, requireRole('student'), studentController.getStudentBooks);
router.get('/student/books/:id', requireAuth, requireRole('student'), studentController.getStudentBookDetails);

// Book request route
router.post('/student/request-book', requireAuth, requireRole('student'), studentController.postBookRequest);

// Students can view their loans, but only librarians process returns and fines.
router.post('/student/renew-book', requireAuth, requireRole('student'), studentController.postRenewBook);

// Librarian-only condition handling
router.post('/librarian/mark-lost', requireAuth, requireRole('librarian'), studentController.postMarkLost);
router.post('/librarian/mark-damaged', requireAuth, requireRole('librarian'), studentController.postMarkDamaged);

module.exports = router;
