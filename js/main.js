import {
    getTitle,
    getCitingPubs,
    rateLimiter,
    handleCrossrefResponse,
    handleCrossrefError,
    preCacheCitations,
    preCacheCitationCounts
} from './api.js';
import { getCachedData, setCachedData } from './cache.js';
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
    showError,
    addToPublicationSearch,
    updateUrlWithCurrentInputs,
    showProgressIndicator,
    updateProgressIndicator,
    clearProgressIndicator
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

    // Initialize progress indicator
    showProgressIndicator(resultsDiv, 'Initializing search...', 0, 3);

    try {
        let dois;
        if (initialDois) {
            dois = initialDois;
        } else {
            // Step 1: Resolving DOIs
            updateProgressIndicator('Resolving DOIs...', 1, 3);

            // Pre-cache any existing DOIs from the input values
            for (const input of nonEmptyInputs) {
                const value = input.value.trim();
                if (value.startsWith('10.')) {
                    setCachedData(`${value}`, value);
                }
            }

            dois = await Promise.all(nonEmptyInputs.map(async (input, index) => {
                updateProgressIndicator(`Resolving DOIs... (${index + 1}/${nonEmptyInputs.length})`, 1, 3);
                return await getDOI(input);
            }));

            if (dois.some(doi => !doi)) {
                resultsDiv.innerHTML = '<div class="text-center text-gray-600">Could not find DOI for one or more articles</div>';
                return;
            }

            // Update URL with DOIs only if they weren't provided initially
            const encodedDois = dois.map(doi => encodeURIComponent(doi));
            const newUrl = `${window.location.pathname}?${encodedDois.map((doi, index) => `doi${index + 1}=${doi}`).join('&')}`;
            // Record when we last updated the URL to avoid reinitializing
            window.lastUrlUpdate = Date.now();
            
            // Store search state for back/forward navigation
            const searchState = {
                type: 'search',
                dois: dois,
                timestamp: Date.now(),
                hasResults: true
            };
            history.replaceState(searchState, '', newUrl);
        }

        // Step 2: Fetching citations
        updateProgressIndicator('Fetching citations...', 2, 3);

        // Pre-fetch and cache references for all DOIs
        await preCacheCitations(dois, (message) => updateProgressIndicator(message, 2, 3));

        // Get ALL references for all DOIs (not just first page)
        const allReferences = [];
        for (let i = 0; i < dois.length; i++) {
            const doi = dois[i];
            updateProgressIndicator(`Fetching citations... (${i + 1}/${dois.length})`, 2, 3);
            console.log(`Getting references for DOI: ${doi}`);

            // First ensure data is cached
            await getCitingPubs(doi);

            // Then get all cached citations
            const cachedData = getCachedData(doi);
            if (cachedData && Array.isArray(cachedData['cited-by'])) {
                allReferences.push({
                    status: 'SUCCESS',
                    data: cachedData['cited-by'], // Return ALL citations, not paginated
                    totalCount: cachedData['cited-by'].length,
                    hasMore: false,
                    nextOffset: null
                });
            } else {
                // Fallback to regular API call if cache miss
                allReferences.push(await getCitingPubs(doi));
            }
        }

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

        // Debug: Log the references data
        console.log('All references data:', allReferences.map((ref, i) => ({
            doi: dois[i],
            status: ref.status,
            dataLength: ref.data?.length || 0,
            totalCount: ref.totalCount || 0,
            firstFewCitations: ref.data?.slice(0, 3).map(r => r.citing) || []
        })));

        // Step 3: Finding common citations
        updateProgressIndicator('Finding common citations...', 3, 4);

        const commonReferences = allReferences.reduce((common, ref, index) => {
            updateProgressIndicator(`Finding common citations... (${index + 1}/${allReferences.length})`, 3, 4);
            if (index === 0) return ref.data || [];
            return common.filter(ref1 => {
                return (ref.data || []).some(ref2 => {
                    return ref1.citing === ref2.citing;
                });
            });
        }, []);

        console.log(`Found ${commonReferences.length} common citations`);
        if (commonReferences.length > 0) {
            console.log('First few common citations:', commonReferences.slice(0, 3).map(r => r.citing));
        }

        // Step 4: Pre-cache citation counts for better performance
        if (commonReferences.length > 0) {
            updateProgressIndicator('Caching citation counts...', 4, 4);

            // Get unique citing DOIs from common references
            const uniqueCitingDois = Array.from(new Set(commonReferences.map(ref => ref.citing)));

            // Pre-cache citation counts for all unique citing DOIs
            await preCacheCitationCounts(uniqueCitingDois, (message) => updateProgressIndicator(message, 4, 4));
        }

        // Create a refCounts Map for compatibility with displayResults
        const refCounts = new Map();

        // Clear progress indicator before showing results
        clearProgressIndicator();
        await displayResults(commonReferences, dois, refCounts, allReferences);
        
        // Store search results in history state for back/forward navigation
        const searchState = {
            type: 'search',
            dois: dois,
            timestamp: Date.now(),
            hasResults: true,
            resultsData: {
                commonReferences: commonReferences,
                refCounts: refCounts,
                allReferences: allReferences
            }
        };
        
        // Update history state with results data
        const currentUrl = window.location.href;
        window.lastUrlUpdate = Date.now();
        history.replaceState(searchState, '', currentUrl);
    } catch (error) {
        clearProgressIndicator();
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
        let hasInputValues = false;

        // Check for both doi and input parameters
        let doi = getUrlParameter(`doi${index}`);
        let inputValue = getUrlParameter(`input${index}`);

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
            while (doi || inputValue) {
                // Add new input if needed
                if (index > existingInputs.length) {
                    addInput();
                    existingInputs = container.querySelectorAll('.input-group');
                }

                const textarea = existingInputs[index - 1].querySelector('.article-input');

                if (doi) {
                    // It's a DOI parameter - handle as before
                    dois.push(doi);

                    // Fetch cached data once
                    const cachedData = getCachedData(doi);
                    let title;
                    if (!cachedData) {
                        title = await getTitle(doi);
                    } else {
                        title = cachedData.title;
                    }

                    // Check if citations are already cached
                    if (!cachedData?.['cited-by']) {
                        // Pre-cache the citing publications if not cached
                        console.log(`Pre-caching citations for DOI: ${doi} in initialisePage`);
                        await getCitingPubs(doi);
                    } else {
                        console.log(`Citations already cached for DOI: ${doi}, skipping pre-caching in initialisePage`);
                    }

                    textarea.value = title && title !== "Unknown Title" ? title : doi;
                } else if (inputValue) {
                    // It's an input parameter - just display it
                    // Mark that we have input values to trigger search later
                    hasInputValues = true;
                    textarea.value = decodeURIComponent(inputValue);
                }

                updateClearButtonVisibility(textarea);

                index++;
                doi = getUrlParameter(`doi${index}`);
                inputValue = getUrlParameter(`input${index}`);
            }

            // Update remove buttons after all inputs are set up
            updateRemoveButtons();

            window.isInitialized = true;

            // Check if we have existing search results in history state
            const state = history.state;
            const hasStateResults = state && state.type === 'search' && state.hasResults && state.resultsData;
            
            // Verify that the state matches the current URL parameters
            const stateMatchesUrl = hasStateResults && state.dois && 
                state.dois.length === dois.length && 
                state.dois.every((doi, index) => doi === dois[index]);
            
            if (hasStateResults && stateMatchesUrl) {
                // Restore results from state instead of re-searching
                console.log('Restoring search results from browser state');
                await restoreSearchResults(state);
            } else if (dois.length > 0) {
                // Trigger search if we loaded DOIs from the URL
                findCommonCitations(dois);
            } else if (hasInputValues) {
                // For input values, trigger a regular search (no pre-resolved DOIs)
                findCommonCitations();
            }
        }
    } catch (error) {
        console.error('Error in initialisePage:', error);
        showError('Failed to initialize page');
    }
}

// Function to restore search results from history state
async function restoreSearchResults(state) {
    if (!state || state.type !== 'search' || !state.hasResults || !state.resultsData) {
        return false;
    }
    
    try {
        const { commonReferences, refCounts, allReferences } = state.resultsData;
        const { dois } = state;
        
        // Validate that we have the required data
        if (!commonReferences || !dois || !Array.isArray(commonReferences) || !Array.isArray(dois)) {
            console.warn('Invalid search results data in state');
            return false;
        }
        
        console.log(`Restoring search results: ${commonReferences.length} common references for ${dois.length} DOIs`);
        
        // Restore the results display
        await displayResults(commonReferences, dois, refCounts || new Map(), allReferences);
        return true;
    } catch (error) {
        console.error('Error restoring search results:', error);
        return false;
    }
}

// Function to clear search results
function clearSearchResults() {
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) {
        resultsDiv.innerHTML = '<div class="bg-white shadow-sm rounded-lg overflow-hidden"></div>';
    }
}

// Function to handle browser navigation (back/forward)
async function handleNavigation() {
    const state = history.state;
    
    // Only reinitialize if this wasn't triggered by our own URL update
    if (Date.now() - window.lastUrlUpdate > 100) {
        console.log('Handling navigation with state:', state?.type || 'no state');
        
        // Check if we should clear results
        if (state && state.type === 'clear' && !state.hasResults) {
            console.log('Clearing search results due to navigation');
            clearSearchResults();
            window.isInitialized = false;
            await initialisePage();
            return;
        }
        
        // Try to restore search results from state first
        const restored = await restoreSearchResults(state);
        
        if (!restored) {
            // If we can't restore from state, reinitialize the page
            console.log('Could not restore from state, reinitializing page');
            clearSearchResults();
            window.isInitialized = false;
            await initialisePage();
        }
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
    initialisePage,
    addToPublicationSearch,
    updateUrlWithCurrentInputs,
    restoreSearchResults,
    handleNavigation
};
