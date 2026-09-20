const mongoose = require('mongoose');

/**
 * BookRequest schema
 *
 * Two modes:
 *  1. Student requests a book that IS in the library catalogue → `book` is populated
 *  2. Student requests a title NOT in the catalogue → `book` is null, `title` holds the free-text name
 *
 * `title` is always set and used for display.
 * `studentName` is denormalised for quick display without a populate().
 */
const bookRequestSchema = new mongoose.Schema({
    // Reference to the student who made the request
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Denormalised student name – captured at request time for display
    studentName: {
        type: String,
        required: true,
        trim: true
    },

    // Optional reference to a catalogue book
    book: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
        default: null
    },

    // Book title – always required (free-text when book ref is absent)
    title: {
        type: String,
        required: true,
        trim: true
    },

    // Optional author name
    author: {
        type: String,
        trim: true,
        default: ''
    },

    // Optional message from the student
    message: {
        type: String,
        trim: true,
        default: ''
    },

    // Date when the request was submitted
    requestDate: {
        type: Date,
        default: Date.now
    },

    // Lifecycle status
    status: {
        type: String,
        enum: ['pending', 'approved', 'issued', 'returned', 'rejected', 'cancelled'],
        default: 'pending'
    },

    // Reason provided by the librarian when rejecting
    rejectionReason: {
        type: String,
        trim: true,
        default: ''
    },

    // Expected availability date surfaced to students when book is unavailable
    expectedAvailability: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('BookRequest', bookRequestSchema);
