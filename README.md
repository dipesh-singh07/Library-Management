# Library Management System

A full-stack library management application built with Node.js, Express, MongoDB, and EJS. It supports separate student and librarian experiences, book lending workflows, authorization, fine tracking, request approvals, and a catalog dashboard.

## Overview

This project helps manage a digital library for educational institutions. Students can browse books, request titles, renew loans, and view their profile and records, while librarians can issue/return books, approve requests, manage catalog entries, monitor overdue items, and handle fines.

## Features

- Student registration and login with JWT-based authentication
- Librarian registration with a secret key validation
- Role-based access control for protected routes
- Book catalog browsing and details view
- Book request workflow for students
- Lending and return process managed by librarians
- Overdue tracking and late fine calculation
- Damage and lost item penalty handling
- Student profile management
- Librarian dashboard with stats and operational views
- Search, filtering, and category-based book listing
- Seed data support for initial catalog population

## Tech Stack

- Node.js
- Express.js
- MongoDB with Mongoose
- EJS for server-rendered views
- JWT for session authentication
- bcrypt for password hashing
- dotenv for environment configuration

## Project Structure

```text
libraryMangement/
├── config/
│   └── db.js
├── controllers/
│   ├── authController.js
│   ├── bookController.js
│   ├── librarianController.js
│   └── studentController.js
├── middleware/
│   └── authMiddleware.js
├── models/
│   ├── Book.js
│   ├── BookRequest.js
│   ├── LendingRecord.js
│   └── User.js
├── public/
│   ├── css/
│   └── images/
├── routers/
│   ├── authRouter.js
│   ├── librarianRouter.js
│   └── studentRouter.js
├── seeds/
│   └── seedBooks.js
├── services/
│   ├── bookCoverService.js
│   └── bookDiscoveryService.js
├── views/
│   ├── error.ejs
│   ├── home.ejs
│   ├── librarian.ejs
│   ├── login.ejs
│   ├── register.ejs
│   ├── student-book-details.ejs
│   ├── student-books.ejs
│   ├── student-profile.ejs
│   └── student.ejs
├── .env.example (create this locally)
├── package.json
├── server.js
└── README.md
```

## Prerequisites

Before running the project, ensure you have:

- Node.js 18+ recommended
- MongoDB instance running locally or remotely
- Access to a terminal

## Environment Variables

Create a `.env` file in the project root with the following variables:

```env
MONGO_URI=mongodb://127.0.0.1:27017/library-management
JWT_SECRET=your_super_secret_jwt_key
LIBRARIAN_KEY=your_librarian_registration_key
PORT=5000
```

Notes:

- `MONGO_URI` should point to your MongoDB database.
- `JWT_SECRET` is used to sign authentication tokens.
- `LIBRARIAN_KEY` is required when registering a librarian account.
- `PORT` is optional; the app falls back to `5000` if it is not set.

## Installation

```bash
npm install
```

## Running the App

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

The app will run on the configured port, typically:

```text
http://localhost:5000
```

## Seeding Sample Data

To populate the database with sample books:

```bash
npm run seed
```

## Default Flow

1. Register a student or librarian account.
2. For librarian registration, enter the correct `LIBRARIAN_KEY`.
3. Log in with your account credentials.
4. Based on your role, use the dashboard to manage books, requests, loans, or profile details.

## User Roles

### Student

Students can:

- log in to the student dashboard
- view available books
- request a book
- renew borrowed books
- review their profile and borrowing activity

### Librarian

Librarians can:

- issue and return books
- approve or reject book requests
- manage the inventory
- monitor overdue items and fine records
- toggle student account status
- change librarian password settings

## Routes Overview

Key routes include:

- `/register` – user registration
- `/login` – login page
- `/logout` – logout
- `/student` – student dashboard
- `/student/books` – student catalog
- `/student/profile` – profile management
- `/librarian` – librarian dashboard
- `/librarian/books` – manage book inventory
- `/librarian/lending/issue` – issue a book
- `/librarian/lending/return` – return a book

## Notes

- The project uses server-side rendering with EJS instead of a frontend framework.
- Authentication is cookie-based and uses JWT stored in an HTTP-only cookie.
- The app expects MongoDB connectivity at startup; without a valid `MONGO_URI`, the server will fail to connect.

## License

This project is licensed under the ISC license.

## Contributing

Contributions are welcome. If you want to improve the project, open a pull request with a clear description of the change and test the affected flow locally before submitting.

