async function findCommonCitations(initialDois = null) {
    const inputs = document.querySelectorAll('.article-input');
    const resultsDiv = document.getElementById('results');

    // Filter out empty inputs
    const nonEmptyInputs = Array.from(inputs).filter(input => input.value.trim() !== '');

    if (nonEmptyInputs.length === 0) {
        resultsDiv.innerHTML = 'Please enter at least one DOI or article title.';
        return;
    }

    resultsDiv.innerHTML = 'Searching...';

    try {
        let dois;
        if (initialDois) {
            dois = initialDois;
        } else {
            dois = await Promise.all(nonEmptyInputs.map(input => getDOI(input.value)));
            
            if (dois.some(doi => !doi)) {
                resultsDiv.innerHTML = 'Could not find DOI for one or more articles';
                return;
            }

            // Update URL with DOIs only if they weren't provided initially
            const encodedDois = dois.map(doi => encodeURIComponent(doi));
            const newUrl = `${window.location.pathname}?${encodedDois.map((doi, index) => `doi${index+1}=${doi}`).join('&')}`;
            history.pushState({}, '', newUrl);
        }

        const allReferences = await Promise.all(dois.map(doi => getReferences(doi)));

        if (allReferences.every(refs => refs.length === 0)) {
            resultsDiv.innerHTML = 'No references found for any of the articles. The API might not have data for these DOIs.';
            return;
        }

        const commonReferences = allReferences.reduce((common, refs, index) => {
            if (index === 0) return refs;
            return common.filter(ref1 => 
                refs.some(ref2 => ref1.citing === ref2.citing)
            );
        }, []);

        await displayResults(commonReferences, dois, allReferences.map(refs => refs.length));
    } catch (error) {
        resultsDiv.innerHTML = 'An error occurred: ' + error.message;
        console.error('Error in findCommonCitations:', error);
    }
}

function addInput() {
    const inputContainer = document.getElementById('inputContainer');
    const newInput = document.createElement('div');
    newInput.className = 'input-group responsive-input-group';
    newInput.innerHTML = `
        <input type="text" class="article-input" placeholder="DOI" size="50">
    `;
    inputContainer.appendChild(newInput);
    updateRemoveButtons();
}

function removeInput(button) {
    const inputGroup = button.parentElement;
    inputGroup.remove();
    updateRemoveButtons();
}

function updateRemoveButtons() {
    const inputGroups = document.querySelectorAll('.input-group');
    inputGroups.forEach((group, index) => {
        let removeButton = group.querySelector('.remove-input');
        if (inputGroups.length > 1) {
            if (!removeButton) {
                removeButton = document.createElement('button');
                removeButton.className = 'remove-input';
                removeButton.onclick = function() { removeInput(this); };
                removeButton.textContent = '-';
                group.appendChild(removeButton);
            }
        } else {
            if (removeButton) {
                removeButton.remove();
            }
        }
    });
}

async function getDOI(input) {
    const inputDOI = input.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    const inputTitle = input.trim();
    const baseUrl = 'https://api.crossref.org/works';
    const query = encodeURIComponent(inputTitle);
    const url = `${baseUrl}?query.bibliographic=${query}&rows=1&select=DOI`;

    // Sanitize and validate the DOI
    if (/^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(inputDOI)) {
        return inputDOI;
    }
    
    try {
        // First, try to fetch using the input as a potential DOI
        const response = await fetch(`${baseUrl}?query=${encodeURIComponent(inputDOI)}&rows=1`);
        const data = await response.json();
        
        if (data.message.items.length > 0) {
            return data.message.items[0].DOI;
        }
        // Non-apparent in the placeholders as the API always seems to return unrelated DOIs
        // If the above fails, try to fetch using the input as a title
        const titleResponse = await fetch(url);
        const titleData = await titleResponse.json();

        if (titleData.message.items && titleData.message.items.length > 0) {
            return titleData.message.items[0].DOI;
        }

        // If both attempts fail, return null
        return null;
    } catch (error) {
        console.error('Error fetching DOI:', error);
        return null;
    }
}

async function getReferences(doi) {
    // CORS proxy to avoid source restriction
    const apiUrl = `https://corsproxy.io/?https://opencitations.net/index/api/v1/citations/${encodeURIComponent(doi)}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.length === 0) {
            console.warn(`No references found for DOI: ${doi}`);
            return [];
        }
        return data;
    } catch (error) {
        console.error(`Error fetching references for DOI ${doi}:`, error);
        return [];
    }
}

async function getPublicationTitle(doi) {
    try {
        const response = await fetch(`https://corsproxy.io/?https://api.crossref.org/works/${doi}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        console.log('Raw response:', text);
        const data = JSON.parse(text);
        return data.message.title ? data.message.title[0] : 'Title not available';
    } catch (error) {
        console.error('Error fetching publication title for DOI:', doi, error);
        return 'Title not available';
    }
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

// Create and show loading overlay
function showLoadingOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'white';
    overlay.style.zIndex = '9999';
    document.body.appendChild(overlay);
}

// Remove loading overlay
function removeLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.remove();
    }
}

// Function to initialize the page
async function initializePage() {
    try {
        const inputContainer = document.getElementById('inputContainer');
        let index = 1;
        let doi = getUrlParameter(`doi${index}`);
        const dois = [];
        
        // Remove all existing input fields
        const inputs = document.querySelectorAll('.input-group');
        inputs.forEach(input => input.remove());
        
        // Always add the first two input fields
        addInput();
        addInput();
        
        while (doi) {
            dois.push(doi);
            if (index > 1) {
                addInput();
            }
            const currentInputs = document.querySelectorAll('.article-input');
            currentInputs[index - 1].value = doi;
            index++;
            doi = getUrlParameter(`doi${index}`);
        }
        
        // Remove any extra empty input fields
        const finalInputs = document.querySelectorAll('.article-input');
        for (let i = finalInputs.length - 1; i >= 2; i--) {
            if (finalInputs[i].value === '') {
                finalInputs[i].parentElement.remove();
            } else {
                break;
            }
        }
        
        if (dois.length > 1) {
            await findCommonCitations(dois);
        }
        
        updateRemoveButtons();
    } catch (error) {
        console.error('Error during page initialization:', error);
    } finally {
        removeLoadingOverlay();
    }
}

// Run initialization after the DOM content has loaded
document.addEventListener('DOMContentLoaded', () => {
    showLoadingOverlay();
    initializePage();
});

async function displayResults(commonReferences, dois, refCounts) {
    const resultsDiv = document.getElementById('results');
    let html = '';
    
    // Fetch all titles concurrently
    const titlePromises = commonReferences.map(ref => getPublicationTitle(ref.citing));
    const titles = await Promise.all(titlePromises);
    
    // Group references by title
    const groupedReferences = {};
    commonReferences.forEach((ref, index) => {
        const title = titles[index];
        if (title !== 'Title not available') {
            if (!groupedReferences[title]) {
                groupedReferences[title] = [];
            }
            groupedReferences[title].push(ref.citing);
        }
    });
    
    const validReferencesCount = Object.keys(groupedReferences).length;
    
    // Display number of valid references above the table
    html += `<p style="text-align: center; margin-bottom: 10px;">${validReferencesCount} ${validReferencesCount === 1 ? 'result' : 'results'}</p>`;
    
    if (validReferencesCount === 0) {
        html += `<p>No results with available titles.</p>`;
    } else {
        // Create table with the same width as input fields plus their labels
        html += `<table style="width: 100%; table-layout: fixed; margin-bottom: 10px;">
            <tr>
                <th style="width: 70%;">Title</th>
                <th style="width: 30%; text-align: center;">DOI(s)</th>
            </tr>`;
        
        for (const [title, dois] of Object.entries(groupedReferences)) {
            const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
            const doiLinks = dois.map(doi => `<a href="https://doi.org/${doi}" target="_blank" style="color: blue; text-decoration: none;">${doi}</a>`).join('<br>');
            html += `<tr>
                <td style="word-wrap: break-word;"><a href="${scholarUrl}" target="_blank" style="color: blue; text-decoration: none;">${title}</a></td>
                <td style="word-wrap: break-word;">${doiLinks}</td>
            </tr>`;
        }
        
        html += `</table>`;
    }
    
    if (validReferencesCount === 0 && commonReferences.length > 0) {
        html += "<p style='text-align: center;'>Citations in common found, but no titles available.</p>";
    }
    
    // ref.s count
    html += `<p style="text-align: center; color: #888; font-size: 0.8em;">`;
    html += dois.map((doi, index) => `${refCounts[index]} citation(s) for entry ${index + 1}`).join('<br>');
    html += `</p>`;
    
    resultsDiv.innerHTML = html;
}
