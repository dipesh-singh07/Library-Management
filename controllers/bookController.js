// controllers/bookController.js
const Book = require('../models/Book');

/**
 * GET /books
 * List books with pagination, search, and filter.
 * Query params:
 *   page - page number (default 1)
 *   limit - page size (default 10)
 *   q - search keyword (matches title, author, category, isbn)
 *   status - filter by status (available, issued, etc.)
 */
const listBooks = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const skip = (page - 1) * limit;
    const { q, status } = req.query;
    const filter = {};
    if (q) {
      const regex = new RegExp(q, 'i');
      filter.$or = [
        { title: regex },
        { author: regex },
        { category: regex },
        { isbn: regex }
      ];
    }
    if (status) {
      filter.status = status;
    }
    const [books, total] = await Promise.all([
      Book.find(filter).skip(skip).limit(limit).sort({ title: 1 }),
      Book.countDocuments(filter)
    ]);
    res.render('books', {
      user: req.user,
      books,
      pagination: { page, limit, total }
    });
  } catch (err) {
    console.error('Error listing books:', err);
    res.status(500).send('Server error');
  }
};

/**
 * GET /books/:id
 * Show detailed information for a single book.
 */
const getBookDetails = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).send('Book not found');
    res.render('bookDetails', { user: req.user, book });
  } catch (err) {
    console.error('Error fetching book:', err);
    res.status(500).send('Server error');
  }
};

/**
 * POST /books
 * Librarian adds a new book.
 */
const addBook = async (req, res) => {
  try {
    const { title, author, category, isbn, totalCopies, availableCopies, status, expectedDate } = req.body;
    const book = new Book({
      title,
      author,
      category,
      isbn,
      totalCopies: totalCopies || 1,
      availableCopies: availableCopies || totalCopies || 1,
      status: status || 'Available',
      expectedDate
    });
    await book.save();
    res.redirect('/books');
  } catch (err) {
    console.error('Error adding book:', err);
    res.status(500).send('Server error');
  }
};

/**
 * PUT /books/:id
 * Librarian updates a book.
 */
const updateBook = async (req, res) => {
  try {
    const { title, author, category, isbn, totalCopies, availableCopies, status, expectedDate } = req.body;
    await Book.findByIdAndUpdate(req.params.id, {
      title,
      author,
      category,
      isbn,
      totalCopies,
      availableCopies,
      status,
      expectedDate
    });
    res.redirect('/books');
  } catch (err) {
    console.error('Error updating book:', err);
    res.status(500).send('Server error');
  }
};

/**
 * DELETE /books/:id
 * Librarian removes a book.
 */
const deleteBook = async (req, res) => {
  try {
    await Book.findByIdAndDelete(req.params.id);
    res.redirect('/books');
  } catch (err) {
    console.error('Error deleting book:', err);
    res.status(500).send('Server error');
  }
};

module.exports = {
  listBooks,
  getBookDetails,
  addBook,
  updateBook,
  deleteBook
};
