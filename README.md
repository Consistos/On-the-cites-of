# On the cites of

Search for publications that cite multiple papers.

## Running the site

Since the site uses ES modules, you'll need to serve it through a local HTTP server. You can use Python's built-in server:

```bash
python3 -m http.server
```

Then open http://localhost:8000 in your browser.

## Features

- Search by DOI, title, or PubMed/ArXiv URL/ID
- Resolves DOIs and titles automatically
- Shows common citations between multiple papers
- Caches results for faster repeat searches
