const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // A week in milliseconds

export function getCachedData(doi) {
    const cached = localStorage.getItem(doi);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_EXPIRY) {
        localStorage.removeItem(doi);
        return null;
    }
    return data;
}

export function setCachedData(doi, data) {
    const cacheEntry = {
        data,
        timestamp: Date.now()
    };
    localStorage.setItem(doi, JSON.stringify(cacheEntry));
}

// Helper function for pre-caching citations
export function createPreCacheCitations(getTitle, getCitingPubs) {
    return async function preCacheCitations(dois) {
        await Promise.all(dois.map(async doi => {
            const title = await getTitle(doi);
            if (title && title !== "Unknown Title" && !getCachedData(doi)?.['cited-by']) {
                console.log(`Pre-caching citations for DOI: ${doi}`);
                await getCitingPubs(doi);
            }
        }));
    };
}
