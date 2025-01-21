import {
    getTitle,
    getCitingPubs,
    rateLimiter,
    handleCrossrefResponse,
    handleCrossrefError,
    getCachedData,
    setCachedData,
    preCacheCitations
} from './api.js';
import { getDOI, extractArXivDOI, extractPubMedDOI } from './identifiers.js';
import { 
    addInput, 
    removeInput, 
    clearInput, 
    updateClearButtonVisibility, 
    updateRemoveButtons, 
    ensureRemoveButton,
    updateInputWithTitle,
    copyToClipboard,
    showError 
} from './ui.js';
import { displayResults } from './results.js';

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
            
            dois = await Promise.all(nonEmptyInputs.map(input => getDOI(input)));
            
            if (dois.some(doi => !doi)) {
                resultsDiv.innerHTML = '<div class="text-center text-gray-600">Could not find DOI for one or more articles</div>';
                return;
            }

            // Update URL with DOIs only if they weren't provided initially
            const encodedDois = dois.map(doi => encodeURIComponent(doi));
            const newUrl = `${window.location.pathname}?${encodedDois.map((doi, index) => `doi${index+1}=${doi}`).join('&')}`;
            // Record when we last updated the URL to avoid reinitializing
            window.lastUrlUpdate = Date.now();
            history.replaceState({}, '', newUrl);
        }

        // Pre-fetch and cache references for all DOIs
        await preCacheCitations(dois);

        // Get references for all DOIs, but only fetch each reference once
        const uniqueDois = [...new Set(dois)];
        const allReferences = await Promise.all(uniqueDois.map(async doi => {
            console.log(`Getting references for DOI: ${doi}`);
            return getCitingPubs(doi);
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

// get URL parameters
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

async function initialisePage() {
    try {
        let index = 1;
        const dois = [];
        let doi = getUrlParameter(`doi${index}`);
        const container = document.getElementById('inputContainer');
        
        // Only initialize if we haven't already
        if (!window.isInitialized) {
            // Get existing inputs
            let existingInputs = container.querySelectorAll('.input-group');
            
            // If no inputs exist, add the initial two inputs
            if (existingInputs.length === 0) {
                addInput();
                addInput();
                existingInputs = container.querySelectorAll('.input-group');
            } else {
                // Ensure all existing inputs have remove buttons
                existingInputs.forEach(inputGroup => {
                    ensureRemoveButton(inputGroup);
                });
            }
            
            // Process URL parameters if they exist
            while (doi) {
                dois.push(doi);
                // Add new input if needed
                if (index > existingInputs.length) {
                    addInput();
                    existingInputs = container.querySelectorAll('.input-group');
                }
                
                // Update the input value
                const textarea = existingInputs[index - 1].querySelector('.article-input');
                const title = await getTitle(doi);
                
                // Only fetch citations if we got a valid title
                if (title && title !== "Unknown Title") {
                    // Pre-cache the citing publications
                    await getCitingPubs(doi);
                }
                
                textarea.value = title && title !== "Unknown Title" ? title : doi;
                updateClearButtonVisibility(textarea);
                index++;
                doi = getUrlParameter(`doi${index}`);
            }
            
            // Update remove buttons after all inputs are set up
            updateRemoveButtons();
            
            window.isInitialized = true;

            // If we loaded DOIs from the URL, trigger the search
            if (dois.length > 0) {
                findCommonCitations(dois);
            }
        }
    } catch (error) {
        console.error('Error in initialisePage:', error);
        showError('Failed to initialize page');
    }
}

// Export functions and initialization
export {
    addInput,
    removeInput,
    clearInput,
    copyToClipboard,
    findCommonCitations,
    updateClearButtonVisibility,
    ensureRemoveButton,
    initialisePage
};
