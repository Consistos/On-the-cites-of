import { getCitingPubs, getTitle } from './api.js';

// Cache management functions
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // A week in milliseconds

function getCachedData(key) {
    try {
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp > CACHE_EXPIRY) {
            localStorage.removeItem(key);
            return null;
        }
        return data;
    } catch (error) {
        console.error('Error reading from cache:', error);
        return null;
    }
}

function setCachedData(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
    } catch (error) {
        console.error('Error writing to cache:', error);
    }
}

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
