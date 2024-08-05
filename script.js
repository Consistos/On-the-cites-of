async function findCommonCitations() {
    const doi1 = document.getElementById('article1').value.trim();
    const doi2 = document.getElementById('article2').value.trim();
    const resultsDiv = document.getElementById('results');

    if (!doi1 || !doi2) {
        resultsDiv.innerHTML = "Please enter both DOIs.";
        return;
    }

    try {
        const citations1 = await getCitations(doi1);
        const citations2 = await getCitations(doi2);

        const commonCitations = citations1.filter(citation => 
            citations2.some(c => c.cited === citation.cited)
        );

        displayResults(commonCitations);
    } catch (error) {
        resultsDiv.innerHTML = `Error: ${error.message}`;
    }
}

async function getCitations(doi) {
    const apiUrl = `https://opencitations.net/index/coci/api/v1/citations/${doi}`;
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error('Failed to fetch citations');
    }
    return await response.json();
}

function displayResults(commonCitations) {
    const resultsDiv = document.getElementById('results');
    if (commonCitations.length === 0) {
        resultsDiv.innerHTML = "No common citations found.";
    } else {
        let html = "<h2>Common Citations:</h2><ul>";
        commonCitations.forEach(citation => {
            html += `<li>
                <strong>Cited DOI:</strong> ${citation.cited}<br>
                <strong>Citing DOI:</strong> ${citation.citing}<br>
                <strong>Creation Date:</strong> ${citation.creation}<br>
                <strong>OCI:</strong> ${citation.oci}
            </li>`;
        });
        html += "</ul>";
        resultsDiv.innerHTML = html;
    }
}
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

        const citations1 = await getCitations(doi1);
        const citations2 = await getCitations(doi2);

        const commonCitations = citations1.filter(citation => citations2.includes(citation));

        if (commonCitations.length === 0) {
            resultsDiv.innerHTML = 'No common citations found.';
        } else {
            resultsDiv.innerHTML = '<h2>Common Citations:</h2>' + 
                commonCitations.map(doi => `<p>${doi}</p>`).join('');
        }
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

async function getCitations(doi) {
    const response = await fetch(`https://opencitations.net/index/api/v1/citations/${doi}`);
    const data = await response.json();
    return data.map(citation => citation.citing);
}
