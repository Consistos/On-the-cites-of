import {
    getTitle,
    getCitingPubs,
    rateLimiter,
    handleCrossrefResponse,
    handleCrossrefError,
    preCacheCitations,
    preCacheCitationCounts,
    batchGetMetadata
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
    console.log('=== findCommonCitations called ===');
    console.log('initialDois:', initialDois);
    
    const inputs = document.getElementsByClassName('article-input');
    const resultsDiv = document.getElementById('results');
    const nonEmptyInputs = Array.from(inputs).filter(input => input.value.trim() !== '');

    console.log('Input analysis:', {
        totalInputs: inputs.length,
        nonEmptyInputs: nonEmptyInputs.length,
        inputValues: Array.from(nonEmptyInputs).map(input => input.value.trim())
    });

    if (nonEmptyInputs.length === 0) {
        console.log('No non-empty inputs found, showing error message');
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
            
            // Use pushState to create a new history entry that can be navigated back to
            // Only push if the URL is actually different from current URL
            if (newUrl !== window.location.href) {
                console.log('Pushing new URL to history:', newUrl);
                history.pushState({ 
                    searchPerformed: true, 
                    dois: dois,
                    timestamp: Date.now()
                }, '', newUrl);
            }
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
        console.log('Initializing page, URL:', window.location.href);
        console.log('URL search params:', window.location.search);
        
        let index = 1;
        const dois = [];
        let hasInputValues = false;

        // Check for both doi and input parameters
        let doi = getUrlParameter(`doi${index}`);
        let inputValue = getUrlParameter(`input${index}`);
        
        console.log('Initial parameter check:', { doi, inputValue });
        
        // Debug: Check all URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        console.log('All URL parameters:', Object.fromEntries(urlParams.entries()));

        const container = document.getElementById('inputContainer');

        // Initialize if not already done, or if we're handling navigation
        const shouldInitialize = !window.isInitialized || window.isNavigating;
        console.log('Initialization check:', { 
            isInitialized: window.isInitialized, 
            isNavigating: window.isNavigating,
            shouldInitialize: shouldInitialize
        });
        
        if (shouldInitialize) {
            // Count how many URL parameters we have
            let paramCount = 0;
            let tempIndex = 1;
            while (getUrlParameter(`doi${tempIndex}`) || getUrlParameter(`input${tempIndex}`)) {
                paramCount++;
                tempIndex++;
            }
            
            // Get existing inputs
            let existingInputs = container.querySelectorAll('.input-group');

            // If no inputs exist, add the initial inputs
            if (existingInputs.length === 0) {
                // Add at least 2 inputs, or more if we have URL parameters
                const inputsToAdd = Math.max(2, paramCount);
                for (let i = 0; i < inputsToAdd; i++) {
                    addInput();
                }
                existingInputs = container.querySelectorAll('.input-group');
            } else {
                // Ensure we have enough inputs for URL parameters
                while (existingInputs.length < paramCount) {
                    addInput();
                    existingInputs = container.querySelectorAll('.input-group');
                }
                
                // Ensure all existing inputs have remove buttons
                existingInputs.forEach(inputGroup => {
                    ensureRemoveButton(inputGroup);
                });
            }

            // Process URL parameters if they exist
            console.log('Processing URL parameters...');
            while (doi || inputValue) {
                console.log(`Processing parameter ${index}:`, { doi, inputValue });
                
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

                    const displayValue = title && title !== "Unknown Title" ? title : doi;
                    textarea.value = displayValue;
                    console.log(`Set DOI input ${index} to: "${displayValue}"`);
                } else if (inputValue) {
                    // It's an input parameter - just display it
                    // Mark that we have input values to trigger search later
                    hasInputValues = true;
                    const displayValue = decodeURIComponent(inputValue);
                    textarea.value = displayValue;
                    console.log(`Set input ${index} to: "${displayValue}"`);
                }

                updateClearButtonVisibility(textarea);

                index++;
                doi = getUrlParameter(`doi${index}`);
                inputValue = getUrlParameter(`input${index}`);
            }
            
            console.log('Finished processing URL parameters. Final state:', { 
                doisCount: dois.length, 
                hasInputValues, 
                totalInputsProcessed: index - 1 
            });

            // Clear any remaining input fields that don't have URL parameters
            const totalInputs = container.querySelectorAll('.input-group');
            for (let i = index - 1; i < totalInputs.length; i++) {
                const textarea = totalInputs[i].querySelector('.article-input');
                if (textarea && textarea.value && !getUrlParameter(`doi${i + 1}`) && !getUrlParameter(`input${i + 1}`)) {
                    textarea.value = '';
                    updateClearButtonVisibility(textarea);
                }
            }

            // If we have multiple DOIs, batch fetch their metadata for better performance
            if (dois.length > 1) {
                console.log(`Batch fetching metadata for ${dois.length} DOIs`);
                const metadataResults = await batchGetMetadata(dois);
                
                // Update textareas with batch-fetched titles, but only if they don't already have good titles
                dois.forEach((doi, index) => {
                    const textarea = existingInputs[index].querySelector('.article-input');
                    const currentValue = textarea.value;
                    
                    // Only update if current value is the DOI itself (not a title)
                    if (currentValue === doi) {
                        const metadata = metadataResults[doi];
                        const title = metadata?.title;
                        if (title && title !== "Unknown Title") {
                            textarea.value = title;
                            updateClearButtonVisibility(textarea);
                        }
                    }
                });
            }

            // Update remove buttons after all inputs are set up
            updateRemoveButtons();

            window.isInitialized = true;

            // Trigger search if we loaded DOIs from the URL or input values
            console.log('Search trigger check:', { 
                doisLength: dois.length, 
                hasInputValues: hasInputValues,
                isNavigating: window.isNavigating 
            });
            
            if (dois.length > 0) {
                console.log('Triggering search with DOIs:', dois);
                findCommonCitations(dois);
            } else if (hasInputValues) {
                console.log('Triggering search with input values');
                // For input values, trigger a regular search (no pre-resolved DOIs)
                // Add a small delay during navigation to ensure DOM is fully updated
                if (window.isNavigating) {
                    setTimeout(() => {
                        console.log('Delayed search trigger during navigation');
                        findCommonCitations();
                    }, 100);
                } else {
                    findCommonCitations();
                }
            } else {
                console.log('No search triggered - no DOIs or input values found');
            }
        } else {
            console.log('Skipping initialization - already initialized and not navigating');
        }
    } catch (error) {
        console.error('Error in initialisePage:', error);
        showError('Failed to initialize page');
    }
}

// Function to handle browser navigation (back/forward)
async function handleNavigation(event) {
    console.log('Navigation: popstate event fired, URL:', window.location.href);
    console.log('Event state:', event.state);
    
    // Don't handle navigation during initial page load
    if (!window.initialLoadComplete) {
        console.log('Initial load not complete, skipping navigation handling');
        return;
    }
    
    // Prevent multiple simultaneous navigation events
    if (window.isNavigating) {
        console.log('Navigation already in progress, skipping...');
        return;
    }
    
    window.isNavigating = true;
    
    try {
        console.log('Starting navigation handling...');
        
        // Force reinitialize by resetting the flag
        window.isInitialized = false;
        
        // Clear any existing results
        const resultsDiv = document.getElementById('results');
        if (resultsDiv) {
            resultsDiv.innerHTML = '<div class="bg-white shadow-sm rounded-lg overflow-hidden"></div>';
        }
        
        // Clear all existing input values first
        const container = document.getElementById('inputContainer');
        if (container) {
            const existingInputs = container.querySelectorAll('.article-input');
            existingInputs.forEach(input => {
                input.value = '';
                updateClearButtonVisibility(input);
            });
        }
        
        // Clear any global state that might interfere
        window.allSortedReferences = null;
        window.currentPage = 1;
        window.currentGroupedReferences = null;
        
        // Reinitialize the page with the new URL parameters
        console.log('Reinitializing page with URL:', window.location.href);
        await initialisePage();
        console.log('Navigation completed successfully');
    } catch (error) {
        console.error('Navigation error:', error);
        showError('Failed to navigate to the requested page');
    } finally {
        window.isNavigating = false;
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
    handleNavigation
};
