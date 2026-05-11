# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server at http://localhost:5173
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
npm run lint       # Run ESLint
npm run deploy     # Build and push to GitHub Pages (gh-pages branch)
```

## Architecture

**BibTeX Enricher** is a browser-only academic bibliography enrichment tool. Users drop a `.bib` file, the app queries multiple scholarly APIs in parallel, merges the metadata, and offers the enriched file for download.

### Key Design Choices

- **Monolithic component**: All logic lives in [src/App.jsx](src/App.jsx) (~1065 lines). There is no routing, no state management library, no backend.
- **Vite base path**: Set to `/bib-enricher/` in [vite.config.js](vite.config.js) for GitHub Pages deployment.
- **Inline styles**: Colors and most styles are defined inline or as constants inside App.jsx; only global resets are in CSS files.

### Data Flow

1. **Parse** — `parseBib(text)` regex-parses the uploaded `.bib` file into entry objects  
2. **Extract IDs** — `extractIds(fields)` pulls DOI, PMID, PMCID, CorpusId, ArXiv IDs from each entry  
3. **Batch fetch** — Semantic Scholar (500/batch) and OpenAlex (50/batch) are queried in parallel with a 25s timeout  
4. **Per-entry fetch** — CrossRef, Europe PMC, Unpaywall, DataCite run concurrently (max 8 at a time, 8s timeout each)  
5. **Fallback** — CORE is queried by title for entries still missing an abstract (~10 req/min limit)  
6. **Merge** — `mergeMeta(results)` combines results: longest abstract wins; first-found value for other fields; deduplicates keywords  
7. **Apply** — `applyMetaToEntry(entry, meta)` writes merged metadata back, preserving original author data  
8. **Serialize** — `serializeBib(entries)` produces canonical-field-order BibTeX and triggers download

### Core Functions in App.jsx

| Function | Purpose |
|---|---|
| `parseBib` / `serializeBib` | BibTeX round-trip |
| `extractIds` | Identifier extraction (DOI, PMID, etc.) |
| `parseSSResult` / `parseOAResult` | Normalize API responses from Semantic Scholar / OpenAlex |
| `reconstructAbstract` | Rebuild OpenAlex inverted-index abstracts |
| `mergeMeta` | Merge results from all sources with quality heuristics |
| `applyMetaToEntry` | Write merged metadata onto original entries |

### UI Components

All components are defined in App.jsx:
- `BibEnricher` — main orchestration component
- `DropZone` — drag-and-drop file upload
- `EntryRow` — collapsible per-entry display with source pips and status chip
- `SourcePip` — colored indicator for each API source state
- `StatusChip` — PENDING / QUERYING / ENRICHED / PARTIAL / NO DATA badge
