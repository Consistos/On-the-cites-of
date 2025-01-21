import { getCitingPubs, getTitle } from './api.js';

// Cache management functions
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // A week in milliseconds

function getCachedData(key) {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_EXPIRY) {
        localStorage.removeItem(key);
        return null;
    }
    return data;
}

function setCachedData(key, data) {
    const cacheEntry = {
        data,
        timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(cacheEntry));
}

// Helper function for pre-caching citations
async function preCacheCitations(dois) {
    await Promise.all(dois.map(async doi => {
        const title = await getTitle(doi);
        if (title && title !== "Unknown Title" && !getCachedData(title)?.['cited-by']) {
            console.log(`Pre-caching citations for DOI: ${doi}`);
            await getCitingPubs(doi);
        }
    }));
}

export { getCachedData, setCachedData, preCacheCitations };
