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

        if (references1.length === 0 || references2.length === 0) {
            resultsDiv.innerHTML = 'No references found for one or both articles. The API might not have data for these DOIs.';
            return;
        }

        const commonReferences = references1.filter(ref1 => 
            references2.some(ref2 => ref1.citing === ref2.citing)
        );

        await displayResults(commonReferences, doi1, doi2, references1.length, references2.length);
    } catch (error) {
        resultsDiv.innerHTML = 'An error occurred: ' + error.message;
    }
}

async function getDOI(input) {
    if (input.startsWith('10.')) {
        return input; // It's already a DOI
    }
    
    const response = await fetch(`https://api.crossref.org/works?query=${encodeURIComponent(input)}&rows=1`);
    const data = await response.json();
    
    if (data.message.items.length > 0) {
        return data.message.items[0].DOI;
    }
    return null;
}

async function getReferences(doi) {
    const apiUrl = `https://corsproxy.io/?https://opencitations.net/index/api/v1/citations/${doi}`;
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error('Failed to fetch references');
    }
    const data = await response.json();
    if (data.length === 0) {
        console.warn(`No references found for DOI: ${doi}`);
        return [];
    }
    return data;
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
    
    // Create table with 100% width and adjusted column widths
    let html = `<table style="width: 100%; table-layout: fixed; margin-bottom: 20px;">
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
    <div>
    if (commonReferences.length === 0) {
        <p>No common citations found.</p>;
    } else {
    <p>(${commonReferences.length}) results</p>;
    <p>${refCount1}/{refCount2} references for the 1st/2nd entry found(${doi1})</p>;
    </div>;
    }
    if (validReferencesCount === 0) {
        html = "<p>No common citations found with available titles.</p>";
    }
}
    resultsDiv.innerHTML = html;
}
