async function findCommonCitations() {
    const inputs = document.querySelectorAll('.article-input');
    const resultsDiv = document.getElementById('results');

    resultsDiv.innerHTML = 'Searching...';

    try {
        const dois = await Promise.all(Array.from(inputs).map(input => getDOI(input.value)));
        
        if (dois.some(doi => !doi)) {
            resultsDiv.innerHTML = 'Could not find DOI for one or more articles';
            return;
        }

        // Update URL with DOIs
        const encodedDois = dois.map(doi => encodeURIComponent(doi));
        const newUrl = `${window.location.pathname}?${encodedDois.map((doi, index) => `doi${index+1}=${doi}`).join('&')}`;
        history.pushState({}, '', newUrl);

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
    newInput.className = 'input-group';
    newInput.innerHTML = `
        <input type="text" class="article-input" placeholder="Title or DOI" size="50">
        <button class="remove-input" onclick="removeInput(this)">-</button>
    `;
    inputContainer.appendChild(newInput);
}

function removeInput(button) {
    const inputGroup = button.parentElement;
    if (document.querySelectorAll('.input-group').length > 2) {
        inputGroup.remove();
    }
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
        const response = await fetch(`https://corsproxy.io/?https://api.A.org/works/${doi}`);
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

// Check for DOI parameters & search on page load if there
window.addEventListener('load', function() {
    const inputContainer = document.getElementById('inputContainer');
    let index = 1;
    let doi = getUrlParameter(`doi${index}`);
    
    while (doi) {
        if (index > 1) {
            addInput();
        }
        const inputs = document.querySelectorAll('.article-input');
        inputs[index - 1].value = doi;
        index++;
        doi = getUrlParameter(`doi${index}`);
    }
    
    if (index > 1) {
        findCommonCitations();
    }
});

async function displayResults(commonReferences, dois, refCounts) {
    const resultsDiv = document.getElementById('results');
    let validReferencesCount = 0;
    
    // Display number of matching references above the table
    let html = `<p style="text-align: center; margin-bottom: 10px;">${commonReferences.length} results</p>`;
    
    if (commonReferences.length === 0) {
        html += `<p>No results.</p>`;
    } else {
        // Create table with the same width as input fields plus their labels
        html += `<table style="width: 100%; table-layout: fixed; margin-bottom: 10px;">
            <tr>
                <th style="width: 70%;">Title</th>
                <th style="width: 30%; text-align: center;">DOI</th>
            </tr>`;
        
        // Fetch all titles concurrently
        const titlePromises = commonReferences.map(ref => getPublicationTitle(ref.citing));
        const titles = await Promise.all(titlePromises);
        
        for (let i = 0; i < commonReferences.length; i++) {
            const ref = commonReferences[i];
            const title = titles[i];
            if (title !== 'Title not available') {
                validReferencesCount++;
                const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(ref.citing)}`;
                const doiUrl = `https://doi.org/${ref.citing}`;
                html += `<tr>
                    <td style="word-wrap: break-word;"><a href="${scholarUrl}" target="_blank" style="color: blue; text-decoration: none;">${title}</a></td>
                    <td style="word-wrap: break-word;"><a href="${doiUrl}" target="_blank" style="color: blue; text-decoration: none;">${ref.citing}</a></td>
                </tr>`;
            }
        }
        
        html += `</table>`;
    }
    
    if (validReferencesCount === 0 && commonReferences.length > 0) {
        html = "<p style='text-align: center;'>Citations in common found, but no titles available.</p>";
    }
    
    // ref.s count
    html += `<p style="text-align: center; color: #888; font-size: 0.8em;">`;
    html += dois.map((doi, index) => `${refCounts[index]} references for entry ${index + 1} (${doi})`).join('<br>');
    html += `</p>`;
    
    resultsDiv.innerHTML = html;
}
