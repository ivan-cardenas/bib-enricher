# BibTeX Enricher

**A browser-based metadata enrichment tool for BibTeX bibliographies.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=flat-square&logo=github)](https://ivan-cardenas.github.io/bib-enricher/)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-☕-ffdd00?style=flat-square&labelColor=1a1000&color=ffdd00)](https://www.buymeacoffee.com/ivancardenas)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## Overview

Managing bibliographies in academic research is a time-consuming task. Reference managers often produce incomplete `.bib` files — missing abstracts, keywords, DOIs, citation counts, or open-access links. Manual curation across multiple databases is tedious and error-prone.

**BibTeX Enricher** automates this process. Upload a `.bib` file; the tool queries seven scholarly metadata sources in parallel, merges the results by quality, and produces an enriched `.bib` file ready for use in LaTeX, Zotero, or any BibTeX-compatible workflow — all without installing any software or leaving your browser.

---

## Features

- **Batch API calls** — Semantic Scholar and OpenAlex are queried in a single batch request for all entries, significantly reducing total API round-trips and wall-clock time.
- **Parallel per-entry enrichment** — CrossRef, Europe PMC, Unpaywall, and DataCite are queried concurrently (up to 8 entries at a time) rather than sequentially.
- **Intelligent merging** — the longest non-trivial abstract is preferred; other fields follow a source-priority order.
- **CORE fallback** — entries without an abstract after the primary sources are searched via [CORE](https://core.ac.uk/), which aggregates content from institutional repositories, ResearchGate, and Google Scholar-indexed papers.
- **No backend, no login** — runs entirely in the browser; your bibliography never leaves your machine.
- **One-click download** — the enriched `.bib` is written with a canonical field order and is immediately usable.

---

## Data Sources

| Source | Batch | Identifier support | Provides abstract |
|---|:---:|---|:---:|
| [Semantic Scholar](https://www.semanticscholar.org/) | ✅ (500/req) | DOI, PMID, ArXiv, CorpusId | ✅ |
| [OpenAlex](https://openalex.org/) | ✅ (50/req) | DOI | ✅ |
| [CrossRef](https://www.crossref.org/) | — | DOI | Partial |
| [Europe PMC](https://europepmc.org/) | — | DOI, PMID, title | ✅ |
| [Unpaywall](https://unpaywall.org/) | — | DOI | — (OA links) |
| [DataCite](https://datacite.org/) | — | DOI | ✅ |
| [CORE](https://core.ac.uk/) *(fallback)* | — | Title search | ✅ |

---

## Enriched Fields

For each entry the tool attempts to populate:

`abstract` · `author` · `year` · `journal` · `volume` · `number` · `pages` · `doi` · `url` · `pmid` · `pmcid` · `issn` · `publisher` · `language` · `keywords` · `annote` (citation count, open-access status, TLDR)

---

## Usage

### Online (recommended)

Visit **[ivan-cardenas.github.io/bib-enricher](https://ivan-cardenas.github.io/bib-enricher/)** — no installation required.

1. Drag and drop (or click to browse) your `.bib` file.
2. Click **▶ ENRICH ALL**.
3. Wait for enrichment to complete — progress is shown per entry and per source.
4. Click **⬇ DOWNLOAD .BIB** to save the enriched file.

### Local development

```bash
git clone https://github.com/ivan-cardenas/bib-enricher.git
cd bib-enricher
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build & deploy

```bash
npm run build      # production build → dist/
npm run deploy     # push dist/ to gh-pages branch
```

---

## Technical Notes

- **Rate limits** — all API calls include polite `User-Agent` headers. The CORE API allows ~10 requests/minute on the free tier; the fallback fires only for entries still missing an abstract after all primary sources.
- **Timeouts** — each individual API call times out after 8 s; batch calls after 25 s. Failed calls are silently skipped and do not block the pipeline.
- **Field merging** — `abstract` is overwritten only if the new value is longer. All other fields are set only when absent in the original entry, preserving author-supplied data.
- **No API keys required** — all sources used are publicly accessible without authentication.

---

## Author

**Ivan Cardenas**
[github.com/ivan-cardenas](https://github.com/ivan-cardenas) · [buymeacoffee.com/ivancardenas](https://www.buymeacoffee.com/ivancardenas)

---

## Support

If BibTeX Enricher saved you time on a paper, a thesis, or a systematic review, consider supporting its development:

[![Buy Me a Coffee](https://img.shields.io/badge/☕_Buy_me_a_coffee-ffdd00?style=for-the-badge&labelColor=1a1000&color=ffdd00)](https://www.buymeacoffee.com/ivancardenas)

---

## License

MIT © 2025 Ivan Cardenas

Permission is hereby granted, free of charge, to any person obtaining a copy of this software to use, copy, modify, merge, publish, distribute, and/or sublicense it, subject to the standard MIT terms.
