import { getTitle, rateLimiter, handleCrossrefResponse, handleCrossrefError } from './api.js';
import { getCachedData, setCachedData } from './cache.js';
import { updateInputWithTitle } from './ui.js';

const emailParts = ['dbag', 'ory', '@', 'icl', 'oud.com'];
const getEmail = () => emailParts.join('');
const emailParam = `mailto=${encodeURIComponent(getEmail())}`;

// Function to normalize titles by removing common prefixes
function normalizeTitle(title) {
    const prefixes = [
        'Review of: ',
        'Commentary on: ',
        'Response to: ',
        'Letter to the editor: ',
        'Editorial: ',
        'Correction to: ',
        'Erratum to: ',
        'Retraction of: '
    ];

    let normalized = title;
    for (const prefix of prefixes) {
        if (normalized.startsWith(prefix)) {
            normalized = normalized.substring(prefix.length);
            break; // Only remove the first matching prefix
        }
    }

    return normalized.trim();
}

// Function to calculate Levenshtein distance between two strings
function levenshteinDistance(s1, s2) {
    if (s1.length < s2.length) {
        return levenshteinDistance(s2, s1);
    }

    // Handle empty strings
    if (s2.length === 0) {
        return s1.length;
    }

    let previousRow = Array.from({ length: s2.length + 1 }, (_, i) => i);

    for (let i = 0; i < s1.length; i++) {
        let currentRow = [i + 1];
        for (let j = 0; j < s2.length; j++) {
            let insertions = previousRow[j + 1] + 1;
            let deletions = currentRow[j] + 1;
            let substitutions = previousRow[j] + (s1[i] === s2[j] ? 0 : 1);
            currentRow.push(Math.min(insertions, deletions, substitutions));
        }
        previousRow = currentRow;
    }

    return previousRow[s2.length];
}

async function getDOI(input) {
    const sanitizedInput = input.value.trim();

    // Check cache for title first
    let cachedDataByTitle = getCachedData(sanitizedInput);
    if (cachedDataByTitle && cachedDataByTitle.doi) {
        console.log(`Using cached DOI for title: ${sanitizedInput}`);
        return cachedDataByTitle.doi;
    }

    // Handle DOI URLs or direct DOIs
    const doiMatch = sanitizedInput.match(/(?:doi\.org\/|dx\.doi\.org\/|doi:)?(\d+\.\d+\/[^\/\s]+)/i);
    if (doiMatch) {
        const doi = doiMatch[1];

        // Check cache for DOI
        let cachedDataByDoi = getCachedData(doi);
        if (cachedDataByDoi && cachedDataByDoi.doi) {
            console.log(`Using cached DOI: ${doi}`);
            return cachedDataByDoi.doi; // Return DOI directly from cache
        }

        // If DOI not in cache, proceed to fetch title and DOI from Crossref
        const title = await getTitle(doi);
        if (title && title !== "Unknown Title") {
            // Cache title and DOI
            const existingData = getCachedData(doi) || {}; // Get existing data to avoid overwriting citations
            setCachedData(doi, { ...existingData, doi, title }); // Cache under DOI
            setCachedData(title, { ...existingData, doi }); // Also cache under title for fallback
            await updateInputWithTitle(input, title);
        }
        return doi;
    }

    // Handle arXiv URLs or IDs first (since they have a specific format)
    const arxivUrlMatch = sanitizedInput.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (arxivUrlMatch) {
        const arxivId = arxivUrlMatch[1];
        console.log('Extracted arXiv ID from URL:', arxivId);
        try {
            const response = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`);
            const text = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            const title = xmlDoc.querySelector('entry > title')?.textContent?.trim();
            const doi = `10.48550/arXiv.${arxivId}`;

            if (title) {
                // Only store the DOI, let getCitingPubs handle citations
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
                await updateInputWithTitle(input, title);
            }
            return doi;
        } catch (error) {
            console.error('Error fetching arXiv data:', error);
            return `10.48550/arXiv.${arxivId}`;
        }
    }

    // Handle direct arXiv identifiers
    const arxivIdMatch = sanitizedInput.match(/^(?:arxiv:|10\.48550\/arXiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
    if (arxivIdMatch) {
        const arxivId = arxivIdMatch[1];
        console.log('Found direct arXiv ID:', arxivId);
        try {
            const response = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`);
            const text = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            const title = xmlDoc.querySelector('entry > title')?.textContent?.trim();
            const doi = `10.48550/arXiv.${arxivId}`;

            if (title) {
                // Only store the DOI, let getCitingPubs handle citations
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
                await updateInputWithTitle(input, title);
            }
            return doi;
        } catch (error) {
            console.error('Error fetching arXiv data:', error);
            return `10.48550/arXiv.${arxivId}`;
        }
    }

    // Handle PubMed URLs or IDs (after arXiv to prevent false matches)
    const pubmedMatch = sanitizedInput.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/|^)?(?:PMC)?(\d{6,8})(?:\/)?$/i);
    if (pubmedMatch) {
        const pmid = sanitizedInput.toUpperCase().includes('PMC') ? `PMC${pubmedMatch[1]}` : pubmedMatch[1];
        console.log('Extracted PubMed/PMC ID:', pmid);
        const doi = await extractPubMedDOI(pmid);
        if (doi) {
            const title = await getTitle(doi);
            if (title && title !== "Unknown Title") {
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
                await updateInputWithTitle(input, title);
            }
            return doi;
        }
    }

    // Fall back to CrossRef search if no DOI in cache

    // Check cache for title/input

    // If not found in cache, proceed to Crossref search
    try {
        const query = encodeURIComponent(sanitizedInput);
        const url = `https://api.crossref.org/works?query.bibliographic=${query}&rows=1&${emailParam}`;

        const data = await rateLimiter.add(() =>
            fetch(url)
                .then(response => handleCrossrefResponse(response, 'getDOI'))
                .catch(error => handleCrossrefError(error, 'getDOI'))
        );

        if (data.message.items.length > 0) {
            const doi = data.message.items[0].DOI;
            const title = data.message.items[0].title[0];

            // Calculate similarity after normalizing titles
            const normalizedInput = normalizeTitle(sanitizedInput).toLowerCase();
            const normalizedTitle = normalizeTitle(title).toLowerCase();
            const distance = levenshteinDistance(normalizedInput, normalizedTitle);
            // Allow distance up to 5% of normalized input length (adjust threshold as needed)
            const threshold = Math.floor(normalizedInput.length * 0.05);

            console.log(`Crossref found: "${title}" (DOI: ${doi}). Comparing normalized "${normalizedTitle}" with "${normalizedInput}". Distance: ${distance}, Threshold: ${threshold}`);

            if (distance <= threshold) {
                console.log(`Title match is close enough. Using DOI: ${doi}`);
                // Cache title and DOI
                const existingData = getCachedData(doi) || {}; // Get existing data to avoid overwriting citations
                setCachedData(doi, { ...existingData, doi, title }); // Cache under DOI
                setCachedData(title, { ...existingData, doi }); // Also cache under title for fallback
                await updateInputWithTitle(input, title);
                return doi;
            } else {
                console.log(`Title match "${title}" is too dissimilar to query "${sanitizedInput}". Discarding result.`);
                // Cache as 'not_found' for the original input to prevent repeated searches
                setCachedData(sanitizedInput, { status: 'not_found', message: `Found title "${title}" dissimilar to query.` });
            }
        } else {
            console.log(`No items found in Crossref search for "${sanitizedInput}"`);
            // Cache as 'not_found'
            setCachedData(sanitizedInput, { status: 'not_found', message: 'No results from Crossref title search.' });
        }
    } catch (error) {
        console.error('Error in getDOI:', error);
        return null;
    }
}

async function extractPubMedDOI(pmid) {
    const apiUrl = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${pmid}&format=json&versions=no&tool=citesof&email=${getEmail()}`;
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data.records && data.records.length > 0 && data.records[0].doi) {
            return data.records[0].doi;
        }
        return null;
    } catch (error) {
        console.error('Error fetching PubMed DOI:', error);
        return null;
    }
}

async function extractArXivDOI(arxivId) {
    // Return the DataCite DOI format for arXiv papers
    return `10.48550/arXiv.${arxivId}`;
}

export { getDOI, extractArXivDOI, extractPubMedDOI };
