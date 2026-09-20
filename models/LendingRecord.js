const mongoose = require('mongoose');

const lendingRecordSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    book: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
        required: true
    },
    issueDate: {
        type: Date,
        default: Date.now,
        required: true
    },
    dueDate: {
        type: Date,
        required: true
    },
    returnDate: {
        type: Date,
        default: null
    },
    overdueDays: {
        type: Number,
        default: 0,
        min: 0
    },
    fine: {
        type: Number,
        default: null,
        min: 0
    },
    suggestedFine: {
        type: Number,
        default: null,
        min: 0
    },
    fineType: {
        type: String,
        enum: ['none', 'late', 'damaged', 'lost', 'other', null],
        default: null
    },
    renewalCount: {
        type: Number,
        default: 0,
        min: 0
    },
    previousDueDate: {
        type: Date,
        default: null
    },
    lostDate: {
        type: Date,
        default: null
    },
    lostFine: {
        type: Number,
        default: null,
        min: 0
    },
    damageLevel: {
        type: String,
        enum: ['MINOR', 'MODERATE', 'SEVERE', null],
        default: null
    },
    damageDate: {
        type: Date,
        default: null
    },
    damageFine: {
        type: Number,
        default: null,
        min: 0
    },
    status: {
        type: String,
        enum: ['issued', 'returned', 'lost', 'damaged'],
        default: 'issued',
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('LendingRecord', lendingRecordSchema);
