async function findCommonCitations() {
    const article1 = document.getElementById('article1').value;
    const article2 = document.getElementById('article2').value;
    const resultsDiv = document.getElementById('results');

    resultsDiv.innerHTML = 'Searching...';

    try {
        const doi1 = await getDOI(article1);
        const doi2 = await getDOI(article2);

        if (!doi1 || !doi2) {               
            resultsDiv.innerHTML = 'Could not find DOI for one or both articles. Please check your input.';
            return;
        }

        // Update URL with DOIs
        const encodedDoi1 = encodeURIComponent(doi1);
        const encodedDoi2 = encodeURIComponent(doi2);
        const newUrl = `${window.location.pathname}?doi1=${encodedDoi1}&doi2=${encodedDoi2}`;
        history.pushState({}, '', newUrl);

        const references1 = await getReferences(doi1);
        const references2 = await getReferences(doi2);

        if (references1.length === 0 && references2.length === 0) {
            resultsDiv.innerHTML = 'No references found for both articles. The API might not have data for these DOIs.';
            return;
        }

        if (references1.length === 0) {
            resultsDiv.innerHTML = `No references found for the first article (${doi1}). The API might not have data for this DOI.`;
            return;
        }

        if (references2.length === 0) {
            resultsDiv.innerHTML = `No references found for the second article (${doi2}). The API might not have data for this DOI.`;
            return;
        }

        const commonReferences = references1.filter(ref1 => 
            references2.some(ref2 => ref1.citing === ref2.citing)
        );

        await displayResults(commonReferences, doi1, doi2, references1.length, references2.length);
    } catch (error) {
        resultsDiv.innerHTML = 'An error occurred: ' + error.message;
        console.error('Error in findCommonCitations:', error);
    }
}

async function getDOI(input) {
    // Sanitize and validate the DOI
    const sanitizedInput = input.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    
    if (/^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(sanitizedInput)) {
        return sanitizedInput; 
    }
    
    try {
        const response = await fetch(`https://api.crossref.org/works?query=${encodeURIComponent(sanitizedInput)}&rows=1`);
        const data = await response.json();
        
        if (data.message.items.length > 0) {
            return data.message.items[0].DOI;
        }
    } catch (error) {
        console.error('Error fetching DOI:', error);
    }
    
    return null;
}

async function getReferences(doi) {
    // CORS proxy to avoid restriction
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
document.getElementById('article1').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        findCommonCitations();
    }
});

document.getElementById('article2').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
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
    const doi1 = getUrlParameter('doi1');
    const doi2 = getUrlParameter('doi2');
    if (doi1 && doi2) {
        document.getElementById('article1').value = doi1;
        document.getElementById('article2').value = doi2;
        findCommonCitations();
    }
});

async function displayResults(commonReferences, doi1, doi2, refCount1, refCount2) {
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
                <th style="width: 30%;">DOI</th>
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
                    <td style="word-wrap: break-word;"><a href="${scholarUrl}" target="_blank">${title}</a></td>
                    <td style="word-wrap: break-word;"><a href="${doiUrl}" target="_blank">${ref.citing}</a></td>
                </tr>`;
            }
        }
        
        html += `</table>`;
    }
    
    if (validReferencesCount === 0 && commonReferences.length > 0) {
        html = "<p style='text-align: center;'>Common citations found, but no titles available.</p>";
    }
    
    // ref.s count
    html += `<p style="text-align: center; color: #888; font-size: 0.8em;">${refCount1}/${refCount2} references for the 1st/2nd entry found (${doi1}/${doi2})</p>`;
    
    resultsDiv.innerHTML = html;
}
