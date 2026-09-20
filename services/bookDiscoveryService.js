/**
 * Book Discovery Service
 * STEP 1: External Book Discovery Foundation
 * 
 * Discovers real books from external book catalogues based on student search queries.
 * Primary source: Open Library Search API
 * Fallback source: Google Books API
 * 
 * External API books are NEVER inserted into the MongoDB Book collection.
 */

// Helper to clean conversational / intent prefixes from user queries
function cleanSearchQuery(rawQuery) {
    if (!rawQuery || typeof rawQuery !== 'string') return '';
    let q = rawQuery.trim();

    // Strip common natural-language search prefixes
    q = q.replace(/^(i want to read|i want to learn|i want to study|i want books on|i want books about|recommend books for|suggest books for|give me books on|give me books for|books on|books for|books about|search for|find books on|find books for|find)\s+/i, '');

    // Hinglish / Hindi phrases
    q = q.replace(/^mujhe\s+/i, '');
    q = q.replace(/\s+(seekhna hai|padhna hai|chahiye|batao|karo|books)$/i, '');

    // Strip trailing punctuation
    q = q.replace(/[?!.]+$/, '').trim();

    return q || rawQuery.trim();
}

function normalizeSearchText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function rankDiscoveryResult(result, query) {
    const queryTokens = normalizeSearchText(query)
        .split(' ')
        .filter(token => token.length > 1);
    if (queryTokens.length === 0) return 0;

    const searchableText = normalizeSearchText([
        result.title,
        result.subtitle,
        result.author,
        result.publisher,
        result.edition,
        result.volume,
        result.category,
        ...(result.subjects || [])
    ].join(' '));

    return queryTokens.reduce((score, token) => score + (searchableText.includes(token) ? 1 : 0), 0);
}

function rankAndLimitResults(results, query, limit) {
    return results
        .map((book, index) => ({ book, index, score: rankDiscoveryResult(book, query) }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, limit)
        .map(entry => entry.book);
}

function buildDiscoveryQueries(query) {
    const normalizedQuery = query.trim();
    const genericTerms = new Set([
        'book', 'books', 'class', 'grade', 'standard', 'concepts', 'concept',
        'guide', 'guides', 'study', 'studies', 'preparation', 'of', 'for', 'the'
    ]);
    const compactQuery = normalizedQuery
        .split(/\s+/)
        .filter(token => !genericTerms.has(token.toLowerCase()))
        .join(' ')
        .trim();

    const tokens = compactQuery.split(/\s+/).filter(token => token.length > 1);
    const adjacentQueries = tokens.slice(0, -1).map((token, index) =>
        `${token} ${tokens[index + 1]}`
    );
    const distinctiveTerms = tokens.filter(token => token.length > 3);

    return [...new Set([
        normalizedQuery,
        compactQuery,
        ...adjacentQueries,
        ...distinctiveTerms
    ].filter(Boolean))].slice(0, 6);
}

function mergeDiscoveryResults(results, query, limit) {
    const seen = new Set();
    const merged = [];

    for (const book of results.flat()) {
        const identity = `${normalizeSearchText(book.title)}::${normalizeSearchText(book.author)}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        merged.push(book);
    }

    return rankAndLimitResults(merged, query, limit);
}

/**
 * Fetch with strict timeout to prevent slow network calls from hanging the request
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return res;
    } catch (err) {
        clearTimeout(timeoutId);
        return null;
    }
}

/**
 * PRIMARY: Search Open Library Search API
 * Returns normalized book metadata array
 */
async function searchOpenLibrary(query, limit = 8) {
    try {
        const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}`;
        const res = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': 'LibraryManagementApp/1.0 (StudentDiscovery; contact: support@librarymanagement.local)'
            }
        }, 5000);

        if (!res || res.status !== 200) {
            return [];
        }

        const data = await res.json();
        if (!data || !data.docs || !Array.isArray(data.docs) || data.docs.length === 0) {
            return [];
        }

        // Normalize Open Library docs
        const normalized = [];
        for (const doc of data.docs) {
            if (!doc.title || typeof doc.title !== 'string') continue;

            // Extract author string from available fields
            let authorName;
            if (Array.isArray(doc.author_name) && doc.author_name.length > 0) {
                authorName = doc.author_name.slice(0, 3).join(', ');
            } else if (Array.isArray(doc.authors) && doc.authors.length > 0) {
                authorName = doc.authors.map(a => a.name).filter(Boolean).join(', ');
            }

            // Extract first valid ISBN
            const isbn = (Array.isArray(doc.isbn) && doc.isbn.length > 0) ? String(doc.isbn[0]) : undefined;

            // External identifier
            const externalId = doc.key || (Array.isArray(doc.edition_key) ? doc.edition_key[0] : undefined);

            // Cover URL
            const coverId = doc.cover_i ? String(doc.cover_i) : undefined;
            const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null;

            // Category / Subject
            const category = (Array.isArray(doc.subject) && doc.subject.length > 0) ? doc.subject[0] : undefined;
            const subjects = Array.isArray(doc.subject) ? doc.subject.slice(0, 8) : [];
            const publishers = Array.isArray(doc.publisher) ? doc.publisher.slice(0, 3) : [];
            const publishYears = Array.isArray(doc.publish_year) ? doc.publish_year.filter(Boolean) : [];
            const languages = Array.isArray(doc.language) ? doc.language.slice(0, 5) : [];

            normalized.push({
                title: doc.title.trim(),
                subtitle: doc.subtitle ? String(doc.subtitle).trim() : undefined,
                author: authorName || 'Author not specified',
                isbn,
                externalId,
                source: 'openlibrary',
                coverId,
                coverUrl,
                category,
                subjects,
                publisher: publishers[0],
                publishers,
                edition: doc.edition_name ? String(doc.edition_name).trim() : undefined,
                volume: doc.volume ? String(doc.volume).trim() : undefined,
                pageCount: doc.number_of_pages_median || undefined,
                languages,
                publishDate: Array.isArray(doc.publish_date) ? doc.publish_date[0] : undefined,
                publishYears,
                firstPublishYear: doc.first_publish_year || undefined
            });
        }

        return rankAndLimitResults(normalized, query, limit);
    } catch (err) {
        console.warn('Open Library discovery error:', err.message);
        return [];
    }
}

/**
 * FALLBACK: Search Google Books API
 * Used only when Open Library fails or returns insufficient results
 */
async function searchGoogleBooks(query, limit = 8) {
    try {
        let apiUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${limit}`;
        if (process.env.GOOGLE_BOOKS_API_KEY) {
            apiUrl += `&key=${encodeURIComponent(process.env.GOOGLE_BOOKS_API_KEY)}`;
        }

        const res = await fetchWithTimeout(apiUrl, {
            headers: {
                'User-Agent': 'LibraryManagementApp/1.0'
            }
        }, 4000);

        if (!res || res.status !== 200) {
            return [];
        }

        const data = await res.json();
        if (!data || !data.items || !Array.isArray(data.items) || data.items.length === 0) {
            return [];
        }

        const normalized = [];
        for (const item of data.items) {
            const vi = item.volumeInfo || {};
            if (!vi.title || typeof vi.title !== 'string') continue;

            let authorName;
            if (Array.isArray(vi.authors) && vi.authors.length > 0) {
                authorName = vi.authors.slice(0, 3).join(', ');
            }

            let isbn;
            if (Array.isArray(vi.industryIdentifiers) && vi.industryIdentifiers.length > 0) {
                isbn = vi.industryIdentifiers[0].identifier;
            }

            const rawImg = vi.imageLinks?.thumbnail || vi.imageLinks?.smallThumbnail;
            const coverUrl = rawImg ? rawImg.replace(/^http:\/\//i, 'https://') : null;
            const category = Array.isArray(vi.categories) && vi.categories.length > 0 ? vi.categories[0] : undefined;
            const subjects = Array.isArray(vi.categories) ? vi.categories.slice(0, 8) : [];
            const firstPublishYear = vi.publishedDate ? parseInt(vi.publishedDate.slice(0, 4), 10) : undefined;

            normalized.push({
                title: vi.title.trim(),
                subtitle: vi.subtitle ? String(vi.subtitle).trim() : undefined,
                author: authorName || 'Author not specified',
                isbn,
                externalId: item.id || undefined,
                source: 'googlebooks',
                coverId: undefined,
                coverUrl,
                category,
                subjects,
                publisher: vi.publisher,
                edition: vi.edition || vi.printType,
                volume: vi.volumeNumber ? String(vi.volumeNumber) : undefined,
                pageCount: vi.pageCount,
                language: vi.language,
                description: vi.description,
                publishDate: vi.publishedDate,
                firstPublishYear
            });
        }

        return rankAndLimitResults(normalized, query, limit);
    } catch (err) {
        console.warn('Google Books fallback discovery error:', err.message);
        return [];
    }
}

/**
 * Discover real external books based on student query.
 * 
 * Flow:
 * 1. Clean query
 * 2. Try Open Library Search API (Primary)
 * 3. If Open Library returns insufficient results (< 2 books) or fails, try Google Books (Fallback)
 * 4. Return normalized results
 * 
 * Never throws an error; returns empty array if no results are found.
 */
async function discoverBooks(rawQuery, limit = 8) {
    const cleanQuery = cleanSearchQuery(rawQuery);
    if (!cleanQuery) {
        return { query: '', source: 'none', books: [] };
    }

    const searchQueries = buildDiscoveryQueries(cleanQuery);

    // 1. Primary: Open Library Search API. Retry with a query-derived compact
    // form when generic educational/search wording is too restrictive.
    const openLibraryResults = await Promise.all(
        searchQueries.map(query => searchOpenLibrary(query, limit))
    );
    const openLibBooks = mergeDiscoveryResults(openLibraryResults, cleanQuery, limit);

    if (openLibBooks && openLibBooks.length >= 2) {
        return {
            query: cleanQuery,
            source: 'openlibrary',
            books: openLibBooks.slice(0, limit)
        };
    }

    // 2. Fallback: Google Books API (only if Open Library returns insufficient results)
    const googleBookResults = await Promise.all(
        searchQueries.map(query => searchGoogleBooks(query, limit))
    );
    const googleBooks = mergeDiscoveryResults(googleBookResults, cleanQuery, limit);

    if (googleBooks && googleBooks.length > 0) {
        return {
            query: cleanQuery,
            source: 'googlebooks',
            books: googleBooks.slice(0, limit)
        };
    }

    // 3. If Google Books also had nothing but Open Library had 1 result, return that
    if (openLibBooks && openLibBooks.length > 0) {
        return {
            query: cleanQuery,
            source: 'openlibrary',
            books: openLibBooks.slice(0, limit)
        };
    }

    // 4. Return empty discovery state
    return {
        query: cleanQuery,
        source: 'none',
        books: []
    };
}

module.exports = {
    cleanSearchQuery,
    searchOpenLibrary,
    searchGoogleBooks,
    discoverBooks
};
