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
        const response = await fetch(`https://api.crossref.org/works/${doi}`);
        const data = await response.json();
        return data.message.title ? data.message.title[0] : 'Title not available';
    } catch (error) {
        console.error('Error fetching publication title:', error);
        return 'Title not available';
    }
}

async function displayResults(commonReferences, doi1, doi2, refCount1, refCount2) {
    const resultsDiv = document.getElementById('results');
    let validReferencesCount = 0;
    
    let html = '';
    
    if (commonReferences.length === 0) {
        html = `<p>No common citations found.</p>`;
    } else {
        // Display number of matching references above the table
        html = `<p><strong>${commonReferences.length} common citations found</strong></p>`;
        
        // Create table with the same width as input fields plus their labels
        html += `<table style="width: 100%; table-layout: fixed; margin-bottom: 20px;">
            <tr>
                <th style="width: 70%;">Title</th>
                <th style="width: 30%;">DOI</th>
            </tr>`;
        
        for (const ref of commonReferences) {
            const title = await getPublicationTitle(ref.citing);
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
        
        // Add reference count information below the table, greyed out and small
        html += `<p style="color: #888; font-size: 0.8em;">${refCount1}/${refCount2} references for the 1st/2nd entry found (${doi1}/${doi2})</p>`;
    }
    
    if (validReferencesCount === 0) {
        html = "<p>No common citations found with available titles.</p>";
    }
    
    resultsDiv.innerHTML = html;
}
