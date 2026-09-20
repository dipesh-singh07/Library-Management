const jwt = require('jsonwebtoken');

// Middleware to check for JWT cookie and set req.user
const authenticate = (req, res, next) => {
    const token = req.cookies && req.cookies.token;

    if (!token) {
        req.user = null;
        res.locals.user = null;
        return next();
    }

    try {
        const decodedUser = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decodedUser;
        res.locals.user = decodedUser;
        next();
    } catch (error) {
        req.user = null;
        res.locals.user = null;
        next();
    }
};

// Middleware to ensure user is logged in
const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.redirect('/login');
    }
    next();
};

// Middleware for role-based authorization (e.g. requireRole('librarian'))
const requireRole = (role) => {
    return (req, res, next) => {
        // If not logged in, redirect to login
        if (!req.user) {
            return res.redirect('/login');
        }

        // If role doesn't match, return 403 Forbidden
        if (req.user.role !== role) {
            return res.status(403).send('403 Forbidden: Access denied');
        }

        next();
    };
};

module.exports = {
    authenticate,
    requireAuth,
    requireRole
};
