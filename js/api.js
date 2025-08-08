import { showError } from './ui.js';
import { getCachedData, setCachedData, createPreCacheCitations } from './cache.js';

// Obfuscated email construction for Crossref API
const emailParts = ['dbag', 'ory', '@', 'icl', 'oud.com'];

// Rate limiter for Crossref API
class RateLimiter {
    constructor(maxConcurrent = 5) {
        this.maxConcurrent = maxConcurrent;
        this.currentRequests = 0;
        this.queue = [];
    }

    async add(fn) {
        if (this.currentRequests >= this.maxConcurrent) {
            await new Promise(resolve => this.queue.push(resolve));
        }

        this.currentRequests++;
        try {
            return await fn();
        } finally {
            this.currentRequests--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next();
            }
        }
    }
}

// Rate limiter instance
const rateLimiter = new RateLimiter(5);

const getEmail = () => emailParts.join('');
const emailParam = `mailto=${encodeURIComponent(getEmail())}`;

async function getCitingPubs(doi, offset = 0, limit = 20) {
    // Convert arXiv ID to DataCite DOI format if needed
    const arxivMatch = doi.match(/^(?:arxiv:|10\.48550\/arXiv\.?)(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
    const isArxiv = !!arxivMatch;
    if (arxivMatch) {
        doi = `10.48550/arXiv.${arxivMatch[1]}`;
    }

    // Check cache using DOI directly - before even getting the title
    let cachedDataByDoi = getCachedData(doi);
    if (cachedDataByDoi && Array.isArray(cachedDataByDoi['cited-by'])) {
        console.log(`getCitingPubs: Cache HIT for DOI: ${doi}, Total: ${cachedDataByDoi['cited-by'].length}, Offset: ${offset}`);
        const totalCount = cachedDataByDoi['cited-by'].length;
        const paginatedData = cachedDataByDoi['cited-by'].slice(offset, offset + limit);
        return {
            status: 'SUCCESS',
            data: paginatedData,
            totalCount,
            hasMore: offset + limit < totalCount,
            nextOffset: offset + limit < totalCount ? offset + limit : null
        };
    } else {
        console.log(`getCitingPubs: Cache MISS for DOI: ${doi}`);
    }

    // First get the title for this DOI - after checking cache by DOI
    const title = await getTitle(doi);


    // If no cached citations found by DOI, check by title if available (fallback)
    if (title && title !== "Unknown Title") {
        let cachedDataByTitle = getCachedData(title); // Check cache by title as fallback
        if (cachedDataByTitle && Array.isArray(cachedDataByTitle['cited-by'])) {
            console.log(`getCitingPubs: Cache HIT for title (fallback): ${title}, Total: ${cachedDataByTitle['cited-by'].length}, Offset: ${offset}`);
            const totalCount = cachedDataByTitle['cited-by'].length;
            const paginatedData = cachedDataByTitle['cited-by'].slice(offset, offset + limit);
            return {
                status: 'SUCCESS',
                data: paginatedData,
                totalCount,
                hasMore: offset + limit < totalCount,
                nextOffset: offset + limit < totalCount ? offset + limit : null
            };
        } else {
            console.log(`getCitingPubs: Cache MISS for title (fallback): ${title}`);
        }
    }

    try {
        // Using a CORS proxy to bypass browser restrictions for OpenCitations API
        const targetUrl = `https://opencitations.net/index/coci/api/v1/citations/${encodeURIComponent(doi)}`;
        // Using AllOrigins as a public CORS proxy. Consider hosting your own for production.
        const proxyBase = 'https://api.allorigins.win/raw?url=';
        const proxiedUrl = `${proxyBase}${encodeURIComponent(targetUrl)}`;
        const response = await rateLimiter.add(() => fetch(proxiedUrl));

        if (!response.ok) {
            console.error(`OpenCitations API error: ${response.status} for DOI ${doi}`);
            let errorMessage = `Failed to fetch data from OpenCitations (Status: ${response.status})`;

            if (response.status === 500) {
                errorMessage = `CORS proxy service is temporarily unavailable. This is a known issue with the AllOrigins service. Please try again later or contact support.`;
            }

            return {
                status: 'API_ERROR',
                data: [],
                totalCount: 0,
                hasMore: false,
                nextOffset: null,
                message: errorMessage
            };
        }

        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (jsonError) {
            console.log('DEBUG: Entered jsonError catch block.'); // Simple entry log
            // Temporarily commenting out the more complex logic to isolate the issue
            // console.error(`Failed to parse JSON response from OpenCitations (via proxy) for DOI ${doi}. Status: ${response.status}. Raw response:`, responseText);
            // console.error('JSON parsing error details:', jsonError);
            // console.log(`Type of responseText: ${typeof responseText}, Value:`, responseText);

            let userMessage = `DEBUG: JSON parsing failed. Raw response was: ${responseText}. Check console for details.`;

            // if (typeof responseText === 'string') {
            //     if (responseText.includes("HTTP status code 500")) {
            //         userMessage = `OpenCitations API returned an internal server error (500) for DOI ${doi}. This is an issue with the API itself. Raw error: ${responseText}`;
            //     } else {
            //          userMessage = `Failed to parse response from OpenCitations. Server returned non-JSON data (Proxy Status: ${response.status}). Raw: ${responseText}`;
            //     }
            // } else {
            //     userMessage = `Received an unexpected non-string response from the server (Proxy Status: ${response.status}). Type: ${typeof responseText}. Check console.`;
            //     console.error("responseText was not a string. This is unexpected.", responseText);
            // }
            return {
                status: 'API_ERROR',
                data: [],
                totalCount: 0,
                hasMore: false,
                nextOffset: null,
                message: userMessage
            };
        }
        console.log(`getCitingPubs: Fetched citations from OpenCitations API for DOI: ${doi}, Status: ${response.status}, Count: ${data.length}`);
        if (data.length > 0) {
            // Transform the data to use the citing DOI as our reference
            const transformedData = data.map(citation => ({
                ...citation,
                citing: citation.citing.split(' ').find(id => id.startsWith('doi:'))?.substring(4) || citation.citing
            }));

            // Cache the full transformed dataset
            if (title && title !== "Unknown Title") {
                // Get existing cache data to preserve the DOI
                const existingData = getCachedData(doi) || {};
                const cacheData = {
                    ...existingData,
                    doi, // Ensure DOI is set
                    'cited-by': transformedData
                };
                // Cache under DOI
                setCachedData(doi, cacheData);
            } else {
                // If no title, at least cache under DOI
                setCachedData(doi, {
                    doi,
                    'cited-by': transformedData
                });
            }

            // Return paginated results
            const totalCount = transformedData.length;
            const paginatedData = transformedData.slice(offset, offset + limit);

            return {
                status: 'SUCCESS',
                data: paginatedData,
                totalCount,
                hasMore: offset + limit < totalCount,
                nextOffset: offset + limit < totalCount ? offset + limit : null
            };
        } else {
            // OpenCitations returned an empty array for citations
            console.log(`getCitingPubs: OpenCitations returned no citations for DOI: ${doi}`);

            // "Cache" this empty result to prevent repeated API calls for known empty sets
            if (title && title !== "Unknown Title") {
                const existingData = getCachedData(doi) || {};
                setCachedData(doi, { ...existingData, doi, 'cited-by': [] });
            } else {
                setCachedData(doi, { doi, 'cited-by': [] });
            }

            // Specific handling for arXiv if it was one (arxivMatch is from line 41)
            if (arxivMatch && arxivMatch[1]) { // Check if arxivMatch is not null and has the expected capture group
                console.log(`No citation data available for arXiv paper: ${arxivMatch[1]}`);
                return {
                    status: 'NO_DATA',
                    data: [],
                    totalCount: 0,
                    hasMore: false,
                    nextOffset: null,
                    message: `OpenCitations has no data for this arXiv paper (${arxivMatch[1]}), likely because it has not been published in a peer-reviewed venue. Try searching on <a href=https://scholar.google.com>Google Scholar</a> instead.`
                };
            } else {
                // Generic NO_DATA for non-arXiv DOIs if OpenCitations returns empty
                return {
                    status: 'NO_DATA',
                    data: [],
                    totalCount: 0,
                    hasMore: false,
                    nextOffset: null
                };
            }
        }
    } catch (error) {
        console.error('Error fetching citations:', error);
        let errorMessage = 'Failed to connect to OpenCitations API. Please try again later.';

        if (error.message.includes('NetworkError') || error.message.includes('CORS')) {
            errorMessage = 'CORS proxy service is experiencing issues. This is a temporary problem with the AllOrigins service. Please try again in a few minutes.';
        }

        return {
            status: 'API_ERROR',
            data: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            message: errorMessage
        };
    }
}

async function getTitle(doi) {
    // Check cache by DOI
    let cachedData = getCachedData(doi);
    if (cachedData && cachedData.title) {
        return cachedData.title;
    }

    const arxivMatch = doi.match(/^(?:arxiv:|10\.48550\/arXiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
    if (arxivMatch) {
        const arxivId = arxivMatch[1];
        try {
            const response = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`);
            const text = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            const title = xmlDoc.querySelector('entry > title')?.textContent?.trim();
            if (title) {
                // Cache by DOI
                setCachedData(doi, { title });
                return title;
            }
            return "Unknown Title";
        } catch (error) {
            console.error('Error fetching arXiv title:', error);
            return "Unknown Title";
        }
    }

    try {
        const encodedDoi = encodeURIComponent(doi.replace(/\s+/g, ''));
        const url = `https://api.crossref.org/works/${encodedDoi}?${emailParam}`;
        const response = await rateLimiter.add(() => fetch(url));
        const data = await response.json();

        if (response.ok) {
            const title = data?.message?.title?.[0];
            if (title) {
                // Cache by DOI
                setCachedData(doi, { title });
                return title;
            }
        }

        console.log(`No title found for DOI: ${doi}`);
        return "Unknown Title";
    } catch (error) {
        console.error('Error fetching title:', error);
        return "Unknown Title";
    }
}

async function handleCrossrefResponse(response, functionName) {
    if (!response.ok) {
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || '60';
            const message = `Rate limit exceeded. Please try again in ${retryAfter} seconds.`;
            showError(message);
            throw new Error(message);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
}

async function handleCrossrefError(error, functionName) {
    console.error(`Error in ${functionName}:`, error);
    if (!error.message.includes('Rate limit exceeded')) {
        showError(`Error in ${functionName}. Please try again.`);
    }
    throw error;
}

// Helper function to load more citations
async function loadMoreCitations(doi, offset) {
    return await getCitingPubs(doi, offset);
}

// Create preCacheCitations function with required dependencies
const preCacheCitations = createPreCacheCitations(getTitle, getCitingPubs);

export {
    getTitle,
    getCitingPubs,
    loadMoreCitations,
    rateLimiter,
    handleCrossrefResponse,
    handleCrossrefError,
    preCacheCitations
};