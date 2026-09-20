const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    author: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        trim: true
    },
    isbn: {
        type: String,
        trim: true,
        default: ''
    },
    image: {
        type: String,
        trim: true,
        default: ''
    },
    publisher: {
        type: String,
        trim: true,
        default: ''
    },
    edition: {
        type: String,
        trim: true,
        default: ''
    },
    language: {
        type: String,
        trim: true,
        default: ''
    },
    totalCopies: {
        type: Number,
        required: true,
        min: 0,
        default: 1
    },
    availableCopies: {
        type: Number,
        required: true,
        min: 0,
        default: 1
    },
    issuedCopies: {
        type: Number,
        default: 0,
        min: 0
    },
    bookValue: {
        type: Number,
        min: 0,
        default: null
    },
    location: {
        building: { type: String, default: 'Main Wing' },
        floor: { type: String, default: 'Floor 1' },
        shelf: { type: String, default: 'Shelf A-1' }
    },
    series: {
        type: String,
        trim: true,
        default: ''
    },
    readingOrder: {
        type: Number,
        default: null
    },
    description: {
        type: String,
        trim: true,
        default: ''
    }
}, {
    timestamps: true
});

bookSchema.pre('validate', function normalizeCopyCounts(next) {
    const totalCopies = Number(this.totalCopies);
    const issuedCopies = Number(this.issuedCopies);
    const availableCopies = Number(this.availableCopies);

    if (![totalCopies, issuedCopies, availableCopies].every(Number.isInteger)) {
        return next(new mongoose.Error.ValidationError(this));
    }

    if (totalCopies < 0 || issuedCopies < 0 || availableCopies < 0 ||
        issuedCopies > totalCopies || availableCopies > totalCopies ||
        availableCopies + issuedCopies !== totalCopies) {
        return next(new mongoose.Error.ValidationError(this));
    }

    next();
});

module.exports = mongoose.model('Book', bookSchema);
