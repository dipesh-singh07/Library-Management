const mongoose = require('mongoose');
const Book = require('../models/Book');
const User = require('../models/User');
const LendingRecord = require('../models/LendingRecord');
const BookRequest = require('../models/BookRequest');
const bcrypt = require('bcrypt');

const BORROWING_PERIOD_DAYS = 14;
const LATE_FINE_BASE = 50;
const LATE_FINE_DAILY = 5;

function startOfDay(date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
}

function calculateLateFine(dueDate, returnDate = new Date()) {
    const days = Math.max(
        0,
        Math.floor(
            (startOfDay(returnDate) - startOfDay(dueDate)) / 86400000
        )
    );

    return {
        overdueDays: days,
        fine: days > 0 ? LATE_FINE_BASE + (days * LATE_FINE_DAILY) : 0
    };
}

function calculateCurrentFine(loan, now = new Date()) {
    if (!loan) return 0;

    if (loan.status === 'lost') {
        return Number(loan.lostFine) || 0;
    }

    if (loan.status === 'damaged') {
        return Number(loan.damageFine) || 0;
    }

    if (loan.status === 'returned') {
        return Number(loan.fine) || 0;
    }

    return calculateLateFine(loan.dueDate, now).fine;
}

function addCalendarDays(date, days) {
    const value = new Date(date);
    value.setDate(value.getDate() + days);
    return value;
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateIssuedCopies(book = {}) {
    const totalCopies = Number(book.totalCopies) || 0;
    const availableCopies = Number(book.availableCopies) || 0;

    return Math.max(0, totalCopies - availableCopies);
}

function buildBookFormData(rawData = {}, existingBook = {}) {
    const formData = {
        title: String(rawData.title || existingBook.title || '').trim(),
        author: String(rawData.author || existingBook.author || '').trim(),
        category: String(rawData.category || existingBook.category || '').trim(),
        isbn: String(
            rawData.isbn !== undefined
                ? rawData.isbn
                : (existingBook.isbn || '')
        ).trim(),

        image: String(
            rawData.image !== undefined
                ? rawData.image
                : (existingBook.image || '')
        ).trim(),

        publisher: String(
            rawData.publisher !== undefined
                ? rawData.publisher
                : (existingBook.publisher || '')
        ).trim(),

        edition: String(
            rawData.edition !== undefined
                ? rawData.edition
                : (existingBook.edition || '')
        ).trim(),

        language: String(
            rawData.language !== undefined
                ? rawData.language
                : (existingBook.language || '')
        ).trim(),

        description: String(
            rawData.description !== undefined
                ? rawData.description
                : (existingBook.description || '')
        ).trim(),

        bookValue:
            rawData.bookValue !== undefined
                ? rawData.bookValue
                : (existingBook.bookValue ?? ''),

        totalCopies:
            rawData.totalCopies !== undefined
                ? rawData.totalCopies
                : (existingBook.totalCopies ?? ''),

        building: String(
            rawData.building !== undefined
                ? rawData.building
                : (
                    existingBook.location &&
                    existingBook.location.building
                        ? existingBook.location.building
                        : ''
                )
        ).trim(),

        floor: String(
            rawData.floor !== undefined
                ? rawData.floor
                : (
                    existingBook.location &&
                    existingBook.location.floor
                        ? existingBook.location.floor
                        : ''
                )
        ).trim(),

        shelf: String(
            rawData.shelf !== undefined
                ? rawData.shelf
                : (
                    existingBook.location &&
                    existingBook.location.shelf
                        ? existingBook.location.shelf
                        : ''
                )
        ).trim()
    };

    return formData;
}

function buildBookQuery(query = {}) {
    const filter = {};

    const search = String(query.search || '').trim();
    const category = String(query.category || '').trim();
    const availability = String(
        query.availability || 'all'
    ).toLowerCase();

    if (search) {
        const expression = new RegExp(escapeRegex(search), 'i');

        filter.$or = [
            { title: expression },
            { author: expression },
            { isbn: expression },
            { category: expression }
        ];
    }

    if (category) {
        filter.category = category;
    }

    if (availability === 'available') {
        filter.availableCopies = { $gt: 0 };
    }

    if (availability === 'out') {
        filter.availableCopies = 0;
    }

    return filter;
}

function getBookSort(sort) {
    return {
        titleAsc: { title: 1 },
        titleDesc: { title: -1 },
        oldest: { createdAt: 1 },
        newest: { createdAt: -1 }
    }[sort] || { createdAt: -1 };
}

function renderDashboard(res, data = {}) {
    return res.render('librarian', {
        librarian: {
            name: data.librarianName || 'Librarian'
        },

        error: data.error || '',
        success: data.success || '',
        formData: data.formData || {},

        booksPage: Boolean(data.booksPage),
        books: data.books || [],
        bookFilters: data.bookFilters || {},
        bookCategories: data.bookCategories || [],

        bookPagination:
            data.bookPagination || {
                page: 1,
                totalPages: 1,
                total: 0
            },

        dashboardStats:
            data.dashboardStats || {
                totalBooks: 0,
                totalCopies: 0,
                availableCopies: 0,
                currentlyIssued: 0,
                overdueBooks: 0,
                registeredStudents: 0,
                pendingRequests: 0,
                outstandingFines: 0
            },

        students: data.students || [],
        studentSearch: data.studentSearch || '',
        activeLoans: data.activeLoans || [],
        pendingRequests: data.pendingRequests || [],
        requestHistory: data.requestHistory || [],
        fineRecords: data.fineRecords || [],

        // FIX:
        // Make calculateCurrentFine available inside librarian.ejs
        calculateCurrentFine,
        calculateLateFine,

        report:
            data.report || {
                categories: [],
                circulation: [],
                topBooks: []
            },

        qrBooks: data.qrBooks || [],
        selectedQrBook: data.selectedQrBook || null,

        moduleSuccess: data.moduleSuccess || '',
        moduleError: data.moduleError || '',
        settingsMessage: data.settingsMessage || '',

        editBook: data.editBook || null
    });
}

const getLibrarianDashboard = async (req, res) => {
    try {
        const studentSearch = String(
            req.query.studentSearch || ''
        ).trim();

        const studentFilter = {
            role: 'student'
        };

        if (studentSearch) {
            const expression = new RegExp(
                escapeRegex(studentSearch),
                'i'
            );

            studentFilter.$or = [
                { name: expression },
                { email: expression }
            ];
        }

        const [
            bookStats,
            registeredStudents,
            overdueBooks,
            pendingRequestsCount,
            approvedRequestsCount,
            students,
            activeLoans,
            pendingRequests,
            fineRecords,
            categories,
            circulation,
            topBooks,
            recentLoans,
            recentRequests
        ] = await Promise.all([
            Book.aggregate([
                {
                    $group: {
                        _id: null,
                        totalBooks: { $sum: 1 },
                        availableBooks: { $sum: { $cond: [{ $gt: ['$availableCopies', 0] }, 1, 0] } },
                        currentlyIssued: { $sum: { $cond: [{ $gt: ['$issuedCopies', 0] }, 1, 0] } }
                    }
                }
            ]),

            User.countDocuments({
                role: 'student'
            }),

            LendingRecord.countDocuments({
                status: 'issued',
                dueDate: {
                    $lt: startOfDay(new Date())
                }
            }),

            BookRequest.countDocuments({
                status: 'pending'
            }),

            BookRequest.countDocuments({
                status: 'approved'
            }),

            User.find(studentFilter)
                .select('name email role createdAt')
                .sort({ createdAt: -1 })
                .limit(25)
                .lean(),

            LendingRecord.find({
                status: 'issued'
            })
                .populate('student', 'name email')
                .populate(
                    'book',
                    'title author isbn availableCopies'
                )
                .sort({ dueDate: 1 })
                .limit(100)
                .lean(),

            BookRequest.find({
                status: { $in: ['pending', 'approved'] }
            })
                .populate('student', 'name email')
                .populate('book', 'title availableCopies totalCopies')
                .sort({ requestDate: -1 })
                .limit(50)
                .lean(),

            LendingRecord.find({
                $or: [
                    { status: 'issued' },
                    { status: 'returned' },
                    { fine: { $gt: 0 } },
                    { lostFine: { $gt: 0 } },
                    { damageFine: { $gt: 0 } }
                ]
            })
                .populate('student', 'name email')
                .populate(
                    'book',
                    'title author bookValue'
                )
                .sort({ updatedAt: -1 })
                .limit(100)
                .lean(),

            Book.aggregate([
                {
                    $group: {
                        _id: '$category',
                        titles: { $sum: 1 },
                        copies: {
                            $sum: {
                                $ifNull: ['$totalCopies', 0]
                            }
                        },
                        available: {
                            $sum: {
                                $ifNull: ['$availableCopies', 0]
                            }
                        }
                    }
                },
                {
                    $sort: {
                        copies: -1,
                        _id: 1
                    }
                }
            ]),

            LendingRecord.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: {
                        count: -1
                    }
                }
            ]),

            LendingRecord.aggregate([
                {
                    $group: {
                        _id: '$book',
                        borrowCount: {
                            $sum: 1
                        }
                    }
                },
                {
                    $sort: {
                        borrowCount: -1
                    }
                },
                {
                    $limit: 10
                },
                {
                    $lookup: {
                        from: 'books',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'book'
                    }
                },
                {
                    $unwind: {
                        path: '$book',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $project: {
                        _id: 1,
                        borrowCount: 1,
                        title: '$book.title',
                        author: '$book.author'
                    }
                }
            ]),

            LendingRecord.find()
                .populate('student', 'name email')
                .populate('book', 'title')
                .sort({ createdAt: -1 })
                .limit(6)
                .lean(),

            BookRequest.find()
                .populate('student', 'name email')
                .populate('book', 'availableCopies')
                .sort({ updatedAt: -1 })
                .limit(6)
                .lean()
        ]);

        const stats = bookStats[0] || {
            totalBooks: 0,
            availableBooks: 0,
            currentlyIssued: 0
        };

        stats.overdueBooks = overdueBooks;
        stats.registeredStudents = registeredStudents;
        stats.pendingRequests = pendingRequestsCount;

        stats.outstandingFines = fineRecords.reduce(
            (sum, loan) =>
                sum + (loan.status === 'issued' ? 0 : calculateCurrentFine(loan)),
            0
        );
        stats.outstandingFineRecords = fineRecords.filter(
            loan => calculateCurrentFine(loan) > 0 && (loan.status !== 'issued' || loan.fine !== null)
        ).length;
        stats.approvedRequests = approvedRequestsCount;

        const selectedQrId = String(
            req.query.qrBook || ''
        ).trim();

        const qrBooks = await Book.find()
            .select(
                'title author isbn category location image availableCopies'
            )
            .sort({ title: 1 })
            .limit(200)
            .lean();

        const selectedQrBook = selectedQrId
            ? qrBooks.find(
                book =>
                    String(book._id) === selectedQrId
            ) || null
            : null;

        const recentActivities = [
            ...recentLoans.map(item => ({
                type:
                    item.status === 'returned'
                        ? 'Return'
                        : item.status === 'issued'
                            ? 'Issue'
                            : item.status,

                text: `${item.student?.name || 'Student'} · ${item.book?.title || 'Book'}`,

                date:
                    item.updatedAt ||
                    item.createdAt
            })),

            ...recentRequests.map(item => ({
                type: `Request ${item.status}`,

                text: `${item.student?.name || 'Student'} · ${item.title}`,

                date:
                    item.updatedAt ||
                    item.createdAt
            }))
        ]
            .sort(
                (a, b) =>
                    new Date(b.date) -
                    new Date(a.date)
            )
            .slice(0, 8);

        return renderDashboard(res, {
            librarianName: req.user.name,

            success:
                req.query.bookAdded === 'true'
                    ? 'Book added successfully.'
                    : '',

            moduleSuccess:
                req.query.success || '',

            moduleError:
                req.query.error || '',

            settingsMessage:
                req.query.settingsMessage || '',

            dashboardStats: stats,

            students,
            studentSearch,
            activeLoans,
            pendingRequests,
            requestHistory: recentRequests,
            fineRecords,

            report: {
                categories,
                circulation,
                topBooks,
                recentActivities
            },

            qrBooks,
            selectedQrBook
        });

    } catch (error) {
        console.error(
            'Error loading librarian dashboard:',
            error
        );

        return renderDashboard(res, {
            librarianName: req.user.name,

            moduleError:
                'Unable to load the librarian dashboard right now.'
        });
    }
};

const getLibrarianBooks = async (req, res) => {
    try {
        const showAllBooks = String(req.query.all || '').toLowerCase() === 'true';
        const pageSize = showAllBooks ? 10000 : 12;

        const pageValue = Number.parseInt(
            req.query.page,
            10
        );

        const page =
            Number.isInteger(pageValue) &&
                pageValue > 0
                ? pageValue
                : 1;

        const bookFilters = {
            search: String(
                req.query.search || ''
            ).trim(),

            category: String(
                req.query.category || ''
            ).trim(),

            availability: [
                'all',
                'available',
                'out'
            ].includes(
                String(
                    req.query.availability || ''
                ).toLowerCase()
            )
                ? String(
                    req.query.availability || 'all'
                ).toLowerCase()
                : 'all',

            sort: [
                'titleAsc',
                'titleDesc',
                'newest',
                'oldest'
            ].includes(req.query.sort)
                ? req.query.sort
                : 'newest'
        };

        const filter =
            buildBookQuery(bookFilters);

        const [
            total,
            bookCategories
        ] = await Promise.all([
            Book.countDocuments(filter),
            Book.distinct('category')
        ]);

        const totalPages = Math.max(
            1,
            Math.ceil(total / pageSize)
        );

        const safePage = Math.min(
            page,
            totalPages
        );

        const books = await Book.find(filter)
            .sort(
                getBookSort(
                    bookFilters.sort
                )
            )
            .skip(
                (safePage - 1) *
                pageSize
            )
            .limit(pageSize)
            .lean();

        const activeBookRequests = await BookRequest.find({
            status: { $in: ['pending', 'approved'] },
            book: { $ne: null }
        }).select('book status').lean();
        const requestStatusByBook = new Map(
            activeBookRequests.map(request => [String(request.book), request.status])
        );

        const editBookId = String(
            req.query.edit || ''
        ).trim();

        let editBook = null;
        let formData = {};

        if (editBookId) {
            if (!mongoose.Types.ObjectId.isValid(editBookId)) {
                return renderDashboard(res, {
                    librarianName: req.user.name,
                    booksPage: true,
                    error: 'Invalid book ID.'
                });
            }
            editBook =
                await Book.findById(
                    editBookId
                ).lean();

            if (!editBook) {
                formData = {};
            } else {
                formData =
                    buildBookFormData(
                        editBook,
                        editBook
                    );
            }
        }

        return renderDashboard(res, {
            librarianName:
                req.user.name,

            booksPage: true,

            success:
                req.query.success || '',

            error:
                req.query.error || '',

            formData,

            books: books.map(book => ({
                ...book,

                availableCopies:
                    Math.max(
                        0,
                        Number(
                            book.availableCopies
                        ) || 0
                    ),

                issuedCopies:
                    Math.max(
                        0,
                        (Number(
                            book.totalCopies
                        ) || 0) -
                        (Number(
                            book.availableCopies
                        ) || 0)
                ),

                currentStatus: requestStatusByBook.get(String(book._id)) === 'approved'
                    ? 'Reserved / Requested'
                    : requestStatusByBook.get(String(book._id)) === 'pending'
                        ? 'Requested'
                        : Number(book.availableCopies) > 0
                            ? 'Available'
                            : (Number(book.issuedCopies) > 0 ? 'Currently Issued' : 'Unavailable')
            })),

            bookFilters,

            bookCategories:
                bookCategories
                    .filter(Boolean)
                    .sort(
                        (left, right) =>
                            left.localeCompare(
                                right
                            )
                    ),

            bookPagination: {
                page: safePage,
                totalPages,
                total
            },

            editBook
        });

    } catch (error) {
        console.error(
            'Error loading librarian books:',
            error
        );

        return renderDashboard(res, {
            librarianName:
                req.user.name,

            booksPage: true,

            error:
                'Unable to load library books right now.'
        });
    }
};

const postAddBook = async (req, res) => {
    const formData = {
        ...req.body
    };

    try {
        const title = String(
            req.body.title || ''
        ).trim();

        const author = String(
            req.body.author || ''
        ).trim();

        const category = String(
            req.body.category || ''
        ).trim();

        const isbn = String(
            req.body.isbn || ''
        ).trim();

        const totalCopies =
            Number(
                req.body.totalCopies
            );

        const bookValue =
            Number(
                req.body.bookValue
            );

        if (
            !title ||
            !author ||
            !category
        ) {
            return renderDashboard(
                res,
                {
                    librarianName:
                        req.user.name,

                    error:
                        'Title, author, and category are required.',

                    formData
                }
            );
        }

        if (
            !Number.isInteger(
                totalCopies
            ) ||
            totalCopies <= 0
        ) {
            return renderDashboard(
                res,
                {
                    librarianName:
                        req.user.name,

                    error:
                        'Total copies must be a positive whole number.',

                    formData
                }
            );
        }

        if (
            !Number.isFinite(
                bookValue
            ) ||
            bookValue < 0
        ) {
            return renderDashboard(
                res,
                {
                    librarianName:
                        req.user.name,

                    error:
                        'Book value must be a valid non-negative number.',

                    formData
                }
            );
        }

        if (
            isbn &&
            !/^(?:\d{9}[\dXx]|\d{13})$/.test(
                isbn.replace(
                    /[\s-]/g,
                    ''
                )
            )
        ) {
            return renderDashboard(
                res,
                {
                    librarianName:
                        req.user.name,

                    error:
                        'ISBN must be a valid ISBN-10 or ISBN-13 value.',

                    formData
                }
            );
        }

        const location = {
            building: String(
                req.body.building || ''
            ).trim(),

            floor: String(
                req.body.floor || ''
            ).trim(),

            shelf: String(
                req.body.shelf || ''
            ).trim()
        };

        await Book.create({
            title,
            author,
            category,
            isbn,

            image: String(
                req.body.image || ''
            ).trim(),

            publisher: String(
                req.body.publisher || ''
            ).trim(),

            edition: String(
                req.body.edition || ''
            ).trim(),

            language: String(
                req.body.language || ''
            ).trim(),

            description: String(
                req.body.description || ''
            ).trim(),

            bookValue,
            totalCopies,

            availableCopies:
                totalCopies,

            issuedCopies: 0,

            location
        });

        return res.redirect(
            '/librarian?bookAdded=true#add-book'
        );

    } catch (error) {
        console.error(
            'Error adding book:',
            error
        );

        return renderDashboard(
            res,
            {
                librarianName:
                    req.user.name,

                error:
                    'Unable to add the book. Please check the entered details.',

                formData
            }
        );
    }
};

const postEditBook = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.redirect(
                '/librarian/books?error=' +
                encodeURIComponent('Invalid book ID.') +
                '#books'
            );
        }

        const existingBook =
            await Book.findById(id);

        if (!existingBook) {
            return res.redirect(
                '/librarian/books?error=' +
                encodeURIComponent(
                    'Book not found.'
                ) +
                '#edit-book'
            );
        }

        const title = String(
            req.body.title || ''
        ).trim();

        const author = String(
            req.body.author || ''
        ).trim();

        const category = String(
            req.body.category || ''
        ).trim();

        const isbn = String(
            req.body.isbn || ''
        ).trim();

        const totalCopies =
            Number(
                req.body.totalCopies
            );

        const bookValue =
            Number(
                req.body.bookValue
            );

        const currentIssuedCopies =
            calculateIssuedCopies(
                existingBook
            );

        if (
            !title ||
            !author ||
            !category
        ) {
            return res.redirect(
                '/librarian/books?edit=' +
                id +
                '&error=' +
                encodeURIComponent(
                    'Title, author, and category are required.'
                ) +
                '#edit-book'
            );
        }

        if (
            !Number.isInteger(
                totalCopies
            ) ||
            totalCopies <= 0
        ) {
            return res.redirect(
                '/librarian/books?edit=' +
                id +
                '&error=' +
                encodeURIComponent(
                    'Total copies must be a positive whole number.'
                ) +
                '#edit-book'
            );
        }

        if (
            !Number.isFinite(
                bookValue
            ) ||
            bookValue < 0
        ) {
            return res.redirect(
                '/librarian/books?edit=' +
                id +
                '&error=' +
                encodeURIComponent(
                    'Book value must be a valid non-negative number.'
                ) +
                '#edit-book'
            );
        }

        if (
            totalCopies <
            currentIssuedCopies
        ) {
            return res.redirect(
                '/librarian/books?edit=' +
                id +
                '&error=' +
                encodeURIComponent(
                    'Total copies cannot be less than the number of currently issued copies.'
                ) +
                '#edit-book'
            );
        }

        if (
            isbn &&
            !/^(?:\d{9}[\dXx]|\d{13})$/.test(
                isbn.replace(
                    /[\s-]/g,
                    ''
                )
            )
        ) {
            return res.redirect(
                '/librarian/books?edit=' +
                id +
                '&error=' +
                encodeURIComponent(
                    'ISBN must be a valid ISBN-10 or ISBN-13 value.'
                ) +
                '#edit-book'
            );
        }

        const newAvailableCopies =
            totalCopies -
            currentIssuedCopies;

        const image = String(
            req.body.image || ''
        ).trim();

        const location = {
            building: String(
                req.body.building || ''
            ).trim(),

            floor: String(
                req.body.floor || ''
            ).trim(),

            shelf: String(
                req.body.shelf || ''
            ).trim()
        };

        await Book.findByIdAndUpdate(
            id,
            {
                title,
                author,
                category,
                isbn,

                image:
                    image ||
                    existingBook.image ||
                    '',

                publisher: String(
                    req.body.publisher || ''
                ).trim(),

                edition: String(
                    req.body.edition || ''
                ).trim(),

                language: String(
                    req.body.language || ''
                ).trim(),

                description: String(
                    req.body.description || ''
                ).trim(),

                bookValue,
                totalCopies,

                availableCopies:
                    newAvailableCopies,

                issuedCopies:
                    currentIssuedCopies,

                location
            },
            {
                runValidators: true
            }
        );

        return res.redirect(
            '/librarian/books?success=' +
            encodeURIComponent(
                'Book updated successfully.'
            ) +
            '#books'
        );

    } catch (error) {
        console.error(
            'Error updating book:',
            error
        );

        return res.redirect(
            '/librarian/books?error=' +
            encodeURIComponent(
                'Unable to update the book. Please check the entered details.'
            ) +
            '#edit-book'
        );
    }
};

const postDeleteBook = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.redirect(
                '/librarian/books?error=' +
                encodeURIComponent('Invalid book ID.') +
                '#books'
            );
        }

        const book =
            await Book.findById(id);

        if (!book) {
            return res.redirect(
                '/librarian/books?error=' +
                encodeURIComponent(
                    'Book not found.'
                ) +
                '#books'
            );
        }

        const issuedCopies =
            calculateIssuedCopies(
                book
            );

        if (issuedCopies > 0) {
            return res.redirect(
                '/librarian/books?error=' +
                encodeURIComponent(
                    'Cannot delete this book because copies are currently issued.'
                ) +
                '#books'
            );
        }

        await Book.findByIdAndDelete(
            id
        );

        return res.redirect(
            '/librarian/books?success=' +
            encodeURIComponent(
                'Book deleted successfully.'
            ) +
            '#books'
        );

    } catch (error) {
        console.error(
            'Error deleting book:',
            error
        );

        return res.redirect(
            '/librarian/books?error=' +
            encodeURIComponent(
                'Unable to delete the book right now.'
            ) +
            '#books'
        );
    }
};

const postIssueBookForStudent = async (
    req,
    res
) => {
    try {
        const requestId = String(req.body.requestId || '').trim();
        let studentId = String(req.body.studentId || '').trim();
        const email = String(
            req.body.studentEmail || ''
        )
            .trim()
            .toLowerCase();

        let bookId = String(
            req.body.bookId || ''
        ).trim();

        let requestToIssue = null;
        if (requestId) {
            if (!mongoose.Types.ObjectId.isValid(requestId)) {
                return res.redirect('/librarian?error=' + encodeURIComponent('Invalid request ID.') + '#requests');
            }
            requestToIssue = await BookRequest.findOne({ _id: requestId, status: 'approved' });
            if (!requestToIssue) {
                return res.redirect('/librarian?error=' + encodeURIComponent('Only an approved request can be issued.') + '#requests');
            }
            if (!requestToIssue.book) {
                return res.redirect('/librarian?error=' + encodeURIComponent('This request is not linked to a catalogue book.') + '#requests');
            }
            studentId = String(requestToIssue.student);
            bookId = String(requestToIssue.book);
        }

        if ((!email && !studentId) || !bookId) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Student and book are required.'
                ) +
                '#issue-returns'
            );
        }

        if (!mongoose.Types.ObjectId.isValid(bookId)) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Invalid book ID. Please select a book from the list.'
                ) +
                '#issue-returns'
            );
        }

        if (studentId && !mongoose.Types.ObjectId.isValid(studentId)) {
            return res.redirect('/librarian?error=' + encodeURIComponent('Invalid student.') + '#issue-returns');
        }

        const [
            student,
            book
        ] = await Promise.all([
            studentId
                ? User.findOne({ _id: studentId, role: 'student' })
                : User.findOne({ email, role: 'student' }),

            Book.findById(
                bookId
            )
        ]);

        if (!student) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Student not found.'
                ) +
                '#issue-returns'
            );
        }

        if (
            student.isActive ===
            false
        ) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'This student account is inactive.'
                ) +
                '#issue-returns'
            );
        }

        if (!book) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Book not found.'
                ) +
                '#issue-returns'
            );
        }

        if (
            (book.availableCopies || 0) <= 0
        ) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'No available copy of this book.'
                ) +
                '#issue-returns'
            );
        }

        const existingLoan =
            await LendingRecord.findOne({
                student:
                    student._id,

                book:
                    book._id,

                status:
                    'issued'
            });

        if (existingLoan) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'This student already has this book issued.'
                ) +
                '#issue-returns'
            );
        }

        const issueDate =
            new Date();

        const dueDate =
            addCalendarDays(
                issueDate,
                BORROWING_PERIOD_DAYS
            );

        const previousAvailable = book.availableCopies;
        const previousIssued = book.issuedCopies || 0;
        const updatedBook = await Book.findOneAndUpdate(
            { _id: book._id, availableCopies: { $gt: 0 }, issuedCopies: { $lt: book.totalCopies } },
            { $inc: { availableCopies: -1, issuedCopies: 1 } },
            { new: true, runValidators: true }
        );
        if (!updatedBook) {
            return res.redirect('/librarian?error=' + encodeURIComponent('No copy of this book is currently available.') + '#issue-returns');
        }
        let createdLoan;
        try {
            createdLoan = await LendingRecord.create({ student: student._id, book: book._id, issueDate, dueDate, status: 'issued' });
            if (requestToIssue) {
                const requestUpdate = await BookRequest.updateOne(
                    { _id: requestToIssue._id, status: 'approved' },
                    { $set: { status: 'issued' } }
                );
                if (requestUpdate.modifiedCount !== 1) {
                    throw new Error('Approved request could not be marked as issued.');
                }
            }
        } catch (createError) {
            if (createdLoan?._id) await LendingRecord.deleteOne({ _id: createdLoan._id });
            await Book.updateOne({ _id: book._id }, { $set: { availableCopies: previousAvailable, issuedCopies: previousIssued } });
            throw createError;
        }

        return res.redirect(
            '/librarian?success=' +
            encodeURIComponent(
                `"${book.title}" issued to ${student.name}.`
            ) +
            '#issue-returns'
        );

    } catch (error) {
        console.error(
            'Error issuing book for librarian:',
            error
        );

        return res.redirect(
            '/librarian?error=' +
            encodeURIComponent(
                'Unable to issue the book right now.'
            ) +
            '#issue-returns'
        );
    }
};

const postReturnBookForLibrarian = async (
    req,
    res
) => {
    try {
        const loanId = String(
            req.body.loanId || ''
        ).trim();

        if (!loanId || !mongoose.Types.ObjectId.isValid(loanId)) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Invalid loan ID. Please refresh the page and try again.'
                ) +
                '#issue-returns'
            );
        }

        const loan =
            await LendingRecord.findOne({
                _id: loanId,
                status: 'issued'
            }).populate('book');

        if (!loan) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Active lending record not found.'
                ) +
                '#issue-returns'
            );
        }

        const returnDate =
            new Date();

        const {
            overdueDays,
            fine
        } =
            calculateLateFine(
                loan.dueDate,
                returnDate
            );

        const finalFineInput = String(req.body.finalFine ?? '').trim();
        const finalFine = finalFineInput === '' ? fine : Number(finalFineInput);
        if (!Number.isFinite(finalFine) || finalFine < 0) {
            return res.redirect('/librarian?error=' + encodeURIComponent('Final fine must be a valid non-negative number.') + '#issue-returns');
        }
        const fineType = String(req.body.fineType || (finalFine > 0 ? 'late' : 'none')).toLowerCase();
        if (!['none', 'late', 'other'].includes(fineType)) {
            return res.redirect('/librarian?error=' + encodeURIComponent('Invalid fine type.') + '#issue-returns');
        }

        if (!loan.book) {
            return res.redirect('/librarian?error=' + encodeURIComponent('Book not found.') + '#issue-returns');
        }
        const updatedBook = await Book.findOneAndUpdate(
            { _id: loan.book._id, issuedCopies: { $gt: 0 }, availableCopies: { $lt: loan.book.totalCopies } },
            { $inc: { availableCopies: 1, issuedCopies: -1 } },
            { new: true, runValidators: true }
        );
        if (!updatedBook) {
            return res.redirect('/librarian?error=' + encodeURIComponent('Book status could not be updated. Please try again.') + '#issue-returns');
        }
        loan.returnDate = returnDate;
        loan.overdueDays = overdueDays;
        loan.suggestedFine = fine;
        loan.fine = finalFine;
        loan.fineType = fineType;
        loan.status = 'returned';
        try {
            await loan.save();
        } catch (saveError) {
            await Book.updateOne({ _id: updatedBook._id }, { $inc: { availableCopies: -1, issuedCopies: 1 } });
            throw saveError;
        }
        await BookRequest.updateOne(
            { student: loan.student, book: loan.book._id, status: 'issued' },
            { $set: { status: 'returned' } }
        );

        return res.redirect(
            '/librarian?success=' +
            encodeURIComponent(
                finalFine > 0
                    ? `Book returned. Fine: ₹${finalFine}.`
                    : 'Book returned successfully.'
            ) +
            '#issue-returns'
        );

    } catch (error) {
        console.error(
            'Error returning book for librarian:',
            error
        );

        return res.redirect(
            '/librarian?error=' +
            encodeURIComponent(
                'Unable to return the book right now.'
            ) +
            '#issue-returns'
        );
    }
};

const postApproveBookRequest = async (
    req,
    res
) => {
    try {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent('Invalid request ID.') +
                '#requests'
            );
        }

        const request =
            await BookRequest.findOne({
                _id: id,
                status: 'pending'
            });

        if (!request) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Pending request not found.'
                ) +
                '#requests'
            );
        }

        request.status =
            'approved';

        await request.save();

        return res.redirect(
            '/librarian?success=' +
            encodeURIComponent(
                `Request for "${request.title}" approved.`
            ) +
            '#requests'
        );

    } catch (error) {
        console.error(
            'Error approving book request:',
            error
        );

        return res.redirect(
            '/librarian?error=' +
            encodeURIComponent(
                'Unable to approve the request.'
            ) +
            '#requests'
        );
    }
};

const postRejectBookRequest = async (
    req,
    res
) => {
    try {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent('Invalid request ID.') +
                '#requests'
            );
        }

        const rejectionReason = String(req.body.rejectionReason || '').trim();

        const request =
            await BookRequest.findOne({
                _id: id,
                status: 'pending'
            });

        if (!request) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Pending request not found.'
                ) +
                '#requests'
            );
        }

        request.status =
            'rejected';

        if (rejectionReason) {
            request.rejectionReason = rejectionReason;
        }

        await request.save();

        return res.redirect(
            '/librarian?success=' +
            encodeURIComponent(
                `Request for "${request.title}" rejected.`
            ) +
            '#requests'
        );

    } catch (error) {
        console.error(
            'Error rejecting book request:',
            error
        );

        return res.redirect(
            '/librarian?error=' +
            encodeURIComponent(
                'Unable to reject the request.'
            ) +
            '#requests'
        );
    }
};

const postToggleStudent = async (
    req,
    res
) => {
    try {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent('Invalid student ID.') +
                '#students'
            );
        }

        const student =
            await User.findOne({
                _id: id,
                role: 'student'
            });

        if (!student) {
            return res.redirect(
                '/librarian?error=' +
                encodeURIComponent(
                    'Student not found.'
                ) +
                '#students'
            );
        }

        // Existing schema does not have an active flag.
        // Store it without changing existing schema by using strict:false.
        student.set(
            'isActive',
            student.get('isActive') === false
        );

        await student.save({
            strict: false
        });

        return res.redirect(
            '/librarian?success=' +
            encodeURIComponent(
                `Student ${student.get('isActive') ? 'activated' : 'deactivated'}.`
            ) +
            '#students'
        );

    } catch (error) {
        console.error(
            'Error toggling student:',
            error
        );

        return res.redirect(
            '/librarian?error=' +
            encodeURIComponent(
                'Unable to update student status.'
            ) +
            '#students'
        );
    }
};

const postChangeLibrarianPassword = async (
    req,
    res
) => {
    try {
        const currentPassword =
            String(
                req.body.currentPassword || ''
            );

        const newPassword =
            String(
                req.body.newPassword || ''
            );

        const confirmPassword =
            String(
                req.body.confirmPassword || ''
            );

        if (
            !currentPassword ||
            !newPassword ||
            !confirmPassword
        ) {
            return res.redirect(
                '/librarian?settingsMessage=' +
                encodeURIComponent(
                    'All password fields are required.'
                ) +
                '#settings'
            );
        }

        if (newPassword.length < 6) {
            return res.redirect(
                '/librarian?settingsMessage=' +
                encodeURIComponent(
                    'New password must be at least 6 characters.'
                ) +
                '#settings'
            );
        }

        if (
            newPassword !==
            confirmPassword
        ) {
            return res.redirect(
                '/librarian?settingsMessage=' +
                encodeURIComponent(
                    'New password and confirmation do not match.'
                ) +
                '#settings'
            );
        }

        const librarian =
            await User.findOne({
                _id: req.user.id,
                role: 'librarian'
            });

        if (
            !librarian ||
            !(
                await bcrypt.compare(
                    currentPassword,
                    librarian.password
                )
            )
        ) {
            return res.redirect(
                '/librarian?settingsMessage=' +
                encodeURIComponent(
                    'Current password is incorrect.'
                ) +
                '#settings'
            );
        }

        librarian.password =
            await bcrypt.hash(
                newPassword,
                10
            );

        await librarian.save();

        return res.redirect(
            '/librarian?settingsMessage=' +
            encodeURIComponent(
                'Password changed successfully. Please use the new password next time you log in.'
            ) +
            '#settings'
        );

    } catch (error) {
        console.error(
            'Error changing librarian password:',
            error
        );

        return res.redirect(
            '/librarian?settingsMessage=' +
            encodeURIComponent(
                'Unable to change password right now.'
            ) +
            '#settings'
        );
    }
};

module.exports = {
    getLibrarianDashboard,
    getLibrarianBooks,
    postAddBook,
    postEditBook,
    postDeleteBook,
    postIssueBookForStudent,
    postReturnBookForLibrarian,
    postApproveBookRequest,
    postRejectBookRequest,
    postToggleStudent,
    postChangeLibrarianPassword,
    buildBookQuery,
    getBookSort,
    calculateIssuedCopies,
    calculateLateFine,

    // FIX:
    calculateCurrentFine
};