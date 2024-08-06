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

        displayResults(commonReferences, doi1, doi2, references1.length, references2.length);
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

function displayResults(commonReferences, doi1, doi2, refCount1, refCount2) {
    const resultsDiv = document.getElementById('results');
    let html = `<h2>Results:</h2>`;
    html += `<p>References found for DOI 1 (${doi1}): ${refCount1}</p>`;
    html += `<p>References found for DOI 2 (${doi2}): ${refCount2}</p>`;
    
    if (commonReferences.length === 0) {
        html += "<p>No common citations found.</p>";
    } else {
        html += `<h3>Publications that cite both of them (${commonReferences.length}):</h3>`;
        
        // Create Google Scholar search URL
        const searchQuery = commonReferences.map(ref => `"${ref.citing}"`).join(' OR ');
        const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(searchQuery)}`;
        
        // Add iframe with Google Scholar search results
        html += `<iframe src="${scholarUrl}" width="100%" height="600" frameborder="0"></iframe>`;
    }
    
    resultsDiv.innerHTML = html;
}
