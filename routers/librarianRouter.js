const express = require('express');
const router = express.Router();
const librarianController = require('../controllers/librarianController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const librarianOnly = [requireAuth, requireRole('librarian')];

router.get('/librarian', ...librarianOnly, librarianController.getLibrarianDashboard);
router.get('/librarian/books', ...librarianOnly, librarianController.getLibrarianBooks);
router.post('/librarian/books', ...librarianOnly, librarianController.postAddBook);
router.post('/librarian/books/:id/edit', ...librarianOnly, librarianController.postEditBook);
router.post('/librarian/books/:id/delete', ...librarianOnly, librarianController.postDeleteBook);

router.post('/librarian/lending/issue', ...librarianOnly, librarianController.postIssueBookForStudent);
router.post('/librarian/lending/return', ...librarianOnly, librarianController.postReturnBookForLibrarian);

router.post('/librarian/requests/:id/approve', ...librarianOnly, librarianController.postApproveBookRequest);
router.post('/librarian/requests/:id/reject', ...librarianOnly, librarianController.postRejectBookRequest);

router.post('/librarian/students/:id/toggle', ...librarianOnly, librarianController.postToggleStudent);
router.post('/librarian/settings/password', ...librarianOnly, librarianController.postChangeLibrarianPassword);

module.exports = router;
