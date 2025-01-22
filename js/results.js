import { getTitle, getCitingPubs, preCacheCitations } from './api.js';
import { getDOI } from './identifiers.js';
import { showError } from './ui.js';

async function findCommonCitations(initialDois = null) {
    try {
        const inputs = document.getElementsByClassName('article-input');
        if (inputs.length < 2) {
            showError('Please add at least two papers to compare');
            return;
        }

        // Get DOIs from inputs or use initialDois
        const dois = initialDois || [];
        if (!initialDois) {
            for (const input of inputs) {
                const value = input.value.trim();
                if (!value) continue;

                const doi = await getDOI(value);
                if (doi) {
                    dois.push(doi);
                }
            }
        }

        if (dois.length < 2) {
            showError('Please enter at least two valid papers to compare');
            return;
        }

        // Update URL with DOIs
        const params = new URLSearchParams();
        dois.forEach((doi, index) => {
            params.set(`doi${index + 1}`, doi);
        });
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.lastUrlUpdate = Date.now();
        history.pushState({}, '', newUrl);

        // Get citing publications for each DOI while keeping existing content
        const resultsDiv = document.getElementById('results');
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'absolute top-0 left-0 w-full h-full flex items-center justify-center bg-white bg-opacity-80 z-10';
        loadingDiv.innerHTML = '<div class="text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div><div class="mt-2">Loading citations...</div></div>';
        
        // Only add loading overlay if results exist
        if (resultsDiv.children.length > 0) {
            resultsDiv.style.position = 'relative';
            resultsDiv.appendChild(loadingDiv);
        } else {
            resultsDiv.innerHTML = loadingDiv.innerHTML;
        }

        // Get citing publications for each DOI
        const citingPublications = await Promise.all(dois.map(doi => getCitingPubs(doi)));

        // Find common citations
        const commonReferences = [];
        const refCounts = new Map();

        // Count occurrences of each citing DOI
        citingPublications.forEach(pubs => {
            if (!pubs) return;
            pubs.forEach(pub => {
                const count = refCounts.get(pub.citing) || 0;
                refCounts.set(pub.citing, count + 1);
            });
        });

        // Add references that appear in all papers
        citingPublications[0]?.forEach(pub => {
            if (refCounts.get(pub.citing) === dois.length) {
                commonReferences.push(pub);
            }
        });

        // Pre-cache titles for common references
        const commonDois = commonReferences.map(ref => ref.citing);
        await preCacheCitations(commonDois);

        // Display results
        await displayResults(commonReferences, dois, refCounts);

    } catch (error) {
        console.error('Error in findCommonCitations:', error);
        showError('Failed to find common citations');
    }
}

async function displayResults(commonReferences, dois, refCounts) {
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
        message += 'Note: OpenCitations might not have citation data for the given DOIs.</div>';
        resultsDiv.innerHTML = message;
        return;
    }

    // Deduplicate references first
    const uniqueReferences = Array.from(new Set(commonReferences.map(ref => ref.citing)))
        .map(citing => commonReferences.find(ref => ref.citing === citing));
    
    // Store references in a global variable for lazy loading
    window.allReferences = uniqueReferences;
    window.currentPage = 1;
    const itemsPerPage = 20;

    
    // Function to render a batch of references
    async function renderReferences(start, end) {
        const batch = uniqueReferences.slice(start, end);
        const titlePromises = batch.map(ref => getTitle(ref.citing));
        const titles = await Promise.all(titlePromises);
        
        // Group references by title
        const groupedReferences = {};
        batch.forEach((ref, index) => {
            const title = titles[index];
            if (title !== 'Title not available') {
                if (!groupedReferences[title]) {
                    groupedReferences[title] = [];
                }
                groupedReferences[title].push(ref.citing);
            }
        });
        
        return { groupedReferences, validReferencesCount: Object.keys(groupedReferences).length };
    }

    // Initial render
    const { groupedReferences, validReferencesCount } = await renderReferences(0, itemsPerPage);
    const totalReferences = uniqueReferences.length;

    let html = '';
    
    // Mobile view
    html += `<div class="sm:hidden px-4">`;
    // Results section for mobile
    html += `<h2 class="text-lg text-center mt-8 mb-4">${totalReferences} result${totalReferences === 1 ? '' : 's'}</h2>`;
    if (validReferencesCount === 0) {
        html += `<p>No results with available titles.</p>`;
    } else {
        // Create a container for mobile results
        html += `<div id="mobile-results-container">`;
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
        html += `</div>`; // Close mobile-results-container
    }
    
    // Citations count for mobile
    // Add "Load More" button for mobile if there are more results
    if (totalReferences > itemsPerPage) {
        html += `
            <div class="text-center mt-4 mb-4">
                <button id="load-more-mobile" class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded">
                    Load More
                </button>
            </div>`;
    }

    html += `<div class="mt-4 text-sm text-gray-600">`;
    html += dois.map((doi, index) => `${refCounts[index]} citation${refCounts[index] === 1 ? '' : 's'} found for entry ${index + 1}`).join(' • ');
    html += `</div>`;
    html += `</div>`; // Close mobile view

    // Desktop view
    html += `<div class="hidden sm:block">`;
    // Display number of valid references above the table
    html += `<p class="text-center mb-3">${totalReferences} result${totalReferences === 1 ? '' : 's'}</p>`;
    
    if (validReferencesCount === 0 && commonReferences.length > 0) {
        html += `<p class="text-center">Citations in common found, but no titles available.</p>`;
    } else {
        // Create table with full width
        html += `<div class="w-full max-w-[1400px] mx-auto">
            <table class="w-full text-sm border-collapse border border-gray-300 mt-8" id="results-table">
                <thead bg-gray-50>
                    <tr>
                        <th class="w-[90%] text-gray-600 text-left border border-gray-300 px-4 py-2">Title</th>
                        <th class="w-[5%] text-gray-600 text-left border border-gray-300 px-4 py-2">Google Scholar</th>
                        <th class="w-[5%] text-gray-600 text-left border border-gray-300 px-4 py-2">DOI</th>
                    </tr>
                </thead>
                <tbody id="results-tbody">`;
        
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
            </table>`;

        // Add "Load More" button if there are more results
        if (totalReferences > itemsPerPage) {
            html += `
                <div class="text-center mt-4 mb-8">
                    <button id="load-more" class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded">
                        Load More
                    </button>
                </div>`;
        }
        
        html += `</div>`;
    }
    
    // Citations count for desktop
    html += `<div class="mt-4 text-sm text-gray-600 text-center">`;
    html += dois.map((doi, index) => `${refCounts[index]} citation${refCounts[index] === 1 ? '' : 's'} found for entry ${index + 1}`).join(' • ');
    html += `</div>`;
    html += `</div>`; // Close desktop view
    
    resultsDiv.innerHTML = html;

    // Add event listeners for "Load More" buttons
    const loadMoreButton = document.getElementById('load-more');
    const loadMoreMobileButton = document.getElementById('load-more-mobile');

    const handleLoadMore = async (isMobile) => {
        const start = window.currentPage * itemsPerPage;
        const end = start + itemsPerPage;
        const { groupedReferences } = await renderReferences(start, end);

        if (isMobile) {
            // For mobile view, append new cards
            const mobileResultsContainer = document.getElementById('mobile-results-container');
            for (const [title, dois] of Object.entries(groupedReferences)) {
                const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
                const card = document.createElement('table');
                card.className = 'w-full mb-4 border border-gray-300';
                card.innerHTML = `
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
                `;
                mobileResultsContainer.appendChild(card);
            }
        } else {
            // For desktop view, append to table
            const tbody = document.getElementById('results-tbody');
            for (const [title, dois] of Object.entries(groupedReferences)) {
                const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
                const row = document.createElement('tr');
                row.innerHTML = `
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
                `;
                tbody.appendChild(row);
            }
        }

        window.currentPage++;

        // Hide "Load More" buttons if we've loaded all results
        if (end >= totalReferences) {
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

export { findCommonCitations, displayResults };
