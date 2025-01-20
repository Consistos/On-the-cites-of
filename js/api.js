import { getCachedData, setCachedData } from './cache.js';

// Obfuscated email construction for Crossref API
const emailParts = ['dbag', 'ory', '@', 'icl', 'oud.com'];
const getEmail = () => emailParts.join('');
const emailParam = `mailto=${encodeURIComponent(getEmail())}`;

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

const rateLimiter = new RateLimiter(5);

async function handleCrossrefResponse(response, functionName) {
    if (!response.ok) {
        throw new Error(`HTTP error in ${functionName}! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data || !data.message) {
        throw new Error(`Invalid response data in ${functionName}`);
    }
    return data;
}

function handleCrossrefError(error, functionName) {
    console.error(`Error in ${functionName}:`, error);
    throw error;
}

async function getTitle(doi) {
    if (!doi) return null;

    const cachedData = getCachedData(doi);
    if (cachedData && cachedData.title) {
        console.log(`Using cached title for DOI: ${doi}`);
        return cachedData.title;
    }

    try {
        const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}?${emailParam}`;
        const data = await rateLimiter.add(() => 
            fetch(url)
                .then(response => handleCrossrefResponse(response, 'getTitle'))
                .catch(error => handleCrossrefError(error, 'getTitle'))
        );

        const title = data.message.title ? data.message.title[0] : "Unknown Title";
        
        // Cache the title
        const existingData = getCachedData(doi);
        setCachedData(doi, { ...existingData, title });
        
        return title;
    } catch (error) {
        console.error('Error fetching title:', error);
        return "Unknown Title";
    }
}

async function getCitingPubs(doi) {
    const cachedData = getCachedData(doi);
    if (cachedData && cachedData.citations) {
        console.log(`Using cached citations for DOI: ${doi}`);
        return { status: 'SUCCESS', data: cachedData.citations };
    }

    try {
        const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}/citations?${emailParam}`;
        const data = await rateLimiter.add(() => 
            fetch(url)
                .then(response => handleCrossrefResponse(response, 'getCitingPubs'))
                .catch(error => handleCrossrefError(error, 'getCitingPubs'))
        );

        if (!data.message.items || data.message.items.length === 0) {
            return { status: 'NO_DATA', data: [] };
        }

        const citations = data.message.items.map(item => ({
            citing: item.DOI,
            title: item.title ? item.title[0] : "Unknown Title",
            author: item.author ? item.author[0].family : "Unknown Author",
            year: item.published ? item.published['date-parts'][0][0] : "Unknown Year"
        }));

        // Cache the citations
        const existingData = getCachedData(doi);
        setCachedData(doi, { ...existingData, citations });

        return { status: 'SUCCESS', data: citations };
    } catch (error) {
        console.error('Error in getCitingPubs:', error);
        return { status: 'API_ERROR', data: [] };
    }
}

export { getTitle, getCitingPubs, rateLimiter, handleCrossrefResponse, handleCrossrefError };
