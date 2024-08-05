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

        const commonReferences = references1.filter(ref1 => 
            references2.some(ref2 => ref1.citing === ref2.citing)
        );

        displayResults(commonReferences, doi1, doi2);
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
    const apiUrl = `https://opencitations.net/index/coci/api/v1/references/${doi}`;
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error('Failed to fetch references');
    }
    return await response.json();
}

function displayResults(commonReferences, doi1, doi2) {
    const resultsDiv = document.getElementById('results');
    if (commonReferences.length === 0) {
        resultsDiv.innerHTML = "No common citations found.";
    } else {
        let html = "<h2>Articles that cite both input papers:</h2><ul>";
        commonReferences.forEach(reference => {
            html += `<li>
                <strong>Citing DOI:</strong> ${reference.citing}<br>
                <strong>Creation Date:</strong> ${reference.creation}<br>
                <strong>OCI:</strong> ${reference.oci}
            </li>`;
        });
        html += "</ul>";
        html += `<p>Input DOIs: ${doi1}, ${doi2}</p>`;
        resultsDiv.innerHTML = html;
    }
}
