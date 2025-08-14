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
    return async function preCacheCitations(dois, progressCallback = null) {
        await Promise.all(dois.map(async (doi, index) => {
            if (progressCallback) {
                progressCallback(`Pre-caching citations... (${index + 1}/${dois.length})`);
            }
            
            const title = await getTitle(doi);
            if (title && title !== "Unknown Title" && !getCachedData(doi)?.['cited-by']) {
                console.log(`Pre-caching citations for DOI: ${doi}`);
                await getCitingPubs(doi);
            }
        }));
    };
}

// Helper function for pre-caching citation counts
export function createPreCacheCitationCounts(rateLimiter) {
    return async function preCacheCitationCounts(citingDois, progressCallback = null) {
        const uncachedDois = citingDois.filter(doi => {
            const cacheKey = `citationCount_${doi}`;
            return getCachedData(cacheKey) === null;
        });

        if (uncachedDois.length === 0) {
            console.log('All citation counts already cached');
            return;
        }

        console.log(`Pre-caching citation counts for ${uncachedDois.length} DOIs`);

        const citationCountPromises = uncachedDois.map(async (doi, index) => {
            if (progressCallback) {
                progressCallback(`Caching citation counts... (${index + 1}/${uncachedDois.length})`);
            }

            const cacheKey = `citationCount_${doi}`;
            
            try {
                const response = await rateLimiter.add(() => 
                    fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
                );
                
                if (response.ok) {
                    const data = await response.json();
                    const count = data.message['is-referenced-by-count'] || 0;
                    setCachedData(cacheKey, count);
                    console.log(`Cached citation count for ${doi}: ${count}`);
                    return count;
                }
                
                // Cache 0 for failed requests to avoid repeated API calls
                setCachedData(cacheKey, 0);
                return 0;
            } catch (error) {
                console.error(`Error fetching citation count for ${doi}:`, error);
                // Cache 0 for errors to avoid repeated API calls
                setCachedData(cacheKey, 0);
                return 0;
            }
        });

        await Promise.all(citationCountPromises);
        console.log(`Finished pre-caching citation counts for ${uncachedDois.length} DOIs`);
    };
}
