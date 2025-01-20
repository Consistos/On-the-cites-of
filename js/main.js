import { getTitle, getCitingPubs, rateLimiter, handleCrossrefResponse, handleCrossrefError } from './api.js';
import { getCachedData, setCachedData, preCacheCitations } from './cache.js';
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
                return ref.data.some(ref2 => ref1.citing === ref2.citing);
            });
        }, []);

        await displayResults(commonReferences, dois, allReferences.map(ref => ref.data.length));
    } catch (error) {
        resultsDiv.innerHTML = '<div class="text-center text-gray-600">An error occurred: ' + error.message + '</div>';
        console.error('Error in findCommonCitations:', error);
    }
}

// Get URL parameters
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

function initializePage() {
    // Add event listeners to existing textareas
    const textareas = document.getElementsByClassName('article-input');
    Array.from(textareas).forEach(textarea => {
        textarea.addEventListener('input', () => updateClearButtonVisibility(textarea));
    });

    // Add event listeners to existing clear buttons
    const clearButtons = document.getElementsByClassName('clear-input');
    Array.from(clearButtons).forEach(button => {
        button.onclick = () => clearInput(button);
    });

    // Ensure remove buttons exist and are properly set up
    const inputGroups = document.getElementsByClassName('input-group');
    Array.from(inputGroups).forEach(group => ensureRemoveButton(group));

    // Update remove buttons visibility
    updateRemoveButtons();

    // Check URL parameters for DOIs
    if (!window.isInitialized) {
        window.isInitialized = true;
        const dois = [];
        let i = 1;
        let doi;
        while ((doi = getUrlParameter(`doi${i}`))) {
            dois.push(doi);
            i++;
        }

        if (dois.length > 0) {
            // Add input fields if needed
            while (textareas.length < dois.length) {
                addInput();
            }

            // Set DOIs in input fields and get titles
            Promise.all(dois.map(async (doi, index) => {
                const title = await getTitle(doi);
                if (title && title !== "Unknown Title") {
                    await updateInputWithTitle(textareas[index], title);
                } else {
                    textareas[index].value = doi;
                }
                updateClearButtonVisibility(textareas[index]);
            })).then(() => {
                if (Date.now() - window.lastUrlUpdate > 1000) {
                    findCommonCitations(dois);
                }
            });
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.isInitialized = false;
    window.lastUrlUpdate = Date.now();
    initializePage();
    document.querySelectorAll('.article-input').forEach(textarea => {
        textarea.addEventListener('input', function() {
            updateClearButtonVisibility(this);
        });
        updateClearButtonVisibility(textarea);
    });
});

// Handle popstate events (back/forward navigation)
window.addEventListener('popstate', function() {
    // Only reinitialize if this wasn't triggered by our own URL update
    if (Date.now() - window.lastUrlUpdate > 100) {
        window.isInitialized = false;
        initializePage();
    }
});

// Event listeners for search via Enter key
document.addEventListener('keypress', function(event) {
    if (event.target.classList.contains('article-input') && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        findCommonCitations();
    }
});

// Export functions that need to be accessible globally
window.addInput = addInput;
window.removeInput = removeInput;
window.clearInput = clearInput;
window.copyToClipboard = copyToClipboard;
window.findCommonCitations = findCommonCitations;
window.updateClearButtonVisibility = updateClearButtonVisibility;
window.ensureRemoveButton = ensureRemoveButton;
