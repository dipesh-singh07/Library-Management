const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/db');
const { authenticate } = require('./middleware/authMiddleware');
const authRouter = require('./routers/authRouter');
const studentRouter = require('./routers/studentRouter');
const librarianRouter = require('./routers/librarianRouter');

// Connect to MongoDB
connectDB();

// Create Express app
const app = express();

// Middleware for parsing URL-encoded bodies and JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Middleware for parsing cookies
app.use(cookieParser());

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Set EJS as the template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Global authentication middleware to decode JWT cookie and set req.user
app.use(authenticate);

// Use authentication and authorization routes
app.use('/', authRouter);
app.use('/', studentRouter);
app.use('/', librarianRouter);

app.use((error, req, res, next) => {
  console.error('Unhandled server error:', error);
  if (res.headersSent) return next(error);
  return res.status(500).render('error', {
    title: 'Something went wrong',
    message: 'Something went wrong. Please try again.'
  });
});

// Start the server
// Determine port with fallback and handle EADDRINUSE error
let PORT = parseInt(process.env.PORT, 10) || 5000;
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying next port...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}
startServer(PORT);

