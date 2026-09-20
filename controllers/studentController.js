const mongoose = require('mongoose');
const User = require('../models/User');
const Book = require('../models/Book');
const LendingRecord = require('../models/LendingRecord');
const BookRequest = require('../models/BookRequest');
const { getBookCover } = require('../services/bookCoverService');
const { discoverBooks, cleanSearchQuery } = require('../services/bookDiscoveryService');

// ============================================================
// STEP 7: Persistent in-memory cache for dynamic learning paths
// (avoids repeated external API calls for the same query)
// ============================================================
const dynamicPathCache = new Map();
const DYNAMIC_PATH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const BORROWING_PERIOD_DAYS = 14;
const LATE_FINE_BASE = 50;
const LATE_FINE_DAILY = 5;
const RENEWAL_PERIOD_DAYS = 14;

function startOfDay(date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
}

function addCalendarDays(date, days) {
    const value = new Date(date);
    value.setDate(value.getDate() + days);
    return value;
}

function calendarDaysLate(dueDate, returnDate) {
    const difference = startOfDay(returnDate).getTime() - startOfDay(dueDate).getTime();
    return Math.max(0, Math.floor(difference / 86400000));
}

function calculateLateFine(dueDate, returnDate) {
    const overdueDays = calendarDaysLate(dueDate, returnDate);
    return {
        overdueDays,
        fine: overdueDays > 0 ? LATE_FINE_BASE + (overdueDays * LATE_FINE_DAILY) : 0
    };
}

function calculateDamageFine(bookValue, damageLevel) {
    if (typeof bookValue !== 'number' || !Number.isFinite(bookValue)) return null;
    const rates = { MINOR: 0.25, MODERATE: 0.5, SEVERE: 1 };
    return rates[damageLevel] === undefined ? null : Math.round(bookValue * rates[damageLevel] * 100) / 100;
}

function getRenewalError(loan, now = new Date()) {
    if (!loan || loan.status !== 'issued') return 'Renewal unavailable: active loan not found.';
    if ((loan.renewalCount || 0) >= 1) return 'Renewal unavailable: maximum renewal limit reached.';
    if (startOfDay(now) > startOfDay(loan.dueDate)) return 'Renewal unavailable: book is overdue.';
    return null;
}

function decorateLoan(record, now = new Date()) {
    const loan = record.toObject ? record.toObject() : { ...record };
    if (loan.status === 'issued') {
        const dayDifference = Math.floor((startOfDay(loan.dueDate).getTime() - startOfDay(now).getTime()) / 86400000);
        loan.daysRemaining = Math.max(0, dayDifference);
        loan.currentOverdueDays = Math.max(0, -dayDifference);
        loan.currentFine = loan.currentOverdueDays > 0
            ? LATE_FINE_BASE + (loan.currentOverdueDays * LATE_FINE_DAILY)
            : 0;
        loan.loanStatusLabel = dayDifference > 0 ? `Due in ${dayDifference} days` : dayDifference === 0 ? 'Due today' : `Overdue by ${-dayDifference} days`;
    } else {
        loan.currentFine = loan.fine ?? loan.lostFine ?? loan.damageFine ?? 0;
        loan.loanStatusLabel = loan.status.charAt(0).toUpperCase() + loan.status.slice(1);
    }
    return loan;
}

function getFinalFine(record) {
    if (!record || record.status === 'issued') return 0;
    if (record.status === 'lost') return Number(record.lostFine) || 0;
    if (record.status === 'damaged') return Number(record.damageFine) || 0;
    return Number(record.fine) || 0;
}

function getFineType(record) {
    if (record.fineType) return record.fineType;
    if (record.status === 'lost') return 'lost';
    if (record.status === 'damaged') return 'damaged';
    return getFinalFine(record) > 0 ? 'late' : 'none';
}

// Helper to escape special regex characters
function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// Clean date formatting
function formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function formatLongDate(date) {
    if (!date) return 'Soon';
    const d = new Date(date);
    return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function getBookStatus(book, approvedRequest = false) {
    if (approvedRequest) return 'reserved';
    return Number(book.availableCopies) > 0 ? 'available' : 'unavailable';
}

/**
 * Curated knowledge base for Goal-Based Reading & Learning Paths.
 * Preserves strict chronological order.
 * External book covers use reliable Open Library Cover APIs or high-grade SVG covers.
 */
const CURATED_LEARNING_PATHS = [
    {
        id: 'backend',
        keywords: ['backend', 'back end', 'node', 'express', 'server', 'api', 'databases', 'backend development'],
        title: 'Backend Development Learning Path',
        targetGoal: 'What should I study to learn backend development?',
        level: 'Beginner → Advanced',
        description: 'A comprehensive, step-by-step path taking you from core JavaScript fundamentals to building secure, production-grade microservices and databases.',
        steps: [
            {
                stepNumber: 1,
                title: 'JavaScript: The Definitive Guide',
                subtitle: 'JavaScript Fundamentals & Asynchronous Runtime',
                author: 'David Flanagan',
                isbn: '9781491950296',
                reason: 'Essential starting point: All Node.js backend logic relies on deep mastery of closures, prototypes, asynchronous Promises, and modern ES6+ syntax.',
                prerequisite: 'None (Foundational)',
                category: 'Programming'
            },
            {
                stepNumber: 2,
                title: 'Node.js Design Patterns',
                subtitle: 'Node.js Core Architecture & Asynchronous Patterns',
                author: 'Mario Casciaro & Luciano Mammino',
                isbn: '9781839214110',
                reason: 'Teaches the underlying Event Loop, Non-blocking I/O, Buffer manipulation, and Streams that power high-concurrency Node.js servers.',
                prerequisite: 'Step 01 (JavaScript Fundamentals)',
                category: 'Backend'
            },
            {
                stepNumber: 3,
                title: 'HTTP: The Definitive Guide',
                subtitle: 'HTTP Protocol, REST APIs & Networking',
                author: 'David Gourley & Brian Totty',
                isbn: '9781565925090',
                reason: 'Teaches request-response cycles, status codes, caching headers, CORS, TLS, and architectural principles of RESTful APIs.',
                prerequisite: 'Step 02 (Node.js Basics)',
                category: 'Networking'
            },
            {
                stepNumber: 4,
                title: 'Express in Action',
                subtitle: 'Express.js Framework & Middleware Engineering',
                author: 'Evan M. Hahn',
                isbn: '9781617292422',
                reason: 'Covers routing, custom middleware stacks, error handling middleware, template rendering, and structuring production Express apps.',
                prerequisite: 'Step 03 (HTTP & REST)',
                category: 'Backend'
            },
            {
                stepNumber: 5,
                title: 'Database System Concepts',
                subtitle: 'Database Theory, SQL & Indexing Fundamentals',
                author: 'Abraham Silberschatz & Henry F. Korth',
                isbn: '9780073523323',
                reason: 'Crucial for backend developers: Understand ACID compliance, relational schemas, B-tree indexes, queries, and transaction isolation.',
                prerequisite: 'Step 04 (Express.js)',
                category: 'Databases'
            },
            {
                stepNumber: 6,
                title: 'MongoDB: The Definitive Guide',
                subtitle: 'NoSQL Document Store & Mongoose Modeling',
                author: 'Shannon Bradshaw, Eoin Brazil & Kristina Chodorow',
                isbn: '9781491954461',
                reason: 'Hands-on document modeling, embedding vs referencing, Mongoose middleware, aggregation pipelines, and sharding/replication.',
                prerequisite: 'Step 05 (Database Concepts)',
                category: 'Databases'
            },
            {
                stepNumber: 7,
                title: 'OAuth 2 in Action',
                subtitle: 'Authentication, JWT & Authorization Standards',
                author: 'Justin Richer & Antonio Sanso',
                isbn: '9781617293276',
                reason: 'Securing backend applications: JSON Web Tokens, HTTP-only cookie security, password hashing with bcrypt, and role-based access control.',
                prerequisite: 'Step 04 & 06',
                category: 'Security'
            },
            {
                stepNumber: 8,
                title: 'Designing Data-Intensive Applications',
                subtitle: 'Scalability, Reliability & Distributed Systems',
                author: 'Martin Kleppmann',
                isbn: '9781449373320',
                reason: 'The gold standard for senior backend engineers: replication, partitioning, consensus algorithms, event streaming, and caching architecture.',
                prerequisite: 'Step 06 & 07',
                category: 'Architecture'
            }
        ]
    },
    {
        id: 'frontend',
        keywords: ['frontend', 'front end', 'web development', 'html', 'css', 'react', 'learn web development', 'ui'],
        title: 'Modern Web & Frontend Development Path',
        targetGoal: 'I want to learn web development',
        level: 'Beginner → Intermediate',
        description: 'The definitive pathway from semantic HTML & modern CSS layouts to component architecture and web performance.',
        steps: [
            {
                stepNumber: 1,
                title: 'HTML & CSS: Design and Build Websites',
                subtitle: 'Semantic HTML5 & Modern Styling Essentials',
                author: 'Jon Duckett',
                isbn: '9781118008188',
                reason: 'The visual and semantic foundation of all web pages. Learn document structure, typography, colors, and accessibility.',
                prerequisite: 'None (Foundational)',
                category: 'Frontend'
            },
            {
                stepNumber: 2,
                title: 'CSS Secrets: Better Solutions to Everyday Web Problems',
                subtitle: 'Flexbox, Grid & Modern Responsive Layouts',
                author: 'Lea Verou',
                isbn: '9781449372637',
                reason: 'Master modern CSS Grid, Flexbox, responsive viewports, custom variables, and elegant animations without bloated frameworks.',
                prerequisite: 'Step 01 (HTML & CSS)',
                category: 'Frontend'
            },
            {
                stepNumber: 3,
                title: 'JavaScript and JQuery: Interactive Front-End Web Development',
                subtitle: 'Interactive UI & DOM Manipulation',
                author: 'Jon Duckett',
                isbn: '9781118531648',
                reason: 'Bring interfaces alive: DOM queries, event delegation, handling forms, and communicating with servers using fetch.',
                prerequisite: 'Step 01 & 02',
                category: 'Frontend'
            },
            {
                stepNumber: 4,
                title: 'Eloquent JavaScript',
                subtitle: 'Modern JavaScript Language & Problem Solving',
                author: 'Marijn Haverbeke',
                isbn: '9781593279509',
                reason: 'Deep dive into data structures, functional patterns, object-oriented principles, and regular expressions.',
                prerequisite: 'Step 03 (DOM Basics)',
                category: 'Programming'
            },
            {
                stepNumber: 5,
                title: 'Learning React: Modern Patterns for Developing React Apps',
                subtitle: 'Component-Driven Architecture & State Management',
                author: 'Alex Banks & Eve Porcello',
                isbn: '9781492051725',
                reason: 'Learn component breakdown, Hooks, unidirectional data flow, context APIs, and single-page application routing.',
                prerequisite: 'Step 04 (Modern JS)',
                category: 'Frontend'
            }
        ]
    },
    {
        id: 'javascript',
        keywords: ['javascript', 'js', 'learn javascript', 'vanilla js', 'ecmascript'],
        title: 'Complete JavaScript Mastery Path',
        targetGoal: 'I want to learn JavaScript',
        level: 'Zero → Hero',
        description: 'From fundamental syntax to advanced memory management, prototypes, and asynchronous execution internals.',
        steps: [
            {
                stepNumber: 1,
                title: 'Head First JavaScript Programming',
                subtitle: 'Core Syntax, Primitives & Control Flow',
                author: 'Eric Freeman & Elisabeth Robson',
                isbn: '9781449340131',
                reason: 'Gentle, visual introduction to variables, arrays, objects, functions, and browser scripting.',
                prerequisite: 'None',
                category: 'Programming'
            },
            {
                stepNumber: 2,
                title: 'You Don\'t Know JS Yet: Get Started',
                subtitle: 'Language Mechanics & Deep Scoping',
                author: 'Kyle Simpson',
                isbn: '9781684742516',
                reason: 'Unlocks lexical scope, hoisting, closures, execution context, and the fundamental building blocks of JavaScript.',
                prerequisite: 'Step 01',
                category: 'Programming'
            },
            {
                stepNumber: 3,
                title: 'You Don\'t Know JS: Scope & Closures',
                subtitle: 'Closures, Modules & Variable Lifetime',
                author: 'Kyle Simpson',
                isbn: '9781449335588',
                reason: 'Master the closure mechanism that powers function factories, private state, and modular architecture.',
                prerequisite: 'Step 02',
                category: 'Programming'
            },
            {
                stepNumber: 4,
                title: 'You Don\'t Know JS: Async & Performance',
                subtitle: 'Promises, Async/Await & The Event Loop',
                author: 'Kyle Simpson',
                isbn: '9781491904190',
                reason: 'Understand microtasks, macrotasks, concurrent async operations, generator functions, and performance profiling.',
                prerequisite: 'Step 03',
                category: 'Programming'
            }
        ]
    },
    {
        id: 'raj-comics-nagraj',
        keywords: ['raj comics', 'nagraj', 'i want to read raj comics', 'i want to read nagraj', 'comics', 'superhero comics', 'dhruva', 'doga'],
        title: 'Raj Comics / Nagraj Chronological Reading Path',
        targetGoal: 'I want to read Nagraj / Raj Comics',
        level: 'Origin → Epic Sagas',
        description: 'The authentic, chronological reading order of India’s legendary green superhero, preserving story continuity from origin to major sagas.',
        steps: [
            {
                stepNumber: 1,
                title: 'Nagraj (Issue #1)',
                subtitle: 'The Genesis & Awakening of the Snake King',
                author: 'Parashuram Sharma & Sanjay Gupta',
                isbn: 'RC-NAGRAJ-001',
                reason: 'The definitive origin story: Professor Nagmani genetically creates Nagraj as a weapon, who then breaks free to fight evil.',
                prerequisite: 'None (The Origin)',
                category: 'Comics',
                series: 'Raj Comics / Nagraj',
                readingOrder: 1
            },
            {
                stepNumber: 2,
                title: 'Samrat',
                subtitle: 'The Encounter with Emperor Samrat',
                author: 'Sanjay Gupta',
                isbn: 'RC-NAGRAJ-002',
                reason: 'Continues directly after the origin: Nagraj encounters his first international villain Samrat in the criminal syndicate.',
                prerequisite: 'Step 01 (Nagraj #1)',
                category: 'Comics',
                series: 'Raj Comics / Nagraj',
                readingOrder: 2
            },
            {
                stepNumber: 3,
                title: 'Nagpasha',
                subtitle: 'The Rise of the Eternal Arch-Nemesis',
                author: 'Sanjay Gupta',
                isbn: 'RC-NAGRAJ-003',
                reason: 'Introduces Nagpasha, Nagraj\'s supreme nemesis who remains central across the entire Raj Comics multiverse.',
                prerequisite: 'Step 02 (Samrat)',
                category: 'Comics',
                series: 'Raj Comics / Nagraj',
                readingOrder: 3
            },
            {
                stepNumber: 4,
                title: 'Khooni Khoj',
                subtitle: 'Underworld Conspiracy & The Search for Identity',
                author: 'Sanjay Gupta',
                isbn: 'RC-NAGRAJ-004',
                reason: 'Nagraj explores his mysterious heritage and uncovers the ancient serpent race of Ichhadhari snakes.',
                prerequisite: 'Step 03 (Nagpasha)',
                category: 'Comics',
                series: 'Raj Comics / Nagraj',
                readingOrder: 4
            },
            {
                stepNumber: 5,
                title: 'Kismat Ka Khel',
                subtitle: 'Supernatural Powers & Destiny Unleashed',
                author: 'Sanjay Gupta',
                isbn: 'RC-NAGRAJ-005',
                reason: 'Key battle showcasing the full spectrum of snake superpowers, poison breath, and astral serpents.',
                prerequisite: 'Step 04 (Khooni Khoj)',
                category: 'Comics',
                series: 'Raj Comics / Nagraj',
                readingOrder: 5
            },
            {
                stepNumber: 6,
                title: 'Vish Amrit',
                subtitle: 'The Poison & Nectar Battle',
                author: 'Sanjay Gupta',
                isbn: 'RC-NAGRAJ-006',
                reason: 'Critical turning point where Nagraj must choose between immortality and protecting humanity from biological doom.',
                prerequisite: 'Step 05 (Kismat Ka Khel)',
                category: 'Comics',
                series: 'Raj Comics / Nagraj',
                readingOrder: 6
            },
            {
                stepNumber: 7,
                title: 'Nagayan Saga (Parv 1: Varanasi Kand)',
                subtitle: 'The Ultimate Epic Multiverse Crossover',
                author: 'Anupam Sinha & Sanjay Gupta',
                isbn: 'RC-NAGRAYAN-001',
                reason: 'The magnum opus of Indian comic book literature: a grand multi-part epic spanning all Raj Comics superheroes in a futuristic war.',
                prerequisite: 'Previous Core Issues',
                category: 'Comics',
                series: 'Raj Comics / Nagraj',
                readingOrder: 7
            }
        ]
    },
    {
        id: 'dsa',
        keywords: ['dsa', 'data structures', 'algorithms', 'problem solving', 'interview', 'leetcode'],
        title: 'Data Structures & Algorithms Reading Path',
        targetGoal: 'I want to study Data Structures & Algorithms',
        level: 'Fundamental → Advanced',
        description: 'Systematic progression from Big-O complexity to complex graph theory and dynamic programming.',
        steps: [
            {
                stepNumber: 1,
                title: 'Grokking Algorithms',
                subtitle: 'Visual & Intuitive Algorithm Fundamentals',
                author: 'Aditya Y. Bhargava',
                isbn: '9781617292231',
                reason: 'The best visual conceptual introduction to Big-O, recursion, binary search, sorting, and graph traversal.',
                prerequisite: 'Basic Programming',
                category: 'Algorithms'
            },
            {
                stepNumber: 2,
                title: 'Data Structures and Algorithms Made Easy',
                subtitle: 'Linear & Hierarchical Data Structures',
                author: 'Narasimha Karumanchi',
                isbn: '9788193245279',
                reason: 'Thorough coverage of Linked Lists, Stacks, Queues, Binary Trees, and AVL Trees with interview patterns.',
                prerequisite: 'Step 01',
                category: 'Algorithms'
            },
            {
                stepNumber: 3,
                title: 'Introduction to Algorithms (CLRS)',
                subtitle: 'Rigorous Algorithmic Design & Optimization',
                author: 'Cormen, Leiserson, Rivest & Stein',
                isbn: '9780262033848',
                reason: 'The academic standard for greedy algorithms, dynamic programming proofs, NP-completeness, and graph algorithms.',
                prerequisite: 'Step 02',
                category: 'Algorithms'
            }
        ]
    },
    {
        id: 'python-ai',
        keywords: ['python', 'ai', 'artificial intelligence', 'machine learning', 'data science', 'deep learning'],
        title: 'Python, Data Science & AI Learning Path',
        targetGoal: 'I want to learn Python & Machine Learning',
        level: 'Beginner → AI Practitioner',
        description: 'A structured roadmap from Python essentials to neural networks and machine learning pipelines.',
        steps: [
            {
                stepNumber: 1,
                title: 'Python Crash Course',
                subtitle: 'Hands-on, Project-Based Python Fundamentals',
                author: 'Eric Matthes',
                isbn: '9781593279288',
                reason: 'Rapid, practical mastery of Python data types, dictionaries, lists, functions, classes, and testing.',
                prerequisite: 'None',
                category: 'Programming'
            },
            {
                stepNumber: 2,
                title: 'Python for Data Analysis',
                subtitle: 'NumPy, Pandas & Data Wrangling',
                author: 'Wes McKinney',
                isbn: '9781491957660',
                reason: 'Written by the creator of Pandas: teaches high-performance array manipulation, data cleaning, and aggregation.',
                prerequisite: 'Step 01 (Python Basics)',
                category: 'Data Science'
            },
            {
                stepNumber: 3,
                title: 'Hands-On Machine Learning with Scikit-Learn, Keras, and TensorFlow',
                subtitle: 'Applied Machine Learning & Neural Networks',
                author: 'Aurélien Géron',
                isbn: '9781492032649',
                reason: 'End-to-end ML engineering: classification, regression, ensemble models, and deep learning architectures.',
                prerequisite: 'Step 02 (NumPy & Pandas)',
                category: 'Machine Learning'
            }
        ]
    }
];

/**
 * STEPS 3 & 4: Detect if the query is about a series/comics/specific reading order.
 * Returns detected series name or null.
 */
function detectSeries(query) {
    const q = (query || '').toLowerCase();
    const seriesPatterns = [
        { pattern: /harry\s*potter/i, name: 'Harry Potter' },
        { pattern: /lord\s*of\s*the\s*rings/i, name: 'Lord of the Rings' },
        { pattern: /game\s*of\s*thrones|song\s*of\s*ice/i, name: 'A Song of Ice and Fire' },
        { pattern: /naruto/i, name: 'Naruto' },
        { pattern: /one\s*piece/i, name: 'One Piece' },
        { pattern: /raj\s*comics|nagraj|dhruva|doga/i, name: 'Raj Comics' },
        { pattern: /percy\s*jackson/i, name: 'Percy Jackson' },
        { pattern: /hunger\s*games/i, name: 'Hunger Games' },
        { pattern: /divergent/i, name: 'Divergent' },
        { pattern: /maze\s*runner/i, name: 'Maze Runner' },
        { pattern: /sherlock|holmes/i, name: 'Sherlock Holmes' },
        { pattern: /agatha\s*christie|poirot/i, name: 'Agatha Christie' },
        { pattern: /discworld/i, name: 'Discworld' },
        { pattern: /wheel\s*of\s*time/i, name: 'Wheel of Time' },
        { pattern: /witcher/i, name: 'The Witcher' },
        { pattern: /dune/i, name: 'Dune' },
        { pattern: /foundation/i, name: 'Foundation' },
    ];
    for (const { pattern, name } of seriesPatterns) {
        if (pattern.test(q)) return name;
    }
    return null;
}

/**
 * STEP 5: Generate a dynamic learning path from external book discovery results.
 * Converts discovered real books into ordered learning path steps with covers.
 * Falls back to a conceptual path if external discovery returns nothing.
 */
async function generateDynamicTopicPath(goalQuery, allowFallback = true) {
    const cleanTopic = cleanSearchQuery(goalQuery) ||
        goalQuery
            .replace(/^(what should i study to learn|what to study for|how to learn|i want to learn|i want to read|learn|study|read|path for|roadmap for)\s+/i, '')
            .replace(/[?!.]+$/, '')
            .trim();

    const capitalizedTopic = cleanTopic
        ? cleanTopic.charAt(0).toUpperCase() + cleanTopic.slice(1)
        : 'General Knowledge';

    // STEP 7: Check in-memory cache first
    const cacheKey = `dynamic::${cleanTopic.toLowerCase()}`;
    const now = Date.now();
    if (dynamicPathCache.has(cacheKey)) {
        const cached = dynamicPathCache.get(cacheKey);
        if (now - cached.timestamp < DYNAMIC_PATH_CACHE_TTL_MS) {
            return cached.path;
        }
    }

    // STEP 5: Discover real books from external APIs
    let discoveredSteps = [];
    try {
        // STEP 3: Enhance query for series detection
        const detectedSeries = detectSeries(goalQuery);
        const searchQuery = detectedSeries
            ? `${detectedSeries} series reading order`
            : cleanTopic;

        const discovery = await discoverBooks(searchQuery, 6);

        if (discovery && discovery.books && discovery.books.length >= 2) {
            // STEP 4: Preserve reading order — use position from discovery as step number
            discoveredSteps = discovery.books.map((book, idx) => ({
                stepNumber: idx + 1,
                title: book.title,
                subtitle: book.subtitle || `${capitalizedTopic} — Book ${idx + 1}`,
                author: book.author || 'Author not specified',
                isbn: book.isbn || undefined,
                externalId: book.externalId || undefined,
                // STEP 2: Use the cover URL directly from discovery (already verified by bookDiscoveryService)
                coverUrl: book.coverUrl || null,
                reason: `A highly relevant resource for ${capitalizedTopic}. Explore this book to deepen your understanding of the subject${detectedSeries ? ` and the ${detectedSeries} series` : ''}.`,
                prerequisite: idx === 0 ? 'None (Start here)' : `Step ${String(idx).padStart(2, '0')} (Previous book)`,
                category: capitalizedTopic,
                source: book.source || 'external',
                publisher: book.publisher,
                edition: book.edition,
                volume: book.volume,
                pageCount: book.pageCount,
                languages: book.languages || (book.language ? [book.language] : []),
                publishDate: book.publishDate,
                firstPublishYear: book.firstPublishYear || undefined,
                // STEP 3: Tag series if detected
                series: detectedSeries || undefined,
                readingOrder: idx + 1
            }));
        }
    } catch (err) {
        console.warn('Dynamic path external discovery error:', err.message);
    }

    // If external discovery returned real books, use them
    if (discoveredSteps.length >= 2) {
        const path = {
            id: 'dynamic-discovered-' + Date.now(),
            title: `${capitalizedTopic} — Recommended Reading Path`,
            targetGoal: goalQuery,
            level: 'Curated from Global Catalogue',
            description: `Real books discovered from external catalogues for "${capitalizedTopic}".`,
            steps: discoveredSteps
        };
        // STEP 7: Cache the discovered path
        dynamicPathCache.set(cacheKey, { path, timestamp: now });
        return path;
    }

    if (!allowFallback) {
        return null;
    }

    // Fallback: Conceptual placeholder path (external APIs returned nothing)
    const fallbackPath = {
        id: 'dynamic-conceptual-' + Date.now(),
        title: `${capitalizedTopic} Learning & Reading Path`,
        targetGoal: goalQuery,
        level: 'Foundational → Mastery',
        description: `A structured conceptual roadmap for ${capitalizedTopic}. Search our library or request titles below.`,
        steps: [
            {
                stepNumber: 1,
                title: `${capitalizedTopic}: Core Fundamentals & Origins`,
                subtitle: 'Essential Concepts, Terminology & Foundations',
                author: 'Academic Faculty & Domain Experts',
                reason: `Step 01 builds your bedrock: You cannot advance in ${capitalizedTopic} without understanding core terminology and fundamental rules.`,
                prerequisite: 'None (Prerequisite for all following steps)',
                category: capitalizedTopic
            },
            {
                stepNumber: 2,
                title: `Principles and Practical Applications of ${capitalizedTopic}`,
                subtitle: 'Intermediate Methodologies & Practical Frameworks',
                author: 'Practitioner Guild',
                reason: `Translates theoretical definitions into practical workflows and standard operational techniques.`,
                prerequisite: 'Step 01 (Core Fundamentals)',
                category: capitalizedTopic
            },
            {
                stepNumber: 3,
                title: `Advanced ${capitalizedTopic} & Structural Patterns`,
                subtitle: 'Deep Architectural & Analytical Perspectives',
                author: 'Senior Specialists',
                reason: `Explores nuanced edge-cases, optimization patterns, and critical analysis within ${capitalizedTopic}.`,
                prerequisite: 'Step 02 (Practical Applications)',
                category: capitalizedTopic
            },
            {
                stepNumber: 4,
                title: `Case Studies & Real-World ${capitalizedTopic} Implementations`,
                subtitle: 'Synthesis, Critique & High-Stakes Scenarios',
                author: 'Industry Leaders',
                reason: `Examines real-world historical and industrial applications, learning from complex successes and failures.`,
                prerequisite: 'Step 03 (Advanced Patterns)',
                category: capitalizedTopic
            },
            {
                stepNumber: 5,
                title: `Mastery and Future Horizons in ${capitalizedTopic}`,
                subtitle: 'Emerging Paradigms & Frontier Research',
                author: 'Research Consortium',
                reason: `Synthesizes complete mastery of the field and prepares you to evaluate emerging trends and innovations.`,
                prerequisite: 'Step 04 (Case Studies)',
                category: capitalizedTopic
            }
        ]
    };
    return fallbackPath;
}

/**
 * Matches a query string to a curated learning path or generates a dynamic topic path.
 * Checks MongoDB to separate Library Books from external recommendations.
 */
async function resolveReadingPath(rawQuery, completedBookIds) {
    const query = (rawQuery || '').toLowerCase().trim();
    let selectedPath = null;

    if (query) {
        // Try to match keywords in curated paths
        for (const p of CURATED_LEARNING_PATHS) {
            const matchesKeyword = p.keywords.some(k => query.includes(k.toLowerCase()));
            const matchesTitle = query.includes(p.title.toLowerCase()) || p.targetGoal.toLowerCase().includes(query);
            if (matchesKeyword || matchesTitle) {
                selectedPath = JSON.parse(JSON.stringify(p));
                break;
            }
        }

        // STEPS 3-5: If not matched, discover real books from external APIs
        if (!selectedPath) {
            selectedPath = await generateDynamicTopicPath(rawQuery.trim());
        }
    } else {
        // Default to the flagship Backend Development path
        selectedPath = JSON.parse(JSON.stringify(CURATED_LEARNING_PATHS[0]));
    }

    // STEP 6: Verify each step against MongoDB Catalogue.
    // External API (Open Library -> Google Books) gets metadata and accurate cover.
    // MongoDB determines whether the book actually exists in our library.
    // We NEVER insert external books into MongoDB Book collection.
    const resolvedSteps = await Promise.all(selectedPath.steps.map(async (step) => {
        const stepCopy = { ...step };

        // STEP 2: Get accurate cover.
        // For dynamically discovered steps, coverUrl is already set by bookDiscoveryService.
        // For curated path steps (with ISBN/author), use bookCoverService for best accuracy.
        if (!stepCopy.coverUrl) {
            const externalCoverUrl = await getBookCover(step.title, step.author, step.isbn, step.series);
            stepCopy.coverUrl = externalCoverUrl || null;
        }

                // STEP 6: Skip MongoDB checks – use only external discovery data.
        // No library availability information is attached.
        return stepCopy;

        return stepCopy;
    }));

    selectedPath.steps = resolvedSteps;
    return selectedPath;
}

// GET /student - Student Dashboard
const getStudentDashboard = async (req, res) => {
    try {
        // Strict server-side role check
        if (!req.user || req.user.role !== 'student') {
            return res.status(403).send('403 Forbidden: Access denied. Students only.');
        }

        const studentId = req.user.id;
        if (!mongoose.Types.ObjectId.isValid(studentId)) {
            return res.status(400).render('error', {
                title: 'Invalid student.',
                message: 'We could not identify your account. Please sign in again.'
            });
        }
        const studentUser = await User.findById(studentId).select('name email role');
        const studentName = studentUser ? studentUser.name : req.user.name;

        // 1. Fetch student's own borrowing history and currently issued books
        const allLendingRecords = await LendingRecord.find({ student: studentId })
            .populate('book')
            .sort({ issueDate: -1 });

        // Filter valid records where book is populated
        const validRecords = allLendingRecords.filter(r => r.book != null);

        const currentlyIssued = validRecords.filter(r => r.status === 'issued').map(decorateLoan);
        const completedRecords = validRecords.filter(r => r.status !== 'issued');
        const displayedHistory = validRecords.map(decorateLoan);

        // Summary metrics calculated strictly from MongoDB
        const currentlyIssuedCount = currentlyIssued.length;
        const completedBooksCount = completedRecords.length;
        const totalBorrowedCount = validRecords.length;
        const readingProgressPercent = totalBorrowedCount > 0
            ? Math.round((completedBooksCount / totalBorrowedCount) * 100)
            : 0;

        // Create a Set of completed book IDs to mark cards
        const completedBookIds = new Set(
            completedRecords.map(r => r.book._id.toString())
        );

        // 2. Fetch full library catalogue from MongoDB (clean, no dummy data)
        const catalogueBooks = await Book.find().sort({ title: 1 }).limit(4);

        // 3. Unified Search & Goal-Based Reading / Learning Path Resolution
        // Matches Screenshot 1's prominent search input
        const rawSearch = (req.query.q || req.query.goal || '').trim();
        const filterType = req.query.filter || 'all';

        let hasActivePath = false;
        let readingPath = null;
        let searchResults = null;
        let searchPerformed = false;
        let isExternalDiscovery = false;

        if (rawSearch) {
            searchPerformed = true;

            // The default search is external Reading/Book Discovery. The library
            // catalogue remains available through the explicit "books" filter.
            const lowerSearch = rawSearch.toLowerCase();
            const searchRegex = new RegExp(escapeRegex(rawSearch), 'i');
            const matchingLibraryBook = await Book.exists({
                $or: [
                    { title: searchRegex },
                    { author: searchRegex },
                    { category: searchRegex },
                    { isbn: searchRegex }
                ]
            });
            const isLibrarySearch = filterType === 'books' || Boolean(matchingLibraryBook);
            const isPathQuery = filterType === 'path' || Boolean(req.query.goal);

            if (isPathQuery) {
                hasActivePath = true;
                readingPath = await resolveReadingPath(rawSearch, completedBookIds);
            } else if (!isLibrarySearch) {
                isExternalDiscovery = true;
                readingPath = await generateDynamicTopicPath(rawSearch, false);
                hasActivePath = Boolean(readingPath && readingPath.steps.length > 0);
            }

            if (isLibrarySearch) {
                // Library search is intentionally separate from external discovery.
                const regex = new RegExp(escapeRegex(rawSearch), 'i');
                const matchedBooks = await Book.find({
                    $or: [
                        { title: regex },
                        { author: regex },
                        { category: regex },
                        { isbn: regex }
                    ]
                });

                // Enrich every match with availability, request, and loan status.
                searchResults = await Promise.all(matchedBooks.map(async (book) => {
                    const bookObj = book.toObject();
                    const issuedCount = book.issuedCopies !== undefined ? book.issuedCopies : (book.totalCopies - book.availableCopies);
                    bookObj.computedIssuedCopies = Math.max(0, issuedCount);

                    const [earliestRecord, activeRequest] = await Promise.all([
                        LendingRecord.findOne({ book: book._id, status: 'issued' })
                            .sort({ dueDate: 1 })
                            .select('dueDate'),
                        BookRequest.findOne({
                            book: book._id,
                            status: { $in: ['pending', 'approved'] }
                        }).sort({ requestDate: 1 }).select('status')
                    ]);

                    bookObj.earliestExpectedDate = earliestRecord
                        ? formatLongDate(earliestRecord.dueDate)
                        : 'Not available yet';
                    bookObj.activeRequestStatus = activeRequest ? activeRequest.status : null;
                    bookObj.displayStatus = book.availableCopies > 0
                        ? (activeRequest?.status === 'approved' ? 'reserved' : 'available')
                        : (activeRequest ? 'reserved' : 'issued');

                    bookObj.isCompleted = completedBookIds.has(book._id.toString());
                    return bookObj;
                }));
            }
        }

        // Fetch user's submitted book requests
        const myRequests = await BookRequest.find({ student: studentId }).sort({ requestDate: -1 });
        const approvedBookIds = new Set(
            myRequests
                .filter(request => request.status === 'approved' && request.book)
                .map(request => String(request.book))
        );
        const pendingRequestsCount = myRequests.filter(request => request.status === 'pending').length;
        const approvedRequestsCount = myRequests.filter(request => request.status === 'approved').length;
        const overdueBooksCount = currentlyIssued.filter(record => record.currentOverdueDays > 0).length;
        const fineRecords = validRecords
            .filter(record => getFinalFine(record) > 0 || record.status !== 'issued')
            .map(record => ({
                ...decorateLoan(record),
                chargedFine: getFinalFine(record),
                fineType: getFineType(record),
                fineStatus: getFinalFine(record) > 0 ? 'Outstanding' : 'No Fine'
            }));
        const outstandingFine = fineRecords.reduce((sum, record) => sum + record.chargedFine, 0);

        // Check if there's a success query flag for book requests
        const requestSuccess = req.query.requested === 'true';
        const requestedTitle = req.query.bookTitle || '';
        const loanMessage = req.query.loanMessage || '';
        const requestError = req.query.requestError || '';

        res.render('student', {
            student: {
                id: studentId,
                name: studentName,
                email: studentUser ? studentUser.email : ''
            },
            stats: {
                currentlyIssuedCount,
                completedBooksCount,
                totalBorrowedCount,
                readingProgressPercent
            },
            searchQuery: rawSearch,
            hasActivePath,
            readingPath,
            isExternalDiscovery,
            searchPerformed,
            searchResults,
            catalogueBooks: catalogueBooks.map(b => {
                const bObj = b.toObject();
                bObj.isCompleted = completedBookIds.has(b._id.toString());
                bObj.displayStatus = getBookStatus(bObj, approvedBookIds.has(b._id.toString()));
                bObj.expectedAvailability = 'Not available yet';
                return bObj;
            }),
            currentlyIssued,
            borrowingHistory: displayedHistory,
            fineRecords,
            myRequests,
            requestSuccess,
            requestedTitle,
            loanMessage,
            requestError,
            librarySummary: {
                currentlyBorrowed: currentlyIssuedCount,
                pendingRequests: pendingRequestsCount,
                approvedRequests: approvedRequestsCount,
                overdueBooks: overdueBooksCount,
                outstandingFine
            },
            formatDate,
            formatLongDate,
            getBookStatus
        });
    } catch (error) {
        console.error('Student Dashboard error:', error);
        return res.status(500).render('error', {
            title: 'Dashboard Error',
            message: 'Unable to load your dashboard right now. Please try again shortly.'
        });
    }
};

function studentBookStatus(book, request, loan, now = new Date()) {
    if (loan) {
        return new Date(loan.dueDate) < now ? 'overdue' : 'issued';
    }
    if (request?.status === 'approved') return 'approved';
    if (request?.status === 'pending') return 'pending';
    return Number(book.availableCopies) > 0 ? 'available' : 'unavailable';
}

function studentBookStatusLabel(status) {
    return {
        available: 'AVAILABLE',
        pending: 'REQUEST PENDING',
        approved: 'APPROVED',
        issued: 'CURRENTLY ISSUED',
        overdue: 'OVERDUE',
        unavailable: 'CURRENTLY UNAVAILABLE'
    }[status] || 'CURRENTLY UNAVAILABLE';
}

async function getStudentBookContext(bookIds, studentId) {
    const [requests, loans, activeLoans] = await Promise.all([
        BookRequest.find({
            student: studentId,
            book: { $in: bookIds },
            status: { $in: ['pending', 'approved'] }
        }).sort({ requestDate: -1 }).lean(),
        LendingRecord.find({
            student: studentId,
            book: { $in: bookIds },
            status: 'issued'
        }).lean(),
        LendingRecord.find({
            book: { $in: bookIds },
            status: 'issued'
        }).sort({ dueDate: 1 }).select('book dueDate').lean()
    ]);

    const requestByBook = new Map(requests.map(request => [String(request.book), request]));
    const loanByBook = new Map(loans.map(loan => [String(loan.book), loan]));
    const earliestLoanByBook = new Map();
    activeLoans.forEach(loan => {
        const key = String(loan.book);
        if (!earliestLoanByBook.has(key)) earliestLoanByBook.set(key, loan);
    });
    return { requestByBook, loanByBook, earliestLoanByBook };
}

async function getStudentBooks(req, res) {
    try {
        const search = String(req.query.search || '').trim();
        const category = String(req.query.category || '').trim();
        const availability = ['all', 'available', 'unavailable'].includes(String(req.query.availability || 'all'))
            ? String(req.query.availability || 'all')
            : 'all';
        const sort = ['titleAsc', 'titleDesc', 'newest'].includes(req.query.sort) ? req.query.sort : 'titleAsc';
        const pageSize = 12;
        const requestedPage = Number.parseInt(req.query.page, 10);
        const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
        const filter = {};

        if (search) {
            const expression = new RegExp(escapeRegex(search), 'i');
            filter.$or = [{ title: expression }, { author: expression }, { category: expression }, { isbn: expression }];
        }
        if (category) filter.category = category;
        if (availability === 'available') filter.availableCopies = { $gt: 0 };
        if (availability === 'unavailable') filter.availableCopies = 0;

        const sortOption = sort === 'titleDesc' ? { title: -1 } : sort === 'newest' ? { createdAt: -1 } : { title: 1 };
        const [total, categories] = await Promise.all([
            Book.countDocuments(filter),
            Book.distinct('category')
        ]);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        const books = await Book.find(filter)
            .sort(sortOption)
            .skip((safePage - 1) * pageSize)
            .limit(pageSize)
            .lean();
        const context = await getStudentBookContext(books.map(book => book._id), req.user.id);
        const now = new Date();
        const decoratedBooks = books.map(book => {
            const key = String(book._id);
            const loan = context.loanByBook.get(key);
            const status = studentBookStatus(book, context.requestByBook.get(key), loan, now);
            const earliestLoan = context.earliestLoanByBook.get(key);
            return {
                ...book,
                issuedCopies: Number.isInteger(book.issuedCopies) ? book.issuedCopies : Math.max(0, book.totalCopies - book.availableCopies),
                status,
                statusLabel: studentBookStatusLabel(status),
                expectedAvailability: earliestLoan ? formatLongDate(earliestLoan.dueDate) : 'Not available yet',
                hasActiveRequest: Boolean(context.requestByBook.get(key)),
                hasActiveLoan: Boolean(loan)
            };
        });

        return res.render('student-books', {
            student: { name: req.user.name || 'Student' },
            books: decoratedBooks,
            categories: categories.filter(Boolean).sort((a, b) => a.localeCompare(b)),
            filters: { search, category, availability, sort },
            pagination: { page: safePage, totalPages, total },
            formatDate
        });
    } catch (error) {
        console.error('Student catalogue error:', error);
        return res.status(500).render('error', {
            title: 'Catalogue unavailable',
            message: 'Something went wrong. Please try again.'
        });
    }
}

async function getStudentBookDetails(req, res) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).render('error', { title: 'Invalid book.', message: 'Please choose a valid book.' });
        }
        const book = await Book.findById(id).lean();
        if (!book) {
            return res.status(404).render('error', { title: 'Book not found.', message: 'This book is no longer in the library.' });
        }
        const context = await getStudentBookContext([book._id], req.user.id);
        const key = String(book._id);
        const request = context.requestByBook.get(key);
        const loan = context.loanByBook.get(key);
        const status = studentBookStatus(book, request, loan);
        const earliestLoan = context.earliestLoanByBook.get(key);

        return res.render('student-book-details', {
            student: { name: req.user.name || 'Student' },
            book: {
                ...book,
                issuedCopies: Number.isInteger(book.issuedCopies) ? book.issuedCopies : Math.max(0, book.totalCopies - book.availableCopies),
                status,
                statusLabel: studentBookStatusLabel(status),
                expectedAvailability: earliestLoan ? formatLongDate(earliestLoan.dueDate) : 'Not available yet',
                request,
                loan
            },
            requestSuccess: String(req.query.requested || '') === 'true',
            requestError: String(req.query.requestError || ''),
            formatDate
        });
    } catch (error) {
        console.error('Student book details error:', error);
        return res.status(500).render('error', {
            title: 'Book unavailable',
            message: 'Something went wrong. Please try again.'
        });
    }
}

function calculateAge(dateOfBirth, now = new Date()) {
    if (!dateOfBirth) return null;
    const birthDate = new Date(dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) return null;
    let age = now.getFullYear() - birthDate.getFullYear();
    const birthday = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate());
    if (birthday > now) age -= 1;
    return age >= 0 ? age : null;
}

function profileFormData(user = {}) {
    return {
        name: user.name || '', email: user.email || '', phone: user.phone || '',
        dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().slice(0, 10) : '',
        gender: user.gender || '', profileImage: user.profileImage || '', college: user.college || '',
        course: user.course || '', branch: user.branch || '', year: user.year || '', semester: user.semester || '',
        studentId: user.studentId || '', admissionYear: user.admissionYear || '', address: user.address || '',
        city: user.city || '', state: user.state || '', pincode: user.pincode || ''
    };
}

async function getStudentLibraryStats(studentId) {
    const [loans, requests] = await Promise.all([
        LendingRecord.find({ student: studentId }).populate('book').sort({ issueDate: -1 }),
        BookRequest.find({ student: studentId }).lean()
    ]);
    const validLoans = loans.filter(loan => loan.book);
    const finalizedLoans = validLoans.filter(loan => loan.status !== 'issued');
    return {
        totalBorrowed: validLoans.length,
        currentlyIssued: validLoans.filter(loan => loan.status === 'issued').length,
        pendingRequests: requests.filter(request => request.status === 'pending').length,
        approvedRequests: requests.filter(request => request.status === 'approved').length,
        returnedBooks: validLoans.filter(loan => loan.status === 'returned').length,
        overdueBooks: decoratedLoans.filter(loan => loan.status === 'issued' && loan.currentOverdueDays > 0).length,
        outstandingFine: finalizedLoans.reduce((sum, loan) => sum + getFinalFine(loan), 0)
    };
}

async function renderProfileError(res, req, formData, message, status = 400) {
    return res.status(status).render('student-profile', {
        student: formData,
        formData,
        age: calculateAge(formData.dateOfBirth),
        libraryStats: await getStudentLibraryStats(req.user.id),
        editMode: true,
        error: message,
        success: ''
    });
}

async function getStudentProfile(req, res) {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
            return res.status(400).render('error', { title: 'Invalid student.', message: 'We could not identify your account.' });
        }
        const user = await User.findOne({ _id: req.user.id, role: 'student' }).lean();
        if (!user) return res.status(404).render('error', { title: 'Student not found.', message: 'Your student profile could not be found.' });
        return res.render('student-profile', {
            student: user,
            formData: profileFormData(user),
            age: calculateAge(user.dateOfBirth),
            libraryStats: await getStudentLibraryStats(user._id),
            editMode: String(req.query.edit || '') === 'true',
            error: '',
            success: String(req.query.success || '')
        });
    } catch (error) {
        console.error('Student profile error:', error);
        return res.status(500).render('error', { title: 'Profile unavailable', message: 'Something went wrong. Please try again.' });
    }
}

async function postUpdateStudentProfile(req, res) {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
            return res.status(400).render('error', { title: 'Invalid student.', message: 'We could not identify your account.' });
        }
        const formData = profileFormData(req.body);
        const requiredFields = ['name', 'college', 'course', 'branch', 'year', 'semester', 'studentId', 'admissionYear'];
        if (requiredFields.some(field => !String(formData[field] || '').trim())) {
            return renderProfileError(res, req, formData, 'Please complete all required personal and academic fields.');
        }
        if (formData.phone && !/^[0-9+() -]{7,20}$/.test(formData.phone)) {
            return renderProfileError(res, req, formData, 'Please enter a valid phone number.');
        }
        const dateOfBirth = formData.dateOfBirth ? new Date(formData.dateOfBirth) : null;
        const age = calculateAge(dateOfBirth);
        if (formData.dateOfBirth && (Number.isNaN(dateOfBirth.getTime()) || age === null || age < 13 || age > 100)) {
            return renderProfileError(res, req, formData, 'Please enter a valid date of birth.');
        }
        const currentYear = new Date().getFullYear();
        if (!/^\d{4}$/.test(String(formData.admissionYear)) || Number(formData.admissionYear) < 1900 || Number(formData.admissionYear) > currentYear) {
            return renderProfileError(res, req, formData, 'Please enter a valid admission year.');
        }
        if (formData.pincode && !/^\d{4,10}$/.test(formData.pincode)) {
            return renderProfileError(res, req, formData, 'Please enter a valid pincode.');
        }
        await User.findOneAndUpdate(
            { _id: req.user.id, role: 'student' },
            { $set: {
                name: formData.name.trim(), phone: formData.phone, dateOfBirth, gender: formData.gender,
                profileImage: formData.profileImage, college: formData.college, course: formData.course,
                branch: formData.branch, year: formData.year, semester: formData.semester,
                studentId: formData.studentId, admissionYear: Number(formData.admissionYear), address: formData.address,
                city: formData.city, state: formData.state, pincode: formData.pincode
            } },
            { runValidators: true }
        );
        return res.redirect('/student/profile?success=' + encodeURIComponent('Profile updated successfully.') + '#profile');
    } catch (error) {
        console.error('Student profile update error:', error);
        return res.status(500).render('error', { title: 'Profile update failed', message: 'Something went wrong. Please try again.' });
    }
}

// POST /student/request-book - Create a book request record
const postBookRequest = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'student') {
            return res.status(403).send('403 Forbidden: Access denied.');
        }

        const { title, author, message, bookId } = req.body;
        const returnTo = String(req.body.returnTo || '').trim();
        const safeReturnTo = /^\/student\/books\/[a-f\d]{24}$/.test(returnTo) ? returnTo : '/student';
        const cleanTitle = String(title || '').trim();
        const cleanAuthor = String(author || '').trim();
        const cleanMessage = String(message || '').trim();

        if (!cleanTitle) {
            return res.redirect('/student?requestError=TitleRequired#book-request-section');
        }

        let catalogueBook = null;
        if (bookId) {
            if (!mongoose.Types.ObjectId.isValid(bookId)) {
                return res.redirect('/student?requestError=' + encodeURIComponent('Invalid book.') + '#book-request-section');
            }
            catalogueBook = await Book.findById(bookId).select('title author');
            if (!catalogueBook) {
                return res.redirect('/student?requestError=' + encodeURIComponent('Book not found.') + '#book-request-section');
            }
        }

        // Prevent duplicate pending requests for the same title by the same student
        const existingRequest = await BookRequest.findOne({
            student: req.user.id,
            $or: [
                catalogueBook ? { book: catalogueBook._id } : { title: { $regex: new RegExp('^' + cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } },
                { title: { $regex: new RegExp('^' + cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } }
            ],
            status: { $in: ['pending', 'approved'] }
        }).lean();

        if (existingRequest) {
            return res.redirect(`${safeReturnTo}?requestError=${encodeURIComponent('You already have an active request for this book.')}`);
        }

        // Resolve student name (denormalised for display)
        const studentName = req.user.name || 'Student';

        await BookRequest.create({
            student: req.user.id,
            studentName,
            book: catalogueBook ? catalogueBook._id : null,
            title: cleanTitle,
            author: cleanAuthor,
            message: cleanMessage,
            status: 'pending',
            requestDate: new Date()
        });

        res.redirect(`${safeReturnTo}?requested=true&bookTitle=${encodeURIComponent(cleanTitle)}#book-request-section`);
    } catch (error) {
        console.error('Error submitting book request:', error);
        res.redirect('/student?requestError=ServerFailure#book-request-section');
    }
};

function loanRedirect(res, message, anchor = 'issued-section') {
    return res.redirect(`/student?loanMessage=${encodeURIComponent(message)}#${anchor}`);
}

const postReturnBook = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'student') return res.status(403).send('403 Forbidden: Access denied.');
        const { loanId } = req.body;

        if (!loanId || !mongoose.Types.ObjectId.isValid(loanId)) {
            return loanRedirect(res, 'Invalid loan ID. Please refresh and try again.');
        }

        const loan = await LendingRecord.findOne({ _id: loanId, student: req.user.id, status: 'issued' }).populate('book');
        if (!loan) return loanRedirect(res, 'Active loan not found. It may have already been returned.');

        const returnDate = new Date();
        const { overdueDays, fine } = calculateLateFine(loan.dueDate, returnDate);
        loan.returnDate = returnDate;
        loan.overdueDays = overdueDays;
        loan.fine = fine;
        loan.status = 'returned';
        if (!loan.book) return loanRedirect(res, 'Book not found.');
        const book = await Book.findOneAndUpdate(
            { _id: loan.book._id, issuedCopies: { $gt: 0 }, availableCopies: { $lt: loan.book.totalCopies } },
            { $inc: { availableCopies: 1, issuedCopies: -1 } },
            { new: true, runValidators: true }
        );
        if (!book) return loanRedirect(res, 'Book status could not be updated. Please try again.');
        try {
            await loan.save();
        } catch (saveError) {
            await Book.updateOne({ _id: book._id }, { $inc: { availableCopies: -1, issuedCopies: 1 } });
            throw saveError;
        }

        return loanRedirect(
            res,
            fine > 0
                ? `Book returned successfully. Late fine: ₹${fine}. Please pay at the library desk.`
                : 'Book returned successfully. Thank you!'
        );
    } catch (error) {
        console.error('Error returning book:', error);
        return loanRedirect(res, 'Unable to return book. Please try again or contact the librarian.');
    }
};

const postRenewBook = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'student') return res.status(403).send('403 Forbidden: Access denied.');
        const { loanId } = req.body;

        if (!loanId || !mongoose.Types.ObjectId.isValid(loanId)) {
            return loanRedirect(res, 'Invalid loan ID. Please refresh and try again.');
        }

        const loan = await LendingRecord.findOne({ _id: loanId, student: req.user.id, status: 'issued' });
        const renewalError = getRenewalError(loan);
        if (renewalError) return loanRedirect(res, renewalError);

        loan.previousDueDate = loan.dueDate;
        loan.dueDate = addCalendarDays(loan.dueDate, RENEWAL_PERIOD_DAYS);
        loan.renewalCount += 1;
        await loan.save();
        return loanRedirect(res, `Book renewed successfully. New due date: ${loan.dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`);
    } catch (error) {
        console.error('Error renewing book:', error);
        return loanRedirect(res, 'Unable to renew book. Please try again.');
    }
};

const postMarkLost = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'librarian') return res.status(403).send('403 Forbidden: Librarian access required.');
        if (!req.body.loanId || !mongoose.Types.ObjectId.isValid(req.body.loanId)) {
            return res.status(400).send('Invalid loan.');
        }
        const loan = await LendingRecord.findOne({ _id: req.body.loanId, status: 'issued' }).populate('book');
        if (!loan || !loan.book) return res.status(404).send('Loan or book not found.');

        loan.status = 'lost';
        loan.lostDate = new Date();
        const suggestedFine = typeof loan.book.bookValue === 'number' ? loan.book.bookValue + LATE_FINE_BASE : 0;
        const finalFineInput = String(req.body.finalFine ?? '').trim();
        const finalFine = finalFineInput === '' ? suggestedFine : Number(finalFineInput);
        if (!Number.isFinite(finalFine) || finalFine < 0) return res.status(400).send('Final fine must be a valid non-negative number.');
        loan.suggestedFine = suggestedFine;
        loan.lostFine = finalFine;
        loan.fineType = 'lost';
        await loan.save();
        await Book.findOneAndUpdate(
            { _id: loan.book._id, issuedCopies: { $gt: 0 }, totalCopies: { $gt: 0 } },
            { $inc: { issuedCopies: -1, totalCopies: -1 } },
            { runValidators: true }
        );
        return res.status(200).send(loan.lostFine === null ? 'Book marked lost. Add book value to calculate the fine.' : `Book marked lost. Fine: ₹${loan.lostFine}.`);
    } catch (error) {
        console.error('Error marking book lost:', error);
        return res.status(500).send('Unable to mark book lost.');
    }
};

const postMarkDamaged = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'librarian') return res.status(403).send('403 Forbidden: Librarian access required.');
        if (!req.body.loanId || !mongoose.Types.ObjectId.isValid(req.body.loanId)) {
            return res.status(400).send('Invalid loan.');
        }
        const damageLevel = String(req.body.damageLevel || '').toUpperCase();
        if (!['MINOR', 'MODERATE', 'SEVERE'].includes(damageLevel)) return res.status(400).send('Damage level must be MINOR, MODERATE, or SEVERE.');
        const loan = await LendingRecord.findOne({ _id: req.body.loanId, status: 'issued' }).populate('book');
        if (!loan || !loan.book) return res.status(404).send('Loan or book not found.');

        loan.status = 'damaged';
        loan.damageLevel = damageLevel;
        loan.damageDate = new Date();
        const suggestedFine = calculateDamageFine(loan.book.bookValue, damageLevel) || 0;
        const finalFineInput = String(req.body.finalFine ?? '').trim();
        const finalFine = finalFineInput === '' ? suggestedFine : Number(finalFineInput);
        if (!Number.isFinite(finalFine) || finalFine < 0) return res.status(400).send('Final fine must be a valid non-negative number.');
        loan.suggestedFine = suggestedFine;
        loan.damageFine = finalFine;
        loan.fineType = 'damaged';
        await loan.save();
        await Book.findOneAndUpdate(
            { _id: loan.book._id, issuedCopies: { $gt: 0 }, totalCopies: { $gt: 0 } },
            { $inc: { issuedCopies: -1, totalCopies: -1 } },
            { runValidators: true }
        );
        return res.status(200).send(loan.damageFine === null ? 'Book marked damaged. Add book value to calculate the fine.' : `Book marked damaged. Fine: ₹${loan.damageFine}.`);
    } catch (error) {
        console.error('Error marking book damaged:', error);
        return res.status(500).send('Unable to mark book damaged.');
    }
};

module.exports = {
    getStudentDashboard,
    getStudentProfile,
    postUpdateStudentProfile,
    getStudentBooks,
    getStudentBookDetails,
    postBookRequest,
    postReturnBook,
    postRenewBook,
    postMarkLost,
    postMarkDamaged,
    addCalendarDays,
    calculateLateFine,
    calculateDamageFine,
    getRenewalError,
    decorateLoan
};

