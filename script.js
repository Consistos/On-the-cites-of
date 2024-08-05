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
