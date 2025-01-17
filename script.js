async function findCommonCitations(initialDois = null) {
    const inputs = document.getElementsByClassName('article-input');
    const resultsDiv = document.getElementById('results');
    const nonEmptyInputs = Array.from(inputs).filter(input => input.value.trim() !== '');

    if (nonEmptyInputs.length === 0) {
        resultsDiv.innerHTML = '<div class="text-center text-gray-600">Please enter at least one title or DOI.</div>';
        return;
    }

    resultsDiv.innerHTML = '<div class="text-center text-gray-600">Searching...</div>';

    try {
        let dois;
        if (initialDois) {
            dois = initialDois;
        } else {
            // Pre-cache any existing DOIs from the input values
            for (const input of nonEmptyInputs) {
                const value = input.value.trim();
                if (value.startsWith('10.')) {
                    setCachedData(`${value}`, value);
                }
            }
            
            dois = await Promise.all(nonEmptyInputs.map(input => getDOI(input.value)));
            
            if (dois.some(doi => !doi)) {
                resultsDiv.innerHTML = '<div class="text-center text-gray-600">Could not find DOI for one or more articles</div>';
                return;
            }

            // Update URL with DOIs only if they weren't provided initially
            const encodedDois = dois.map(doi => encodeURIComponent(doi));
            const newUrl = `${window.location.pathname}?${encodedDois.map((doi, index) => `doi${index+1}=${doi}`).join('&')}`;
            history.pushState({}, '', newUrl);
        }

        // Pre-fetch and cache references for all DOIs
        await Promise.all(dois.map(async doi => {
            const cacheKey = `references_${doi}`;
            if (!getCachedData(cacheKey)) {
                console.log(`Pre-caching references for DOI: ${doi}`);
                await getReferences(doi);
            }
        }));

        // Get references for all DOIs, but only fetch each reference once
        const uniqueDois = [...new Set(dois)];
        const allReferences = await Promise.all(uniqueDois.map(async doi => {
            console.log(`Getting references for DOI: ${doi}`);
            return getReferences(doi);
        }));
        
        // Check for API errors
        if (allReferences.every(ref => ref.status === 'API_ERROR')) {
            resultsDiv.innerHTML = '<div class="text-center text-gray-600">The API is not responding. Please try again later.</div>';
            return;
        }

        // Check for no data
        if (allReferences.every(ref => ref.status === 'NO_DATA')) {
            resultsDiv.innerHTML = '<div class="text-center text-gray-600">No references found for any of the articles. The API might not have data for these DOIs.</div>';
            return;
        }

        const commonReferences = allReferences.reduce((common, ref, index) => {
            if (index === 0) return ref.data;
            return common.filter(ref1 => {
                console.log('ref1.citing:', ref1.citing);
                return ref.data.some(ref2 => {
                    console.log('ref2.citing:', ref2.citing);
                    return ref1.citing === ref2.citing;
                });
            });
        }, []);

        await displayResults(commonReferences, dois, allReferences.map(ref => ref.data.length));
    } catch (error) {
        resultsDiv.innerHTML = '<div class="text-center text-gray-600">An error occurred: ' + error.message + '</div>';
        console.error('Error in findCommonCitations:', error);
    }
}

async function getDOI(input) {
    const sanitizedInput = input.trim();
    
    // Handle DOI URLs or direct DOIs
    const doiMatch = sanitizedInput.match(/(?:doi\.org\/|dx\.doi\.org\/|doi:)?(\d+\.\d+\/[^\/\s]+)/i);
    if (doiMatch) {
        const doi = doiMatch[1];
        const title = await getTitle(doi);
        if (title && title !== "Unknown Title") {
            // Only store the DOI, let getReferences handle citations
            const existingData = getCachedData(title);
            setCachedData(title, { ...existingData, doi });
        }
        return doi;
    }
    
    // Handle arXiv URLs or IDs first (since they have a specific format)
    const arxivUrlMatch = sanitizedInput.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
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
                // Only store the DOI, let getReferences handle citations
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
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
                // Only store the DOI, let getReferences handle citations
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
            }
            return doi;
        } catch (error) {
            console.error('Error fetching arXiv data:', error);
            return `10.48550/arXiv.${arxivId}`;
        }
    }
    
    // Handle PubMed URLs or IDs (after arXiv to prevent false matches)
    const pubmedMatch = sanitizedInput.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/|^PMC)?(\d{6,8})(?:\/)?$/i);
    if (pubmedMatch || sanitizedInput.match(/^PMC\d{6,8}$/i)) {
        const pmid = pubmedMatch ? pubmedMatch[1] : sanitizedInput.replace(/^PMC/i, '');
        console.log('Extracted PubMed ID:', pmid);
        const doi = await extractPubMedDOI(pmid);
        if (doi) {
            const title = await getTitle(doi);
            if (title && title !== "Unknown Title") {
                // Only store the DOI, let getReferences handle citations
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
            }
            return doi;
        }
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
            
            // Cache the DOI, let getReferences handle citations
            if (title) {
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
            }
            
            return doi;
        }
        return null;
    } catch (error) {
        console.error('Error in getDOI:', error);
        return null;
    }
}

async function getReferences(doi) {
    // Convert arXiv ID to DataCite DOI format if needed
    const arxivMatch = doi.match(/^(?:arxiv:|10\.48550\/arXiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
    if (arxivMatch) {
        doi = `10.48550/arXiv.${arxivMatch[1]}`;
    }

    // First get the title for this DOI
    const title = await getTitle(doi);
    if (title && title !== "Unknown Title") {
        // Check if we have cached data for this title
        const cachedData = getCachedData(title);
        if (cachedData && Array.isArray(cachedData.citations)) {
            console.log(`Using cached citations for DOI: ${doi}, Count: ${cachedData.citations.length}`);
            return {
                status: 'SUCCESS',
                data: cachedData.citations
            };
        }
    }

    try {
        const baseUrl = 'https://corsproxy.io/?url=https://opencitations.net/index/coci/api/v1/citations/';
        const response = await fetch(`${baseUrl}${encodeURIComponent(doi)}`);
        
        if (!response.ok) {
            console.error(`OpenCitations API error: ${response.status} for DOI ${doi}`);
            return {
                status: 'API_ERROR',
                data: [],
                message: `Failed to fetch data from OpenCitations (Status: ${response.status})`
            };
        }

        const data = await response.json();
        console.log(`Fetched citations for DOI: ${doi}, Status: ${response.status}, Count: ${data.length}`);
        if (data.length > 0) {
            // Transform the data to use the citing DOI as our reference
            const transformedData = data.map(citation => ({
                ...citation,
                citing: citation.citing.split(' ').find(id => id.startsWith('doi:'))?.substring(4) || citation.citing
            }));
            
            // Cache the transformed data if we have a title
            if (title && title !== "Unknown Title") {
                // Get existing cache data to preserve the DOI
                const existingData = getCachedData(title) || {};
                setCachedData(title, { 
                    ...existingData,
                    doi, // Ensure DOI is set
                    citations: transformedData 
                });
            }
            
            return {
                status: 'SUCCESS',
                data: transformedData
            };
        }

        // Handle no data case
        if (arxivMatch) {
            console.log(`No citation data available for arXiv paper: ${arxivMatch[1]}`);
            return {
                status: 'NO_DATA',
                data: [],
                message: `This appears to be an arXiv paper (${arxivMatch[1]}). While we can confirm it exists, no citation data is currently available in OpenCitations. This is common for newer or preprint papers.`
            };
        }

        // Cache empty results if we have a title
        if (title && title !== "Unknown Title") {
            // Get existing cache data to preserve the DOI
            const existingData = getCachedData(title) || {};
            setCachedData(title, { 
                ...existingData,
                doi, // Ensure DOI is set
                citations: [] 
            });
        }
        
        return {
            status: 'NO_DATA',
            data: [],
            message: 'No citation data found for this DOI in OpenCitations.'
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

async function extractArXivDOI(arxivId) {
    // Return the DataCite DOI format for arXiv papers
    return `10.48550/arXiv.${arxivId}`;
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

async function addInput() {
    const container = document.getElementById('inputContainer');
    const div = document.createElement('div');
    div.className = 'input-group flex gap-2 w-full max-w-[800px] px-4 sm:px-0';
    
    const inputContainer = document.createElement('div');
    inputContainer.className = 'relative flex-grow';
    
    const input = document.createElement('textarea');
    input.className = 'article-input block w-full px-4 py-2 text-base text-gray-900 border border-gray-300 rounded-lg bg-gray-50 resize-y';
    input.placeholder = 'Title or DOI';
    input.rows = 2;
    input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            findCommonCitations();
        }
    });
    input.addEventListener('input', function() {
        updateClearButtonVisibility(this);
    });
    
    const clearButton = document.createElement('button');
    clearButton.className = 'clear-input absolute right-2 top-2 text-gray-400 hover:text-gray-600 hidden';
    clearButton.onclick = function() { clearInput(this); };
    clearButton.innerHTML = '<span class="text-xl">×</span>';
    
    inputContainer.appendChild(input);
    inputContainer.appendChild(clearButton);
    div.appendChild(inputContainer);
    
    // Add remove button
    const removeButton = document.createElement('button');
    removeButton.className = 'remove-input h-12 bg-white hover:bg-red-400 text-gray-600 hover:text-white px-4 rounded-lg transition-colors flex-shrink-0 group relative flex items-center justify-center';
    removeButton.onclick = function() { removeInput(this); };
    removeButton.innerHTML = `
        <span class="text-xl">−</span>
        <span class="invisible group-hover:visible absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm py-1 px-2 rounded whitespace-nowrap z-10">Remove</span>
    `;
    div.appendChild(removeButton);
    
    container.appendChild(div);
}

function removeInput(button) {
    const inputGroup = button.closest('.input-group');
    inputGroup.remove();
}

function removeInput(button) {
    const inputGroup = button.closest('.input-group');
    inputGroup.remove();
}

function clearInput(button) {
    const textarea = button.parentElement.querySelector('textarea');
    textarea.value = '';
    textarea.focus();
    button.classList.add('hidden');
}

function updateClearButtonVisibility(textarea) {
    const clearButton = textarea.parentElement.querySelector('.clear-input');
    if (textarea.value.trim()) {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

// Obfuscated email construction for Crossref API
const emailParts = ['dbag', 'ory', '@', 'icl', 'oud.com'];
const getEmail = () => emailParts.join('');
const emailParam = `mailto=${encodeURIComponent(getEmail())}`;

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

async function getTitle(doi) {
    // Check if we have a cached DOI for this title by looking through cache entries
    // (we need to do this since we don't know the title yet)
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const item = localStorage.getItem(key);
        if (item) {
            try {
                const { data } = JSON.parse(item);
                if (typeof data === 'object' && data.doi === doi) {
                    console.log(`Using cached title for DOI: ${doi}`);
                    return key;
                }
            } catch (error) {
                console.error('Error parsing cache item:', error);
            }
        }
    }

    // Check if it's an arXiv ID or DataCite DOI
    const arxivMatch = doi.match(/^(?:arxiv:|10\.48550\/arXiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
    if (arxivMatch) {
        const arxivId = arxivMatch[1];  // Get the ID from whichever group matched
        try {
            const response = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`);
            const text = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            const title = xmlDoc.querySelector('entry > title')?.textContent?.trim();
            if (title) {
                // Only store the DOI, let getReferences handle citations
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
                return title;
            }
            // If we can't get the title, return "Unknown Title"
            return "Unknown Title";
        } catch (error) {
            console.error('Error fetching arXiv title:', error);
            // Return "Unknown Title" on error
            return "Unknown Title";
        }
    }

    // If not arXiv or arXiv fetch failed, try Crossref
    try {
        // Handle special characters in DOI
        const encodedDoi = encodeURIComponent(doi.replace(/\s+/g, ''));
        const url = `https://api.crossref.org/works/${encodedDoi}?${emailParam}`;
        
        const response = await rateLimiter.add(() => fetch(url));
        const data = await response.json();
        
        if (response.ok) {
            const title = data?.message?.title?.[0];
            if (title) {
                // Only store the DOI, let getReferences handle citations
                const existingData = getCachedData(title);
                setCachedData(title, { ...existingData, doi });
                return title;
            }
        }
        
        // If we can't get the title from Crossref, return "Unknown Title"
        console.log(`No title found for DOI: ${doi}`);
        return "Unknown Title";
    } catch (error) {
        console.error('Error fetching title:', error);
        return "Unknown Title"; // Return "Unknown Title" if we can't get the title
    }
}

function showError(message, duration = 5000) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => {
        errorDiv.classList.add('hidden');
    }, duration);
}

function clearError() {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.classList.add('hidden');
}

async function displayResults(commonReferences, dois, refCounts) {
    const resultsDiv = document.getElementById('results');
    if (commonReferences.length === 0) {
        let message = '<div class="text-center text-gray-600 mt-4">';
        message += 'No common citations found between these papers.<br>';
        message += 'Note: OpenCitations might not have citation data for the given DOIs.</div>';
        resultsDiv.innerHTML = message;
        return;
    }

    let html = '';
    
    // Deduplicate references first
    const uniqueReferences = Array.from(new Set(commonReferences.map(ref => ref.citing)))
        .map(citing => commonReferences.find(ref => ref.citing === citing));
    
    // Fetch all titles concurrently
    const titlePromises = uniqueReferences.map(ref => getTitle(ref.citing));
    const titles = await Promise.all(titlePromises);
    
    // Group references by title
    const groupedReferences = {};
    uniqueReferences.forEach((ref, index) => {
        const title = titles[index];
        if (title !== 'Title not available') {
            if (!groupedReferences[title]) {
                groupedReferences[title] = [];
            }
            groupedReferences[title].push(ref.citing);
        }
    });
    
    const validReferencesCount = Object.keys(groupedReferences).length;

    // Mobile view
    html += `<div class="sm:hidden px-4">`;
    // Results section for mobile
    html += `<h2 class="text-lg text-center mt-8 mb-4">${validReferencesCount} result${validReferencesCount === 1 ? '' : 's'}</h2>`;
    if (validReferencesCount === 0) {
        html += `<p>No results with available titles.</p>`;
    } else {
        for (const [title, dois] of Object.entries(groupedReferences)) {
            const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
            html += `
                <table class="w-full mb-4 border border-gray-300">
                    <tr>
                        <td class="px-4 py-2">
                            <a href="https://doi.org/${dois[0]}" target="_blank" class="hover:underline block mb-2">${title}</a>
                        </td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-t border-gray-300">
                            <div class="flex justify-between items-center">
                                <a href="${scholarUrl}" target="_blank" class="hover:underline">Google Scholar</a>
                                <div class="flex items-center">
                                    <span class="mr-2 text-gray-600">DOI</span>
                                    <button onclick="copyToClipboard('${dois[0]}')" class="text-gray-600 hover:text-blue-600">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </td>
                    </tr>
                </table>
            `;
        }
    }
    
    // Citations count for mobile
    html += `<div class="mt-4 text-sm text-gray-600">`;
    html += dois.map((doi, index) => `${refCounts[index]} citation${refCounts[index] === 1 ? '' : 's'} found for entry ${index + 1}`).join(' • ');
    html += `</div>`;
    html += `</div>`; // Close mobile view

    // Desktop view
    html += `<div class="hidden sm:block">`;
    // Display number of valid references above the table
    html += `<p class="text-center mb-3">${validReferencesCount} result${validReferencesCount === 1 ? '' : 's'}</p>`;
    
    if (validReferencesCount === 0 && commonReferences.length > 0) {
        html += `<p class="text-center">Citations in common found, but no titles available.</p>`;
    } else {
        // Create table with full width
        html += `<div class="w-full max-w-[1400px] mx-auto">
            <table class="w-full text-sm border-collapse border border-gray-300 mt-8">
                <thead bg-gray-50>
                    <tr>
                        <th class="w-[80%] text-gray-600 text-left border border-gray-300 px-4 py-2">Title</th>
                        <th class="w-[10%] text-gray-600 text-left border border-gray-300 px-4 py-2">Google Scholar</th>
                        <th class="w-[10%] text-gray-600 text-left border border-gray-300 px-4 py-2">DOI</th>
                    </tr>
                </thead>
                <tbody>`;
        
        for (const [title, dois] of Object.entries(groupedReferences)) {
            const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
            html += `<tr>
                <td class="break-words py-2 border border-gray-300 p-2">
                    <a href="https://doi.org/${dois[0]}" target="_blank" class="hover:underline">${title}</a>
                </td>
                <td class="break-words py-2 text-center border border-gray-300 p-2">
                    <a href="${scholarUrl}" target="_blank" class="hover:underline">🔗</a>
                </td>
                <td class="break-words py-2 text-center border border-gray-300 p-2">
                    <div class="relative">
                        <div id="copyMessage-${dois[0]}" class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded-md opacity-0 transition-opacity duration-200">Copied!</div>
                        <button onclick="copyToClipboard('${dois[0]}')" class="text-gray-600 hover:text-blue-600">
                            <svg class="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                            </svg>
                        </button>
                        ${dois.length > 1 ? `<div class="text-sm text-gray-600">${dois.length} DOIs</div>` : ''}
                    </div>
                </td>
            </tr>`;
        }
        
        html += `</tbody>
            </table>
        </div>`;
    }
    
    if (validReferencesCount === 0 && commonReferences.length > 0) {
        html += `<p class="text-center">Citations in common found, but no titles available.</p>`;
    }
    
    // ref.s count for desktop
    html += `<p class="text-center text-gray-800 text-sm mt-4">`;
    html += dois.map((doi, index) => `${refCounts[index]} citation${refCounts[index] === 1 ? '' : 's'} found for entry ${index + 1}`).join(' • ');
    html += `</p>`;
    html += `</div>`; // Close desktop view
    
    resultsDiv.innerHTML = html;
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        const messageEl = document.getElementById(`copyMessage-${text}`);
        messageEl.style.opacity = '1';
        setTimeout(() => {
            messageEl.style.opacity = '0';
        }, 1500);
    } catch (err) {
        showError('Failed to copy DOI');
    }
}


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

// Function to initialize the page
async function initializePage() {
    try {
        let index = 1;
        let doi = getUrlParameter(`doi${index}`);
        const dois = [];
        
        // Remove all existing input fields
        const inputs = document.querySelectorAll('.input-group');
        inputs.forEach(input => input.remove());
        
        // Always add two input fields at start
        addInput();
        addInput();
        
        // Process URL parameters
        while (doi) {
            dois.push(doi);
            if (index > 2) {  // Only add new fields after the first two
                addInput();
            }
            const currentInputs = document.querySelectorAll('.article-input');
            const title = await getTitle(doi);
            
            // Pre-cache the DOI for this title/DOI combination
            if (title && title !== doi) {
                setCachedData(title, { doi });
            }
            
            currentInputs[index - 1].value = title && title !== doi ? title : doi;
            updateClearButtonVisibility(currentInputs[index - 1]);
            index++;
            doi = getUrlParameter(`doi${index}`);
        }
        
        if (dois.length > 1) {
            // Pre-fetch and cache references for all DOIs
            await Promise.all(dois.map(async doi => {
                const cacheKey = `references_${doi}`;
                if (!getCachedData(cacheKey)) {
                    console.log(`Pre-caching references for DOI: ${doi}`);
                    await getReferences(doi);
                }
            }));
            await findCommonCitations(dois);
        }
    } catch (error) {
        console.error('Error during page initialization:', error);
    }
}

// Run initialization after the DOM content has loaded
document.addEventListener('DOMContentLoaded', function() {
    initializePage();
    document.querySelectorAll('.article-input').forEach(textarea => {
        textarea.addEventListener('input', function() {
            updateClearButtonVisibility(this);
        });
        updateClearButtonVisibility(textarea);
    });
});

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

// Event listeners for search via Enter key
document.addEventListener('keyup', function(event) {
    if (event.target.classList.contains('article-input') && event.key === 'Enter') {
        findCommonCitations();
    }
});

// get URL parameters
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}