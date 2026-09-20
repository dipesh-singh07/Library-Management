const mongoose = require('mongoose');

// User Schema definition
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    phone: { type: String, trim: true, default: '' },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, trim: true, default: '' },
    profileImage: { type: String, trim: true, default: '' },
    college: { type: String, trim: true, default: '' },
    course: { type: String, trim: true, default: '' },
    branch: { type: String, trim: true, default: '' },
    year: { type: String, trim: true, default: '' },
    semester: { type: String, trim: true, default: '' },
    studentId: { type: String, trim: true, default: '' },
    admissionYear: { type: Number, min: 1900, max: 2200, default: null },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    pincode: { type: String, trim: true, default: '' },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['student', 'librarian'],
        default: 'student'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
