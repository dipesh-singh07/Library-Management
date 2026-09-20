/**
 * Book Cover Service
 * Fetches verified, accurate external book covers with Open Library Search API (primary)
 * and Google Books API (fallback).
 * Strictly verifies matches and rejects unrelated covers, falling back to null ("Cover not available").
 */

// In-memory server-side cache for external book covers to avoid redundant API calls
const coverCache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for valid covers
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for missing covers to avoid hammering APIs

// Helper to normalize strings for comparison
function normalize(str) {
    return (str || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Extract non-stopword tokens
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'is', 'it', 'from',
    'vol', 'volume', 'issue', 'edition', 'ed', 'part', 'pt', 'book', 'series', 'definitive', 'guide', 'introduction'
]);

function getKeywords(str, includeSecondary = false) {
    return normalize(str)
        .split(' ')
        .filter(w => {
            if (w.length <= 1) return false;
            if (!includeSecondary && STOP_WORDS.has(w)) return false;
            return true;
        });
}

function getSearchTitles(title) {
    const withoutParens = (title || '').replace(/\([^)]*\)/g, '').trim();
    const list = [];
    if (withoutParens.includes(':')) {
        const primary = withoutParens.split(':')[0].trim();
        if (primary.length > 2) list.push(primary);
    }
    list.push(withoutParens.replace(/[:\-#]/g, ' ').replace(/\s+/g, ' ').trim());
    return [...new Set(list)];
}

/**
 * Score a candidate result against requested book parameters.
 * Returns a confidence score (0 to 1.5+). Scores below 0.65 are rejected.
 */
function scoreCandidate(req, cand) {
    const cleanReqTitle = req.title.replace(/\([^)]*\)/g, '').trim();
    const primaryReqTitle = cleanReqTitle.includes(':') ? cleanReqTitle.split(':')[0].trim() : cleanReqTitle;
    const candTitle = (cand.title || '') + ' ' + (cand.subtitle || '');

    const reqKeywords = getKeywords(cleanReqTitle);
    const primaryKeywords = getKeywords(primaryReqTitle);
    const candKeywords = getKeywords(candTitle);

    if (reqKeywords.length === 0 || candKeywords.length === 0) return 0;

    const candSet = new Set(candKeywords);

    // Calculate overlap against both full title and primary title
    let fullOverlap = 0;
    for (const w of reqKeywords) {
        if (candSet.has(w)) fullOverlap++;
    }

    let primaryOverlap = 0;
    for (const w of primaryKeywords) {
        if (candSet.has(w)) primaryOverlap++;
    }

    const fullRecall = fullOverlap / reqKeywords.length;
    const primaryRecall = primaryOverlap / primaryKeywords.length;
    const recall = Math.max(fullRecall, primaryRecall);
    const precision = fullOverlap / candKeywords.length;

    // Reject if too few requested keywords match
    if (recall < 0.4) return 0;

    const isShortTitle = primaryKeywords.length <= 2;
    let authorMatch = false;
    let authorMismatch = false;

    if (req.author && cand.authors && cand.authors.length > 0) {
        const reqAuthWords = normalize(req.author).split(' ').filter(w => w.length > 2);
        const candAuthText = normalize(cand.authors.join(' '));

        for (const aw of reqAuthWords) {
            if (candAuthText.includes(aw)) {
                authorMatch = true;
                break;
            }
        }

        if (!authorMatch) {
            authorMismatch = true;
        }
    }

    // STRICT REJECTION:
    // If author does NOT match and title is short (<= 2 keywords) or series is specified:
    // This prevents "Samrat" matching political biographies, or "Nagraj" matching spreadsheet textbooks!
    if (authorMismatch && (isShortTitle || req.series)) {
        return 0;
    }

    // If series is specified (e.g. "Raj Comics", "Nagraj"), candidate MUST mention series or character
    if (req.series) {
        const seriesWords = normalize(req.series).split(' ').filter(w => w.length > 2);
        const candFullText = normalize(candTitle + ' ' + (cand.authors || []).join(' '));
        const hasSeriesToken = seriesWords.some(sw => candFullText.includes(sw));
        if (!hasSeriesToken) {
            return 0; // Reject if series context is completely absent
        }
    }

    let score = recall * 0.7 + precision * 0.3;

    if (authorMatch) {
        score += 0.35;
    } else if (authorMismatch) {
        if (recall < 0.85) return 0;
        score -= 0.35;
    }

    return score;
}

/**
 * Fetch with strict timeout to prevent long page hangs
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
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
 * 1. Open Library API Search & Cover Fetcher
 */
async function fetchOpenLibraryCover(title, author, isbn, series) {
    const searchTitles = getSearchTitles(title);
    const req = { title, author, isbn, series };

    const authorList = author ? author.split(/&|,/).map(a => a.trim()).filter(Boolean) : [];

    const queries = [];
    for (const t of searchTitles) {
        for (const a of authorList.slice(0, 2)) {
            queries.push(`https://openlibrary.org/search.json?q=${encodeURIComponent(t + ' ' + a)}&limit=6`);
        }
        queries.push(`https://openlibrary.org/search.json?title=${encodeURIComponent(t)}&limit=6`);
    }

    for (const searchUrl of queries) {
        try {
            const res = await fetchWithTimeout(searchUrl, {
                headers: {
                    'User-Agent': 'LibraryManagementApp/1.0 (StudentReadingPath; contact: support@librarymanagement.local)'
                }
            }, 4500);

            if (res && res.status === 200) {
                const data = await res.json();
                if (data.docs && data.docs.length > 0) {
                    let bestDoc = null;
                    let highestScore = 0;

                    for (const doc of data.docs) {
                        if (!doc.cover_i) continue; // must have a cover identifier

                        const cand = {
                            title: doc.title,
                            subtitle: doc.subtitle,
                            authors: doc.author_name || []
                        };

                        const score = scoreCandidate(req, cand);
                        if (score >= 0.65 && score > highestScore) {
                            highestScore = score;
                            bestDoc = doc;
                        }
                    }

                    if (bestDoc) {
                        return `https://covers.openlibrary.org/b/id/${bestDoc.cover_i}-M.jpg`;
                    }
                }
            }
        } catch (err) {
            // Continue to next query
        }
    }

    return null;
}

/**
 * 2. Google Books API Fallback Fetcher
 */
async function fetchGoogleBooksCover(title, author, isbn, series) {
    try {
        const cleanTitle = title.replace(/[:\-#()]/g, ' ').replace(/\s+/g, ' ').trim();
        const req = { title: cleanTitle, author, isbn, series };
        const cleanAuthor = author ? author.split(/&|,/)[0].trim() : '';

        let query = `intitle:${cleanTitle}`;
        if (cleanAuthor) {
            query += ` inauthor:${cleanAuthor}`;
        }

        let apiUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`;
        if (process.env.GOOGLE_BOOKS_API_KEY) {
            apiUrl += `&key=${encodeURIComponent(process.env.GOOGLE_BOOKS_API_KEY)}`;
        }

        const res = await fetchWithTimeout(apiUrl, {
            headers: {
                'User-Agent': 'LibraryManagementApp/1.0'
            }
        }, 3500);

        if (res && res.status === 200) {
            const data = await res.json();
            if (data.items && data.items.length > 0) {
                let bestItem = null;
                let highestScore = 0;

                for (const item of data.items) {
                    const volumeInfo = item.volumeInfo || {};
                    const thumbnail = volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail;
                    if (!thumbnail) continue;

                    const cand = {
                        title: volumeInfo.title,
                        subtitle: volumeInfo.subtitle,
                        authors: volumeInfo.authors || []
                    };

                    const score = scoreCandidate(req, cand);
                    if (score >= 0.65 && score > highestScore) {
                        highestScore = score;
                        bestItem = item;
                    }
                }

                if (bestItem && bestItem.volumeInfo.imageLinks) {
                    const imgUrl = bestItem.volumeInfo.imageLinks.thumbnail || bestItem.volumeInfo.imageLinks.smallThumbnail;
                    return imgUrl.replace(/^http:\/\//i, 'https://');
                }
            }
        }
    } catch (err) {
        // Fail gracefully and return null
    }

    return null;
}

/**
 * Main function: Get verified book cover image URL
 * Priority:
 * 1. Cache
 * 2. Open Library Search API
 * 3. Google Books API Fallback
 * 4. Return null ("Cover not available") if no verified match found
 */
async function getBookCover(title, author = '', isbn = '', series = '') {
    if (!title || !title.trim()) return null;

    const cacheKey = `${normalize(title)}::${normalize(author)}::${normalize(series)}`;
    const now = Date.now();

    if (coverCache.has(cacheKey)) {
        const cached = coverCache.get(cacheKey);
        const ttl = cached.coverUrl ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
        if (now - cached.timestamp < ttl) {
            return cached.coverUrl;
        }
    }

    // 1. Try Open Library
    let coverUrl = await fetchOpenLibraryCover(title, author, isbn, series);

    // 2. Fallback to Google Books if Open Library did not return a suitable cover
    if (!coverUrl) {
        coverUrl = await fetchGoogleBooksCover(title, author, isbn, series);
    }

    // 3. Cache the result (even if null, to avoid hammering APIs repeatedly)
    coverCache.set(cacheKey, {
        coverUrl,
        timestamp: now
    });

    return coverUrl;
}

module.exports = {
    getBookCover,
    scoreCandidate
};
