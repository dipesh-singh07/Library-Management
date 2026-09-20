const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// GET /register - Render registration page
const getRegister = (req, res) => {
    // If user is already logged in, redirect to home
    if (req.user) {
        return res.redirect('/');
    }
    res.render('register', { error: null, formData: {} });
};

// POST /register - Handle user registration
const postRegister = async (req, res) => {
    try {
        const { name, email, password, accountType, librarianKey } = req.body;

        // 1. Validate required fields
        if (!name || !email || !password || !accountType) {
            return res.render('register', {
                error: 'All fields are required.',
                formData: { name, email, accountType }
            });
        }

        // 2. Validate account type
        if (accountType !== 'student' && accountType !== 'librarian') {
            return res.render('register', {
                error: 'Invalid account type.',
                formData: { name, email, accountType }
            });
        }

        // 3. Check whether the email already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.render('register', {
                error: 'Email already exists.',
                formData: { name, email, accountType }
            });
        }

        // 4. Determine role based on account type and verify Librarian Key on server
        let role = 'student';

        if (accountType === 'librarian') {
            // Check Librarian Key against process.env.LIBRARIAN_KEY
            if (!librarianKey || librarianKey !== process.env.LIBRARIAN_KEY) {
                return res.render('register', {
                    error: 'Invalid librarian key.',
                    formData: { name, email, accountType }
                });
            }
            role = 'librarian';
        }

        // 5. Hash password using bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);

        // 6. Create the user in MongoDB
        await User.create({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: role
        });

        // 7. Redirect to /login after successful registration
        res.redirect('/login');
    } catch (error) {
        console.error('Registration error:', error);
        res.render('register', {
            error: 'An error occurred during registration. Please try again.',
            formData: req.body || {}
        });
    }
};

// GET /login - Render login page
const getLogin = (req, res) => {
    // If user is already logged in, redirect to home
    if (req.user) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
};

// POST /login - Handle user login
const postLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Validate input
        if (!email || !password) {
            return res.render('login', { error: 'All fields are required.' });
        }

        // 2. Find user by email
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            return res.render('login', { error: 'Invalid email or password.' });
        }

        if (user.isActive === false) {
            return res.render('login', { error: 'This account is inactive. Please contact the librarian.' });
        }

        // 3. Compare password with bcrypt
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid email or password.' });
        }

        // 4. Create JWT
        const token = jwt.sign(
            {
                id: user._id,
                name: user.name,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        // 5. Store JWT inside HTTP-only cookie
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });

        // 6. Redirect to home
        res.redirect('/');
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An error occurred during login. Please try again.' });
    }
};

// GET /logout - Clear cookie and redirect
const logout = (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
};

// GET / - Render home page
const getHome = async (req, res) => {
    let user = req.user;
    if (user && !user.name) {
        const dbUser = await User.findById(user.id);
        if (dbUser) {
            user = { id: dbUser._id, name: dbUser.name, role: dbUser.role };
        }
    }
    res.render('home', { user });
};

// GET /librarian - Test authorization route for librarians only
const getLibrarianTest = (req, res) => {
    res.send('Welcome Librarian');
};

// GET /student - Test authorization route for students only
const getStudentTest = (req, res) => {
    res.send('Welcome Student');
};

module.exports = {
    getRegister,
    postRegister,
    getLogin,
    postLogin,
    logout,
    getHome,
    getLibrarianTest,
    getStudentTest
};
