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

async function getCitingPubs(doi) {
    // Convert arXiv ID to DataCite DOI format if needed
    const arxivMatch = doi.match(/^(?:arxiv:|10\.48550\/arXiv\.?)(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
    const isArxiv = !!arxivMatch;
    if (arxivMatch) {
        doi = `10.48550/arXiv.${arxivMatch[1]}`;
    }

    // Check cache using DOI directly - before even getting the title
    let cachedDataByDoi = getCachedData(doi);
    if (cachedDataByDoi && Array.isArray(cachedDataByDoi['cited-by'])) {
        console.log(`getCitingPubs: Cache HIT for DOI: ${doi}, Count: ${cachedDataByDoi['cited-by'].length}`);
        return {
            status: 'SUCCESS',
            data: cachedDataByDoi['cited-by']
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
            console.log(`getCitingPubs: Cache HIT for title (fallback): ${title}, Count: ${cachedDataByTitle['cited-by'].length}`);
            return {
                status: 'SUCCESS',
                data: cachedDataByTitle['cited-by']
            };
        } else {
            console.log(`getCitingPubs: Cache MISS for title (fallback): ${title}`);
        }
    }

    try {
        const baseUrl = 'https://opencitations.net/index/coci/api/v1/citations/';
        const response = await rateLimiter.add(() => fetch(`${baseUrl}${encodeURIComponent(doi)}`));
        
        if (!response.ok) {
            console.error(`OpenCitations API error: ${response.status} for DOI ${doi}`);
            return {
                status: 'API_ERROR',
                data: [],
                message: `Failed to fetch data from OpenCitations (Status: ${response.status})`
            };
        }

        const data = await response.json();
        console.log(`getCitingPubs: Fetched citations from OpenCitations API for DOI: ${doi}, Status: ${response.status}, Count: ${data.length}`);
        if (data.length > 0) {
            // Transform the data to use the citing DOI as our reference
            const transformedData = data.map(citation => ({
                ...citation,
                citing: citation.citing.split(' ').find(id => id.startsWith('doi:'))?.substring(4) || citation.citing
            }));
            
            // Cache the transformed data if we have a title
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
            
            return {
                status: 'SUCCESS',
                data: transformedData
            };
        }

        // No citations found with any format
        console.log(`No citation data available for arXiv paper: ${arxivMatch[1]}`);
        
        return {
            status: 'NO_DATA',
            data: [],
            message: `OpenCitations has no data for this arXiv paper (${arxivMatch[1]}), likely because it has not been published in a peer-reviewed venue. Try searching on <a href=https://scholar.google.com>Google Scholar</a> instead.`
        };
    } catch (error) {
        console.error('Error fetching citations:', error);
        return {
            status: 'API_ERROR',
            data: [],
            message: 'Failed to connect to OpenCitations API. Please try again later.'
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

// Create preCacheCitations function with required dependencies
const preCacheCitations = createPreCacheCitations(getTitle, getCitingPubs);

export {
    getTitle,
    getCitingPubs,
    rateLimiter,
    handleCrossrefResponse,
    handleCrossrefError,
    preCacheCitations
};