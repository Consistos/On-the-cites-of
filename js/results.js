import { getTitle, getCitingPubs, preCacheCitations } from './api.js';
import { showProgressIndicator, updateProgressIndicator, clearProgressIndicator } from './ui.js';
import { getCachedData, setCachedData } from './cache.js';



async function displayResults(commonReferences, dois, refCounts, allReferences = null) {
    const resultsDiv = document.getElementById('results');
    // Remove loading overlay if it exists
    const loadingOverlay = resultsDiv.querySelector('.bg-white.bg-opacity-80');
    if (loadingOverlay) {
        loadingOverlay.remove();
        resultsDiv.style.position = '';
    }
    if (commonReferences.length === 0) {
        let message = '<div class="text-center text-gray-600 mt-4">';
        message += 'No common citations found between these papers.<br>';
        message += 'Note: OpenCitations might not have cited by data for the given DOIs.</div>';
        resultsDiv.innerHTML = message;
        return;
    }

    // Deduplicate references first
    const uniqueReferences = Array.from(new Set(commonReferences.map(ref => ref.citing)))
        .map(citing => commonReferences.find(ref => ref.citing === citing));

    // Get citation counts from cache (should already be pre-cached)
    console.log('Getting citation counts from cache...');

    // Show progress for getting citation counts
    showProgressIndicator(resultsDiv, 'Loading citation counts...', 1, 2);

    // First, try to get all citation counts from cache
    const citationCountsFromCache = uniqueReferences.map((ref, index) => {
        updateProgressIndicator(`Loading citation counts... (${index + 1}/${uniqueReferences.length})`, 1, 2);

        const cacheKey = `citationCount_${ref.citing}`;
        const cachedCount = getCachedData(cacheKey);

        if (cachedCount !== null && cachedCount !== undefined) {
            console.log(`Citation count cache HIT for ${ref.citing}: ${cachedCount}`);
            return { citing: ref.citing, count: cachedCount, cached: true };
        } else {
            console.log(`Citation count cache MISS for ${ref.citing}`);
            return { citing: ref.citing, count: 0, cached: false };
        }
    });

    // Check if any citation counts are missing from cache
    const uncachedRefs = citationCountsFromCache.filter(item => !item.cached);

    if (uncachedRefs.length > 0) {
        console.log(`Found ${uncachedRefs.length} uncached citation counts, fetching from API...`);
        updateProgressIndicator(`Fetching missing citation counts... (0/${uncachedRefs.length})`, 1, 2);

        // Fetch missing citation counts
        const missingCountPromises = uncachedRefs.map(async (item, index) => {
            updateProgressIndicator(`Fetching missing citation counts... (${index + 1}/${uncachedRefs.length})`, 1, 2);

            const cacheKey = `citationCount_${item.citing}`;
            try {
                const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(item.citing)}`);
                if (response.ok) {
                    const data = await response.json();
                    const count = data.message['is-referenced-by-count'] || 0;
                    setCachedData(cacheKey, count);
                    console.log(`Fetched and cached citation count for ${item.citing}: ${count}`);
                    return count;
                }
                setCachedData(cacheKey, 0);
                return 0;
            } catch (error) {
                console.error(`Error fetching citation count for ${item.citing}:`, error);
                setCachedData(cacheKey, 0);
                return 0;
            }
        });

        const missingCounts = await Promise.all(missingCountPromises);

        // Update the citation counts array with fetched values
        let missingIndex = 0;
        citationCountsFromCache.forEach(item => {
            if (!item.cached) {
                item.count = missingCounts[missingIndex++];
                item.cached = true;
            }
        });
    }

    const citationCounts = citationCountsFromCache.map(item => item.count);

    // Create array of ALL references with citation counts (no titles yet)
    const allReferencesWithCounts = uniqueReferences.map((ref, index) => ({
        citing: ref.citing,
        citationCount: citationCounts[index]
    }));

    // Sort ALL references by citation count (descending)
    allReferencesWithCounts.sort((a, b) => b.citationCount - a.citationCount);

    // Store sorted references globally for pagination
    window.allSortedReferences = allReferencesWithCounts;
    window.currentPage = 1;
    const itemsPerPage = 20;

    // Function to render a batch of references from the pre-sorted array
    async function renderReferences(start, end) {
        const batch = window.allSortedReferences.slice(start, end);

        // Fetch titles only for this batch
        const titlePromises = batch.map(ref => getTitle(ref.citing));
        const titles = await Promise.all(titlePromises);

        // Create references with titles for this batch
        const batchWithTitles = batch.map((ref, index) => ({
            citing: ref.citing,
            title: titles[index],
            citationCount: ref.citationCount
        })).filter(ref => ref.title !== 'Title not available');

        // Group references by title (maintaining sort order)
        const groupedReferences = {};
        batchWithTitles.forEach(ref => {
            if (!groupedReferences[ref.title]) {
                groupedReferences[ref.title] = {
                    dois: [],
                    citationCount: ref.citationCount
                };
            }
            groupedReferences[ref.title].dois.push(ref.citing);
        });

        return { groupedReferences, validReferencesCount: Object.keys(groupedReferences).length };
    }

    // Step 2: Rendering results
    updateProgressIndicator('Preparing results...', 2, 2);

    // Initial render
    const { groupedReferences, validReferencesCount } = await renderReferences(0, itemsPerPage);
    const totalReferences = window.allSortedReferences.length;

    // Calculate actual total count - use API totalCount if available for single paper searches
    let actualTotalCount = totalReferences;
    if (allReferences && allReferences.length === 1 && allReferences[0]?.totalCount) {
        actualTotalCount = allReferences[0].totalCount;
    }

    let html = '';

    // Show results count at the top
    html += `<div class="text-center mb-6 mt-4">`;
    if (actualTotalCount > totalReferences) {
        html += `<div class="text-lg font-medium">${actualTotalCount} result${actualTotalCount === 1 ? '' : 's'}</div>`;
    } else {
        html += `<div class="text-lg font-medium">${totalReferences} result${totalReferences === 1 ? '' : 's'}</div>`;
    }

    // Show citation counts for each entry below
    html += `<div class="text-xs">`;
    html += dois.map((doi, index) => {
        if (allReferences && allReferences[index]) {
            const ref = allReferences[index];
            const totalCount = ref?.totalCount || ref?.data?.length || 0;
            return `${totalCount} publications citing entry ${index + 1}`;
        } else {
            return `Publications citing entry ${index + 1}`;
        }
    }).join(' • ');
    html += `</div>`;
    html += `</div>`;

    // Mobile view
    html += `<div class="sm:hidden px-4">`;
    if (validReferencesCount === 0) {
        html += `<p>No results with available titles.</p>`;
    } else {
        // Create a container for mobile results
        html += `<div id="mobile-results-container">`;
        for (const [title, refData] of Object.entries(groupedReferences)) {
            const dois = refData.dois;
            const citationCount = refData.citationCount;
            const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
            html += `
                <table class="w-full mb-4 border border-gray-300 bg-white">
                    <tr>
                        <td class="px-4 py-2">
                            <a href="https://doi.org/${dois[0]}" target="_blank" class="hover:underline block mb-2">${title}</a>
                            <div class="text-sm text-gray-500 mt-1">
                                <a href="index.html?doi1=${encodeURIComponent(dois[0])}" target="_blank" class="hover:underline text-blue-600" title="Find papers that cite this publication">
                                    ${citationCount} citation${citationCount === 1 ? '' : 's'}
                                </a>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-t border-gray-300">
                            <div class="flex justify-between items-center">
                                <a href="${scholarUrl}" target="_blank" class="hover:underline">Google Scholar</a>
                                <div class="flex items-center gap-2">
                                    <span class="text-gray-600">DOI</span>
                                    <button onclick="copyToClipboard('${dois[0]}')" class="text-gray-600 hover:text-blue-600">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002-2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                                        </svg>
                                    </button>
                                    <button data-title="${title.replace(/"/g, '&quot;')}" data-doi="${dois[0]}" onclick="addToPublicationSearch(this.dataset.title, this.dataset.doi)" class="text-blue-600 hover:text-blue-800 text-sm px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 transition-colors">
                                        Add
                                    </button>
                                </div>
                            </div>
                        </td>
                    </tr>
                </table>
            `;
        }
        html += `</div>`; // Close mobile-results-container
    }

    // Add "Load More" button for mobile if there are more results
    const shouldShowLoadMore = (window.allSortedReferences.length > itemsPerPage) || (allReferences && allReferences.some(ref => ref?.hasMore));
    if (shouldShowLoadMore) {
        let buttonText = 'Load More';
        if (allReferences && allReferences.length === 1 && allReferences[0]?.hasMore) {
            // Single paper with more citations
            const remaining = allReferences[0].totalCount - 20;
            buttonText = `Load More (${Math.min(20, remaining)})`;
        } else if (window.allSortedReferences.length > itemsPerPage) {
            // Common citations pagination
            buttonText = `Load More (${Math.min(itemsPerPage, window.allSortedReferences.length - itemsPerPage)})`;
        }
        html += `
            <div class="text-center mt-4 mb-4">
                <button id="load-more-mobile" class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded">
                    ${buttonText}
                </button>
            </div>`;
    }
    html += `</div>`; // Close mobile view

    // Desktop view
    html += `<div class="hidden sm:block">`;

    if (validReferencesCount === 0 && commonReferences.length > 0) {
        html += `<p class="text-center">Citations in common found, but no titles available.</p>`;
    } else {
        // Create table with full width
        html += `<div class="w-full max-w-[1400px] mx-auto">
            <table class="w-full text-sm border-collapse border border-gray-300 mt-8" id="results-table">
                <thead class="bg-white">
                    <tr>
                        <th class="w-[76%] text-gray-600 text-left border border-gray-300 px-4 py-2">Title</th>
                        <th class="w-[7%] text-gray-600 text-center border border-gray-300 px-4 py-2">Cites</th>
                        <th class="w-[5%] text-gray-600 text-left border border-gray-300 px-4 py-2">Google Scholar</th>
                        <th class="w-[6%] text-gray-600 text-left border border-gray-300 px-4 py-2">DOI</th>
                        <th class="w-[6%] text-gray-600 text-center border border-gray-300 px-2 py-2">Add to search</th>
                    </tr>
                </thead>
                <tbody id="results-tbody">`;

        let rowIndex = 0;
        for (const [title, refData] of Object.entries(groupedReferences)) {
            const dois = refData.dois;
            const citationCount = refData.citationCount;
            const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
            html += `<tr>
                <td class="break-words py-2 border border-gray-300 p-2">
                    <a href="https://doi.org/${dois[0]}" target="_blank" class="hover:underline">${title}</a>
                </td>
                <td class="break-words py-2 text-center border border-gray-300 p-2">
                    <a href="index.html?doi1=${encodeURIComponent(dois[0])}" target="_blank" class="hover:underline text-blue-600" title="Find papers that cite this publication">
                        ${citationCount}
                    </a>
                </td>
                <td class="break-words py-2 text-center border border-gray-300 p-2">
                    <a href="${scholarUrl}" target="_blank" class="hover:underline">🔗</a>
                </td>
                <td class="break-words py-2 text-center border border-gray-300 p-2">
                    <div class="relative">
                        <div id="copyMessage-${dois[0]}" class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded-md opacity-0 transition-opacity duration-200">Copied</div>
                        <button onclick="copyToClipboard('${dois[0]}')" class="text-gray-600 hover:text-blue-600">
                            <svg class="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                            </svg>
                        </button>
                        ${dois.length > 1 ? `<div class="text-sm text-gray-600">${dois.length} DOIs</div>` : ''}
                    </div>
                </td>
                <td class="break-words py-2 text-center border border-gray-300 p-2">
                    <button data-title="${title.replace(/"/g, '&quot;')}" data-doi="${dois[0]}" onclick="addToPublicationSearch(this.dataset.title, this.dataset.doi)" class="text-blue-600 hover:text-blue-800 text-sm px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 transition-colors">
                        +
                    </button>
                </td>
            </tr>`;
            rowIndex++;
        }

        html += `</tbody>
            </table>`;

        // Add "Load More" button if there are more results
        if (shouldShowLoadMore) {
            let buttonText = 'Load More';
            if (allReferences && allReferences.length === 1 && allReferences[0]?.hasMore) {
                // Single paper with more citations
                const remaining = allReferences[0].totalCount - 20;
                buttonText = `Load More (${Math.min(20, remaining)} more)`;
            } else if (window.allSortedReferences.length > itemsPerPage) {
                // Common citations pagination
                buttonText = `Load More (${Math.min(itemsPerPage, window.allSortedReferences.length - itemsPerPage)} more)`;
            }
            html += `
                <div class="text-center mt-4 mb-8">
                    <button id="load-more" class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded">
                        ${buttonText}
                    </button>
                </div>`;
        }

        html += `</div>`;
    }


    html += `</div>`; // Close desktop view

    // Clear progress indicator before showing final results
    clearProgressIndicator();
    resultsDiv.innerHTML = html;

    // Add event listeners for "Load More" buttons
    const loadMoreButton = document.getElementById('load-more');
    const loadMoreMobileButton = document.getElementById('load-more-mobile');

    const handleLoadMore = async (isMobile) => {
        // Check if we have a single paper with more citations to load
        if (dois.length === 1 && allReferences && allReferences[0]?.hasMore) {
            const doi = dois[0];
            const nextOffset = allReferences[0].nextOffset;

            // Load more citations from API
            const moreResults = await getCitingPubs(doi, nextOffset);
            if (moreResults.status === 'SUCCESS') {
                // Add new citations to the existing results
                uniqueReferences.push(...moreResults.data);
                window.allReferences = uniqueReferences;

                // Update allReferences with new pagination info
                allReferences[0] = moreResults;

                // Render the new batch
                const start = window.currentPage * itemsPerPage;
                const end = start + itemsPerPage;
                const { groupedReferences } = await renderReferences(start, end);

                // Update UI with new results
                if (isMobile) {
                    // For mobile view, append new cards
                    const mobileResultsContainer = document.getElementById('mobile-results-container');
                    for (const [title, refData] of Object.entries(groupedReferences)) {
                        const dois = refData.dois;
                        const citationCount = refData.citationCount;
                        const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
                        const card = document.createElement('table');
                        card.className = 'w-full mb-4 border border-gray-300 bg-white';
                        card.innerHTML = `
                            <tr>
                                <td class="px-4 py-2">
                                    <a href="https://doi.org/${dois[0]}" target="_blank" class="hover:underline block mb-2">${title}</a>
                                    <div class="text-sm text-gray-500 mt-1">
                                        <a href="index.html?doi1=${encodeURIComponent(dois[0])}" target="_blank" class="hover:underline text-blue-600" title="Find papers that cite this publication">
                                            ${citationCount} citation${citationCount === 1 ? '' : 's'}
                                        </a>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td class="px-4 py-2 border-t border-gray-300">
                                    <div class="flex justify-between items-center">
                                        <a href="${scholarUrl}" target="_blank" class="hover:underline">Google Scholar</a>
                                        <div class="flex items-center gap-2">
                                            <span class="text-gray-600">DOI</span>
                                            <button onclick="copyToClipboard('${dois[0]}')" class="text-gray-600 hover:text-blue-600">
                                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                                                </svg>
                                            </button>
                                            <button data-title="${title.replace(/"/g, '&quot;')}" data-doi="${dois[0]}" onclick="addToPublicationSearch(this.dataset.title, this.dataset.doi)" class="text-blue-600 hover:text-blue-800 text-sm px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 transition-colors">
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        `;
                        mobileResultsContainer.appendChild(card);
                    }
                } else {
                    // For desktop view, append to table
                    const tbody = document.getElementById('results-tbody');
                    const currentRowCount = tbody.children.length;
                    let rowIndex = 0;
                    for (const [title, refData] of Object.entries(groupedReferences)) {
                        const dois = refData.dois;
                        const citationCount = refData.citationCount;
                        const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td class="break-words py-2 border border-gray-300 p-2">
                                <a href="https://doi.org/${dois[0]}" target="_blank" class="hover:underline">${title}</a>
                            </td>
                            <td class="break-words py-2 text-center border border-gray-300 p-2">
                                <a href="index.html?doi1=${encodeURIComponent(dois[0])}" target="_blank" class="hover:underline text-blue-600" title="Find papers that cite this publication">
                                    ${citationCount}
                                </a>
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
                            <td class="break-words py-2 text-center border border-gray-300 p-2">
                                <button data-title="${title.replace(/"/g, '&quot;')}" data-doi="${dois[0]}" onclick="addToPublicationSearch(this.dataset.title, this.dataset.doi)" class="text-blue-600 hover:text-blue-800 text-sm px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 transition-colors">
                                    +
                                </button>
                            </td>
                        `;
                        tbody.appendChild(row);
                        rowIndex++;
                    }
                }

                window.currentPage++;

                // Update button text and hide if no more results
                if (!moreResults.hasMore) {
                    if (loadMoreButton) loadMoreButton.style.display = 'none';
                    if (loadMoreMobileButton) loadMoreMobileButton.style.display = 'none';
                } else {
                    const remaining = moreResults.totalCount - (nextOffset + 20);
                    const nextBatch = Math.min(20, remaining);
                    if (loadMoreButton) loadMoreButton.textContent = `Load More (${nextBatch} more)`;
                    if (loadMoreMobileButton) loadMoreMobileButton.textContent = `Load More (${nextBatch} more)`;
                }

                return;
            }
        }

        // Original pagination logic for common citations
        const start = window.currentPage * itemsPerPage;
        const end = start + itemsPerPage;
        const { groupedReferences } = await renderReferences(start, end);

        if (isMobile) {
            // For mobile view, append new cards
            const mobileResultsContainer = document.getElementById('mobile-results-container');
            for (const [title, refData] of Object.entries(groupedReferences)) {
                const dois = refData.dois;
                const citationCount = refData.citationCount;
                const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
                const card = document.createElement('table');
                card.className = 'w-full mb-4 border border-gray-300 bg-white';
                card.innerHTML = `
                    <tr>
                        <td class="px-4 py-2">
                            <a href="https://doi.org/${dois[0]}" target="_blank" class="hover:underline block mb-2">${title}</a>
                            <div class="text-sm text-gray-500 mt-1">
                                <a href="index.html?doi1=${encodeURIComponent(dois[0])}" target="_blank" class="hover:underline text-blue-600" title="Find papers that cite this publication">
                                    ${citationCount} citation${citationCount === 1 ? '' : 's'}
                                </a>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-t border-gray-300">
                            <div class="flex justify-between items-center">
                                <a href="${scholarUrl}" target="_blank" class="hover:underline">Google Scholar</a>
                                <div class="flex items-center gap-2">
                                    <span class="text-gray-600">DOI</span>
                                    <button onclick="copyToClipboard('${dois[0]}')" class="text-gray-600 hover:text-blue-600">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                                        </svg>
                                    </button>
                                    <button data-title="${title.replace(/"/g, '&quot;')}" data-doi="${dois[0]}" onclick="addToPublicationSearch(this.dataset.title, this.dataset.doi)" class="text-blue-600 hover:text-blue-800 text-sm px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 transition-colors">
                                        Add
                                    </button>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
                mobileResultsContainer.appendChild(card);
            }
        } else {
            // For desktop view, append to table
            const tbody = document.getElementById('results-tbody');
            const currentRowCount = tbody.children.length;
            let rowIndex = 0;
            for (const [title, refData] of Object.entries(groupedReferences)) {
                const dois = refData.dois;
                const citationCount = refData.citationCount;
                const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="break-words py-2 border border-gray-300 p-2">
                        <a href="https://doi.org/${dois[0]}" target="_blank" class="hover:underline">${title}</a>
                    </td>
                    <td class="break-words py-2 text-center border border-gray-300 p-2">
                        <a href="index.html?doi1=${encodeURIComponent(dois[0])}" target="_blank" class="hover:underline text-blue-600" title="Find papers that cite this publication">
                            ${citationCount}
                        </a>
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
                    <td class="break-words py-2 text-center border border-gray-300 p-2">
                        <button data-title="${title.replace(/"/g, '&quot;')}" data-doi="${dois[0]}" onclick="addToPublicationSearch(this.dataset.title, this.dataset.doi)" class="text-blue-600 hover:text-blue-800 text-sm px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 transition-colors">
                            +
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
                rowIndex++;
            }
        }

        window.currentPage++;

        // Hide "Load More" buttons if we've loaded all results
        if (end >= window.allSortedReferences.length) {
            if (loadMoreButton) loadMoreButton.style.display = 'none';
            if (loadMoreMobileButton) loadMoreMobileButton.style.display = 'none';
        }
    };

    if (loadMoreButton) {
        loadMoreButton.addEventListener('click', () => handleLoadMore(false));
    }
    if (loadMoreMobileButton) {
        loadMoreMobileButton.addEventListener('click', () => handleLoadMore(true));
    }
}

export { displayResults };
