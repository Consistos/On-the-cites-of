import { getTitle, rateLimiter, handleCrossrefResponse, handleCrossrefError } from './api.js';
import { getCachedData, setCachedData } from './cache.js';
import { updateInputWithTitle } from './ui.js';

const emailParts = ['dbag', 'ory', '@', 'icl', 'oud.com'];
const getEmail = () => emailParts.join('');
const emailParam = `mailto=${encodeURIComponent(getEmail())}`;

async function getDOI(input) {
    const sanitizedInput = input.value.trim();
    
    // Handle DOI URLs or direct DOIs
    const doiMatch = sanitizedInput.match(/(?:doi\.org\/|dx\.doi\.org\/|doi:)?(\d+\.\d+\/[^\/\s]+)/i);
    if (doiMatch) {
        const doi = doiMatch[1];
        const title = await getTitle(doi);
        if (title && title !== "Unknown Title") {
            const existingData = getCachedData(title);
            setCachedData(title, { ...existingData, doi });
            await updateInputWithTitle(input, title);
        }
        return doi;
    }
    
    // Handle arXiv URLs or IDs
    const arxivUrlMatch = sanitizedInput.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (arxivUrlMatch) {
        return await extractArXivDOI(arxivUrlMatch[1]);
    }
    
    // Handle direct arXiv identifiers
    const arxivIdMatch = sanitizedInput.match(/^(?:arxiv:|10\.48550\/arXiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
    if (arxivIdMatch) {
        return await extractArXivDOI(arxivIdMatch[1]);
    }
    
    // Handle PubMed URLs or IDs
    const pubmedMatch = sanitizedInput.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/|^)?(?:PMC)?(\d{6,8})(?:\/)?$/i);
    if (pubmedMatch) {
        const pmid = sanitizedInput.toUpperCase().includes('PMC') ? `PMC${pubmedMatch[1]}` : pubmedMatch[1];
        return await extractPubMedDOI(pmid);
    }

    // Check cache for title
    const cachedData = getCachedData(sanitizedInput);
    if (cachedData && cachedData.doi) {
        console.log(`Using cached DOI for title: ${sanitizedInput}`);
        return cachedData.doi;
    }

    // Fall back to CrossRef search
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
            
            if (title) {
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
                await updateInputWithTitle(input, title);
            }
            
            return doi;
        }
        return null;
    } catch (error) {
        console.error('Error in getDOI:', error);
        return null;
    }
}

async function extractArXivDOI(arxivId) {
    return `10.48550/arXiv.${arxivId}`;
}

async function extractPubMedDOI(pmid) {
    try {
        const response = await fetch(`https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${pmid}&format=json`);
        const data = await response.json();
        if (data.records && data.records[0] && data.records[0].doi) {
            return data.records[0].doi;
        }
        return null;
    } catch (error) {
        console.error('Error fetching PubMed DOI:', error);
        return null;
    }
}

export { getDOI, extractArXivDOI, extractPubMedDOI };
