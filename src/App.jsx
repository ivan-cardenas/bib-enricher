import { useState, useRef } from "react";

// ═══════════════════════════════════════════════════════════════
// BIB PARSER
// ═══════════════════════════════════════════════════════════════
function parseBib(text) {
  const entries = [];
  const entryRegex = /@(\w+)\s*\{\s*([^,]+),/gm;
  let match;
  while ((match = entryRegex.exec(text)) !== null) {
    const type = match[1];
    const key = match[2].trim();
    const start = match.index;
    let depth = 0, end = start;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const raw = text.slice(start, end);
    const body = raw.slice(raw.indexOf(",") + 1);
    const fields = {};
    const fieldRe = /(\w+)\s*=\s*(?:\{([\s\S]*?)\}(?=\s*[,}])|"([\s\S]*?)"(?=\s*[,}])|(\d+)(?=\s*[,}]))/gm;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      const k = fm[1].toLowerCase();
      const v = (fm[2] ?? fm[3] ?? fm[4] ?? "").trim();
      if (k && v) fields[k] = v;
    }
    entries.push({ type, key, fields, raw });
  }
  return entries;
}

function serializeBib(entries) {
  return entries.map(e => {
    const FIELD_ORDER = ["title","author","year","journal","booktitle","volume","number","issue",
      "pages","publisher","address","school","institution","doi","url","pmid","pmcid","issn","isbn",
      "keywords","language","abstract","note","annote"];
    const allKeys = [...new Set([...FIELD_ORDER, ...Object.keys(e.fields)])];
    const lines = [`@${e.type}{${e.key},`];
    for (const k of allKeys) {
      const v = e.fields[k];
      if (v && String(v).trim()) lines.push(`  ${k} = {${v}},`);
    }
    lines.push(`}`);
    return lines.join("\n");
  }).join("\n\n");
}

// ═══════════════════════════════════════════════════════════════
// ID EXTRACTION
// ═══════════════════════════════════════════════════════════════
function extractIds(fields) {
  const url = fields.url || "";
  const rawDoi = fields.doi || "";
  let doi = rawDoi ||
    url.match(/https?:\/\/(?:dx\.)?doi\.org\/(.+)/)?.[1]?.trim() ||
    url.match(/(10\.\d{4,}\/[^\s"&]+)/)?.[1]?.trim() || null;
  if (doi) doi = doi.replace(/[.,;]$/, "").trim();

  const corpusId = url.match(/CorpusId[:/](\d+)/i)?.[1] ||
    url.match(/semanticscholar\.org\/paper\/[^/]+\/([a-f0-9]{40})/i)?.[1] || null;
  const pmid = url.match(/pubmed[./](\d+)/i)?.[1] ||
    url.match(/PMID[:/](\d+)/i)?.[1] ||
    fields.pmid || null;
  const pmcid = fields.pmcid ||
    url.match(/pmc[./](PMC\d+)/i)?.[1] || null;
  const arxivId = url.match(/arxiv\.org\/abs\/([0-9.]+)/i)?.[1] ||
    fields.eprint || null;

  return { doi, corpusId, pmid, pmcid, arxivId };
}

// ═══════════════════════════════════════════════════════════════
// OPENALEX ABSTRACT RECONSTRUCTOR
// ═══════════════════════════════════════════════════════════════
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return null;
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(" ").trim() || null;
}

// ═══════════════════════════════════════════════════════════════
// RESULT PARSERS (shared between single and batch fetchers)
// ═══════════════════════════════════════════════════════════════
const SS_FIELDS = "abstract,title,authors,year,venue,journal,externalIds," +
  "isOpenAccess,openAccessPdf,citationCount,referenceCount,tldr,fieldsOfStudy,s2FieldsOfStudy";

function parseSSResult(w) {
  if (!w || w.error) return null;
  const kw = w.fieldsOfStudy?.join("; ") ||
    w.s2FieldsOfStudy?.map(f => f.category).join("; ") || null;
  return {
    abstract: w.abstract || null,
    title: w.title || null,
    year: w.year?.toString() || null,
    journal: w.journal?.name || w.venue || null,
    volume: w.journal?.volume || null,
    pages: w.journal?.pages || null,
    doi: w.externalIds?.DOI || null,
    pmid: w.externalIds?.PubMed || null,
    pmcid: w.externalIds?.PubMedCentral || null,
    authors: w.authors?.map(a => a.name).filter(Boolean) || null,
    citationCount: w.citationCount?.toString() || null,
    referenceCount: w.referenceCount?.toString() || null,
    openAccess: w.isOpenAccess ? "true" : null,
    openAccessUrl: w.openAccessPdf?.url || null,
    tldr: w.tldr?.text || null,
    keywords: kw,
    source: "Semantic Scholar",
  };
}

function parseOAResult(w) {
  if (!w) return null;
  const abstract = reconstructAbstract(w.abstract_inverted_index);
  const journal = w.primary_location?.source?.display_name ||
    w.host_venue?.display_name || null;
  const oaUrl = w.open_access?.oa_url || w.primary_location?.pdf_url || null;
  const concepts = w.concepts?.slice(0, 8).map(c => c.display_name).join("; ") || null;
  const keywords = w.keywords?.map(k => k.keyword).join("; ") || null;
  const meshTerms = w.mesh?.map(m => m.descriptor_name).join("; ") || null;
  return {
    abstract,
    title: w.title?.replace(/\s+/g, " ").trim() || null,
    year: w.publication_year?.toString() || null,
    journal,
    volume: w.biblio?.volume || null,
    issue: w.biblio?.issue || null,
    pages: w.biblio?.first_page && w.biblio?.last_page
      ? `${w.biblio.first_page}--${w.biblio.last_page}`
      : w.biblio?.first_page || null,
    doi: w.doi?.replace("https://doi.org/", "") || null,
    pmid: w.ids?.pmid?.replace("https://pubmed.ncbi.nlm.nih.gov/", "") || null,
    pmcid: w.ids?.pmcid || null,
    url: oaUrl || w.doi || null,
    citationCount: w.cited_by_count?.toString() || null,
    openAccess: w.open_access?.is_oa ? "true" : null,
    keywords: keywords || meshTerms || concepts,
    authors: w.authorships?.map(a => a.author?.display_name).filter(Boolean) || null,
    language: w.language || null,
    source: "OpenAlex",
  };
}

// ═══════════════════════════════════════════════════════════════
// BATCH FETCHERS
// ═══════════════════════════════════════════════════════════════

// Fetch up to 500 papers at once via SS batch endpoint
async function fetchSemanticScholarBatch(entryIdsList) {
  const toFetch = entryIdsList.map(({ key, ids }) => {
    let paperId = null;
    if (ids.doi) paperId = ids.doi;
    else if (ids.pmid) paperId = `PMID:${ids.pmid}`;
    else if (ids.corpusId) paperId = `CorpusId:${ids.corpusId}`;
    else if (ids.arxivId) paperId = `ArXiv:${ids.arxivId}`;
    return { key, paperId };
  }).filter(x => x.paperId);

  if (toFetch.length === 0) return {};

  const result = {};
  const CHUNK = 500;
  for (let i = 0; i < toFetch.length; i += CHUNK) {
    const chunk = toFetch.slice(i, i + CHUNK);
    try {
      const r = await fetch(
        `https://api.semanticscholar.org/graph/v1/paper/batch?fields=${SS_FIELDS}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk.map(x => x.paperId) }),
        }
      );
      if (!r.ok) continue;
      const data = await r.json();
      if (!Array.isArray(data)) continue;
      chunk.forEach(({ key }, idx) => {
        const parsed = parseSSResult(data[idx]);
        if (parsed) result[key] = parsed;
      });
    } catch { /* continue */ }
  }
  return result;
}

// Fetch multiple DOIs at once via OpenAlex filter
async function fetchOpenAlexBatch(entryIdsList) {
  const doiEntries = entryIdsList
    .map(({ key, ids }) => ({ key, doi: ids.doi }))
    .filter(x => x.doi);

  if (doiEntries.length === 0) return {};

  const result = {};
  const CHUNK = 50; // keep URL length manageable
  for (let i = 0; i < doiEntries.length; i += CHUNK) {
    const chunk = doiEntries.slice(i, i + CHUNK);
    try {
      const filter = chunk.map(x => `doi:https://doi.org/${x.doi}`).join("|");
      const r = await fetch(
        `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&per_page=${CHUNK}`,
        { headers: { "User-Agent": "BibEnricher/2.0" } }
      );
      if (!r.ok) continue;
      const d = await r.json();
      for (const w of d.results || []) {
        const wDoi = w.doi?.replace("https://doi.org/", "").toLowerCase();
        const entry = chunk.find(x => x.doi.toLowerCase() === wDoi);
        if (entry) result[entry.key] = parseOAResult(w);
      }
    } catch { /* continue */ }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// SINGLE-ENTRY FETCHERS (title-based fallbacks & per-entry sources)
// ═══════════════════════════════════════════════════════════════

async function fetchCrossRef(doi) {
  if (!doi) return null;
  try {
    const r = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      { headers: { "User-Agent": "BibEnricher/2.0 (mailto:research@example.com)" } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const w = d.message;
    return {
      abstract: w.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null,
      title: w.title?.[0]?.replace(/\s+/g, " ").trim() || null,
      year: w.published?.["date-parts"]?.[0]?.[0]?.toString() ||
            w["published-print"]?.["date-parts"]?.[0]?.[0]?.toString() || null,
      journal: w["container-title"]?.[0] || w["short-container-title"]?.[0] || null,
      volume: w.volume || null,
      issue: w.issue || null,
      pages: w.page || null,
      publisher: w.publisher || null,
      issn: (w.ISSN || w["ISSN-type"]?.map(i => i.value))?.[0] || null,
      doi: w.DOI || doi,
      url: w.URL || `https://doi.org/${doi}`,
      authors: w.author?.map(a => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean) || null,
      language: w.language || null,
      source: "CrossRef",
    };
  } catch { return null; }
}

// Title-based OA lookup (only used when not found in batch)
async function fetchOpenAlexByTitle(title) {
  if (!title) return null;
  try {
    const q = encodeURIComponent(`"${title.slice(0, 100)}"`);
    const r = await fetch(
      `https://api.openalex.org/works?search=${q}&per_page=1`,
      { headers: { "User-Agent": "BibEnricher/2.0" } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return parseOAResult(d.results?.[0]);
  } catch { return null; }
}

// Title-based SS lookup (only used when not found in batch)
async function fetchSemanticScholarByTitle(title) {
  if (!title) return null;
  try {
    const q = encodeURIComponent(title.slice(0, 120));
    const sr = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${q}&limit=1&fields=paperId`
    );
    if (!sr.ok) return null;
    const sd = await sr.json();
    const paperId = sd.data?.[0]?.paperId;
    if (!paperId) return null;
    const r = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=${SS_FIELDS}`
    );
    if (!r.ok) return null;
    return parseSSResult(await r.json());
  } catch { return null; }
}

async function fetchEuropePMC(doi, pmid, title) {
  try {
    let query;
    if (doi) query = `DOI:"${doi}"`;
    else if (pmid) query = `EXT_ID:${pmid} AND SRC:MED`;
    else if (title) query = `TITLE:"${title.slice(0, 80)}"`;
    else return null;

    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=1`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const w = d.resultList?.result?.[0];
    if (!w) return null;

    const meshKeywords = w.meshHeadingList?.meshHeading?.map(m => m.descriptorName).join("; ") || null;
    const chemKeywords = w.chemicalList?.chemical?.map(c => c.name).join("; ") || null;
    const kwList = w.keywordList?.keyword?.join("; ") || null;
    const mergedKw = [meshKeywords, chemKeywords, kwList].filter(Boolean).join("; ") || null;

    return {
      abstract: w.abstractText || null,
      title: w.title?.replace(/\.$/, "") || null,
      year: w.pubYear || null,
      journal: w.journalTitle || w.journalInfo?.journal?.title || null,
      volume: w.journalInfo?.volume || null,
      issue: w.journalInfo?.issue || null,
      pages: w.pageInfo || null,
      doi: w.doi || null,
      pmid: w.pmid || null,
      pmcid: w.pmcid || null,
      publisher: w.publisherLocation || null,
      language: w.language || null,
      keywords: mergedKw,
      grants: w.grantsList?.grant?.map(g => `${g.grantId} (${g.agency})`).join("; ") || null,
      authors: w.authorList?.author?.map(a =>
        [a.firstName, a.lastName].filter(Boolean).join(" ")
      ).filter(Boolean) || null,
      citationCount: w.citedByCount?.toString() || null,
      source: "Europe PMC",
    };
  } catch { return null; }
}

async function fetchUnpaywall(doi) {
  if (!doi) return null;
  try {
    const r = await fetch(
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=research@example.com`
    );
    if (!r.ok) return null;
    const w = await r.json();
    const best = w.best_oa_location;
    return {
      openAccess: w.is_oa ? "true" : "false",
      openAccessUrl: best?.url_for_pdf || best?.url || null,
      license: w.oa_status || null,
      journal: w.journal_name || null,
      publisher: w.publisher || null,
      issn: w.journal_issn_l || null,
      source: "Unpaywall",
    };
  } catch { return null; }
}

async function fetchDataCite(doi) {
  if (!doi) return null;
  try {
    const r = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const w = d.data?.attributes;
    if (!w) return null;
    const abstract = w.descriptions?.find(d => d.descriptionType === "Abstract")?.description || null;
    return {
      abstract,
      title: w.titles?.[0]?.title || null,
      year: w.publicationYear?.toString() || null,
      publisher: w.publisher || null,
      doi: w.doi || null,
      keywords: w.subjects?.map(s => s.subject).filter(Boolean).join("; ") || null,
      authors: w.creators?.map(c => c.name).filter(Boolean) || null,
      language: w.language || null,
      source: "DataCite",
    };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK: CORE (aggregates ResearchGate, institutional repos, etc.)
// ═══════════════════════════════════════════════════════════════
async function fetchCORE(title) {
  if (!title) return null;
  try {
    const q = encodeURIComponent(`"${title.slice(0, 100)}"`);
    const r = await fetch(
      `https://api.core.ac.uk/v3/search/works?q=${q}&limit=1`,
      { headers: { Accept: "application/json" } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const w = d.results?.[0];
    if (!w) return null;
    return {
      abstract: w.abstract || null,
      title: w.title || null,
      year: w.yearPublished?.toString() || null,
      doi: w.doi || null,
      authors: w.authors?.map(a => a.name).filter(Boolean) || null,
      publisher: w.publisher || null,
      url: w.downloadUrl || w.sourceFulltextUrls?.[0] || null,
      source: "CORE",
    };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// MERGE METADATA (best value wins, longest abstract wins)
// ═══════════════════════════════════════════════════════════════
function mergeMeta(results) {
  const merged = {};
  const pick = (key) => results.map(r => r?.[key]).find(v => v && String(v).trim()) || null;

  const abstracts = results.map(r => r?.abstract).filter(a => a && a.trim().length > 20);
  merged.abstract = abstracts.sort((a, b) => b.length - a.length)[0] || null;

  merged.title = pick("title");
  merged.year = pick("year");
  merged.journal = pick("journal");
  merged.volume = pick("volume");
  merged.issue = pick("issue");
  merged.pages = pick("pages");
  merged.publisher = pick("publisher");
  merged.doi = pick("doi");
  merged.url = pick("openAccessUrl") || pick("url");
  merged.pmid = pick("pmid");
  merged.pmcid = pick("pmcid");
  merged.issn = pick("issn");
  merged.language = pick("language");
  merged.citationCount = pick("citationCount");
  merged.openAccess = pick("openAccess");
  merged.tldr = pick("tldr");
  merged.grants = pick("grants");
  merged.license = pick("license");

  const kws = results.flatMap(r => r?.keywords?.split(";").map(k => k.trim()).filter(Boolean) || []);
  merged.keywords = [...new Set(kws)].slice(0, 15).join("; ") || null;

  merged.authors = results.map(r => r?.authors).find(a => a?.length > 0) || null;
  merged.sources = results.filter(Boolean).map(r => r.source).filter(Boolean);

  return merged;
}

function applyMetaToEntry(entry, meta) {
  if (!meta) return entry;
  const f = { ...entry.fields };
  const set = (bibKey, val) => { if (val && !f[bibKey]) f[bibKey] = String(val).trim(); };
  const overwrite = (bibKey, val) => {
    if (val && (!f[bibKey] || f[bibKey].length < String(val).length)) f[bibKey] = String(val).trim();
  };

  overwrite("abstract", meta.abstract);
  set("doi", meta.doi);
  set("url", meta.url);
  set("pmid", meta.pmid);
  set("pmcid", meta.pmcid);
  set("year", meta.year);
  set("journal", meta.journal);
  set("volume", meta.volume);
  set("number", meta.issue);
  set("pages", meta.pages);
  set("publisher", meta.publisher);
  set("issn", meta.issn);
  set("language", meta.language);
  set("keywords", meta.keywords);

  if (!f.author && meta.authors?.length) f.author = meta.authors.join(" and ");

  const notes = [];
  if (meta.citationCount) notes.push(`Cited by: ${meta.citationCount}`);
  if (meta.openAccess === "true") notes.push("Open Access");
  if (meta.tldr) notes.push(`TLDR: ${meta.tldr}`);
  if (meta.grants) notes.push(`Grants: ${meta.grants}`);
  if (notes.length && !f.annote) f.annote = notes.join(". ");

  return { ...entry, fields: f };
}

async function fetchWithTimeout(promise, ms) {
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
    ]);
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

const C = {
  bg: "#08090d",
  surface: "#0e1117",
  border: "#1a1f2e",
  borderHover: "#252d3d",
  text: "#e5e7eb",
  textMuted: "#bfc8d6",
  textDim: "#213e70",
  accent: "#4f9eff",
  accentGlow: "rgba(79,158,255,0.15)",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
  purple: "#a78bfa",
  teal: "#2dd4bf",
};

const SOURCE_COLORS = {
  "CrossRef": "#f59e0b",
  "OpenAlex": "#6366f1",
  "Semantic Scholar": "#10b981",
  "Europe PMC": "#0ea5e9",
  "Unpaywall": "#8b5cf6",
  "DataCite": "#f43f5e",
  "CORE": "#ec4899",
};

const SOURCES = Object.keys(SOURCE_COLORS).map(name => ({ name }));

function SourcePip({ name, state }) {
  const base = SOURCE_COLORS[name] || "#64748b";
  const bg = state === "fetching" ? base :
             state === "hit" ? base :
             state === "partial" ? base :
             state === "miss" ? "#1e293b" :
             state === "skip" ? "#0f1723" : "#1e293b";
  const opacity = state === "miss" || state === "skip" ? 0.35 : 1;
  const pulse = state === "fetching";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }} title={`${name}: ${state || "pending"}`}>
      <div style={{
        width: 7, height: 7, borderRadius: "50%",
        background: bg, opacity,
        boxShadow: pulse ? `0 0 8px ${base}` : state === "hit" ? `0 0 4px ${base}88` : "none",
        animation: pulse ? "pulseGlow 0.8s ease-in-out infinite alternate" : "none",
        transition: "all 0.3s",
        flexShrink: 0,
      }} />
    </div>
  );
}

function StatusChip({ status }) {
  const cfg = {
    pending: { label: "PENDING", color: C.textDim, bg: "transparent", border: C.border },
    processing: { label: "QUERYING", color: C.amber, bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.3)" },
    enriched: { label: "ENRICHED", color: C.green, bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.3)" },
    partial: { label: "PARTIAL", color: C.accent, bg: C.accentGlow, border: "rgba(79,158,255,0.3)" },
    failed: { label: "NO DATA", color: C.red, bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.3)" },
  }[status] || { label: status, color: C.textMuted, bg: "transparent", border: C.border };

  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
      padding: "2px 7px", borderRadius: 3,
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.border}`,
    }}>{cfg.label}</span>
  );
}

function DropZone({ onFile }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.25em", color: C.textMuted, marginBottom: 12 }}>
          BIBLIOGRAPHY ENRICHMENT ENGINE
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, color: C.text, letterSpacing: "-0.02em", lineHeight: 1.1, fontFamily: "'Georgia', serif" }}>
          BibTeX<br /><span style={{ color: C.accent }}>Enricher</span>
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 12, maxWidth: 460, lineHeight: 1.7 }}>
          Upload a <code style={{ color: C.accent, background: C.accentGlow, padding: "1px 6px", borderRadius: 3 }}>.bib</code> file.
          Metadata is fetched in batch from CrossRef, OpenAlex, Semantic Scholar, Europe PMC, Unpaywall, DataCite,
          and CORE (fallback for ResearchGate / Google Scholar indexed papers).
        </div>
      </div>
      <div
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith(".bib")) onFile(f); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onClick={() => ref.current.click()}
        style={{
          width: 380, padding: "48px 32px",
          border: `1.5px dashed ${drag ? C.accent : C.border}`,
          borderRadius: 16,
          textAlign: "center",
          cursor: "pointer",
          background: drag ? C.accentGlow : "transparent",
          transition: "all 0.2s",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 12 }}>⬆</div>
        <div style={{ color: drag ? C.accent : C.textMuted, fontSize: 13 }}>
          Drop <strong>.bib</strong> file here
        </div>
        <div style={{ color: C.textDim, fontSize: 11, marginTop: 6 }}>or click to browse</div>
        <input ref={ref} type="file" accept=".bib" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }} />
      </div>
      <div style={{ marginTop: 32, display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
        {Object.entries(SOURCE_COLORS).map(([name, color]) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: C.textMuted }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

function EntryRow({ entry, enrichedEntry, status, sourceStates }) {
  const [open, setOpen] = useState(false);
  const f = (enrichedEntry || entry).fields;
  const orig = entry.fields;
  const newFields = enrichedEntry ? Object.keys(f).filter(k => f[k] && !orig[k]) : [];
  const improved = enrichedEntry ? Object.keys(f).filter(k => f[k] && orig[k] && f[k].length > orig[k].length) : [];

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "grid",
          gridTemplateColumns: "24px 1fr 56px 90px 168px",
          alignItems: "center",
          gap: 12,
          padding: "9px 16px",
          cursor: "pointer",
          background: open ? "#0b1020" : "transparent",
          transition: "background 0.15s",
        }}
      >
        <div style={{ color: C.textDim, fontSize: 10, transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.title || entry.key}
          </div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>
            <span style={{ color: "#5b6ee1" }}>{entry.type}</span>
            <span style={{ color: C.textDim }}>{"{" + entry.key + "}"}</span>
            {f.year && <span style={{ color: C.textDim }}> · {f.year}</span>}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          {newFields.length > 0 && (
            <span style={{ fontSize: 9, color: C.green, background: "rgba(52,211,153,0.08)",
              border: "1px solid rgba(52,211,153,0.2)", borderRadius: 3, padding: "1px 5px" }}>
              +{newFields.length}
            </span>
          )}
        </div>

        <StatusChip status={status} />

        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
          {SOURCES.map(s => (
            <SourcePip key={s.name} name={s.name} state={sourceStates?.[s.name]} />
          ))}
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px 18px 52px", background: "#070b14", borderTop: `1px solid ${C.border}` }}>
          {(newFields.length > 0 || improved.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {newFields.map(k => (
                <span key={k} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3,
                  background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)",
                  color: C.green }}>✦ {k}</span>
              ))}
              {improved.map(k => (
                <span key={k} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3,
                  background: "rgba(79,158,255,0.08)", border: "1px solid rgba(79,158,255,0.2)",
                  color: C.accent }}>↑ {k}</span>
              ))}
            </div>
          )}

          {f.abstract ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.15em", color: C.accent, marginBottom: 6 }}>ABSTRACT</div>
              <div style={{ fontSize: 12, color: "#8899bb", lineHeight: 1.75, maxWidth: 680 }}>
                {f.abstract}
              </div>
            </div>
          ) : status !== "pending" && (
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>No abstract found across all sources.</div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {[
              ["DOI", f.doi], ["Journal", f.journal], ["Keywords", f.keywords],
              ["PMID", f.pmid], ["PMCID", f.pmcid], ["Language", f.language],
              ["Citations", f.citationcount || f.citationCount], ["Open Access", f.openaccess || f.openAccess],
              ["Publisher", f.publisher], ["ISSN", f.issn],
            ].map(([label, val]) => val ? (
              <div key={label} style={{ fontSize: 10, color: C.textMuted }}>
                <span style={{ color: C.textDim, letterSpacing: "0.08em" }}>{label}: </span>
                <span style={{ color: "#7a8fa8" }}>{String(val).slice(0, 80)}{val.length > 80 ? "…" : ""}</span>
              </div>
            ) : null)}
          </div>

          {f.annote && (
            <div style={{ marginTop: 12, fontSize: 10, color: "#4a5568", fontStyle: "italic", maxWidth: 600, lineHeight: 1.6 }}>
              {f.annote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════
const CONCURRENCY = 8; // max parallel per-entry API calls

export default function BibEnricher() {
  const [entries, setEntries] = useState([]);
  const [fileName, setFileName] = useState("");
  const [statuses, setStatuses] = useState({});
  const [sourceStates, setSourceStates] = useState({});
  const [enrichedMap, setEnrichedMap] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [batchPhase, setBatchPhase] = useState(null);
  const abortRef = useRef(false);

  const loadFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseBib(e.target.result);
      setEntries(parsed);
      setFileName(file.name);
      setStatuses(Object.fromEntries(parsed.map(p => [p.key, "pending"])));
      setSourceStates({});
      setEnrichedMap({});
      setDone(false);
    };
    reader.readAsText(file);
  };

  const run = async () => {
    setRunning(true);
    setDone(false);
    setBatchPhase(null);
    abortRef.current = false;

    // Mark all entries as processing
    setStatuses(Object.fromEntries(entries.map(e => [e.key, "processing"])));
    setSourceStates({});

    // Gather all IDs upfront
    const allEntryIds = entries.map(e => ({
      key: e.key,
      entry: e,
      ids: { ...extractIds(e.fields), title: e.fields.title || null },
    }));

    // ── PHASE 1: Batch fetch SS + OA simultaneously ──────────────
    setBatchPhase(`Batch querying Semantic Scholar + OpenAlex (${allEntryIds.length} entries)…`);
    const [ssBatch, oaBatch] = await Promise.all([
      fetchWithTimeout(fetchSemanticScholarBatch(allEntryIds), 25000),
      fetchWithTimeout(fetchOpenAlexBatch(allEntryIds), 25000),
    ]);
    setBatchPhase(null);

    if (abortRef.current) { setRunning(false); setDone(true); return; }

    // ── PHASE 2: Per-entry parallel enrichment (with concurrency cap) ──
    const processEntry = async ({ key, entry, ids }) => {
      if (abortRef.current) return;

      const updateSrc = (name, state) =>
        setSourceStates(s => ({ ...s, [key]: { ...(s[key] || {}), [name]: state } }));

      const ssFromBatch = ssBatch?.[key] ?? null;
      const oaFromBatch = oaBatch?.[key] ?? null;

      // SS: batch handles ID-based; fall back to title search only if no IDs were submitted
      const hasSSIds = !!(ids.doi || ids.pmid || ids.corpusId || ids.arxivId);
      if (ssFromBatch) {
        updateSrc("Semantic Scholar", ssFromBatch.abstract ? "hit" : "partial");
      } else if (!hasSSIds && ids.title) {
        updateSrc("Semantic Scholar", "fetching");
      } else {
        updateSrc("Semantic Scholar", hasSSIds ? "miss" : "skip");
      }

      // OA: batch handles DOI-based; fall back to title search only for entries without DOI
      if (oaFromBatch) {
        updateSrc("OpenAlex", oaFromBatch.abstract ? "hit" : "partial");
      } else if (!ids.doi && ids.title) {
        updateSrc("OpenAlex", "fetching");
      } else {
        updateSrc("OpenAlex", ids.doi ? "miss" : "skip");
      }

      // Mark per-entry sources
      if (ids.doi) updateSrc("CrossRef", "fetching"); else updateSrc("CrossRef", "skip");
      updateSrc("Europe PMC", "fetching");
      if (ids.doi) updateSrc("Unpaywall", "fetching"); else updateSrc("Unpaywall", "skip");
      if (ids.doi) updateSrc("DataCite", "fetching"); else updateSrc("DataCite", "skip");
      updateSrc("CORE", "skip");

      // Fire all per-entry tasks in parallel
      const [ssRes, oaRes, crRes, epRes, upRes, dcRes] = await Promise.all([
        (!ssFromBatch && !hasSSIds && ids.title)
          ? fetchWithTimeout(fetchSemanticScholarByTitle(ids.title), 8000)
          : Promise.resolve(null),
        (!oaFromBatch && !ids.doi && ids.title)
          ? fetchWithTimeout(fetchOpenAlexByTitle(ids.title), 8000)
          : Promise.resolve(null),
        ids.doi ? fetchWithTimeout(fetchCrossRef(ids.doi), 8000) : Promise.resolve(null),
        fetchWithTimeout(fetchEuropePMC(ids.doi, ids.pmid, ids.title), 8000),
        ids.doi ? fetchWithTimeout(fetchUnpaywall(ids.doi), 8000) : Promise.resolve(null),
        ids.doi ? fetchWithTimeout(fetchDataCite(ids.doi), 8000) : Promise.resolve(null),
      ]);

      // Update source states from individual results
      if (!ssFromBatch && !hasSSIds && ids.title)
        updateSrc("Semantic Scholar", ssRes?.abstract ? "hit" : ssRes ? "partial" : "miss");
      if (!oaFromBatch && !ids.doi && ids.title)
        updateSrc("OpenAlex", oaRes?.abstract ? "hit" : oaRes ? "partial" : "miss");
      if (ids.doi) updateSrc("CrossRef", crRes?.abstract ? "hit" : crRes ? "partial" : "miss");
      updateSrc("Europe PMC", epRes?.abstract ? "hit" : epRes ? "partial" : "miss");
      if (ids.doi) updateSrc("Unpaywall", upRes ? "partial" : "miss");
      if (ids.doi) updateSrc("DataCite", dcRes?.abstract ? "hit" : dcRes ? "partial" : "miss");

      let meta = mergeMeta([ssFromBatch, ssRes, oaFromBatch, oaRes, crRes, epRes, upRes, dcRes]);

      // ── PHASE 3: CORE fallback if still no abstract ──────────────
      if (!meta.abstract && ids.title) {
        updateSrc("CORE", "fetching");
        const coreRes = await fetchWithTimeout(fetchCORE(ids.title), 8000);
        updateSrc("CORE", coreRes?.abstract ? "hit" : "miss");
        if (coreRes) meta = mergeMeta([meta, coreRes]);
      }

      const enriched = applyMetaToEntry(entry, meta);
      setEnrichedMap(prev => ({ ...prev, [key]: enriched }));

      const hasAbstract = !!enriched.fields.abstract;
      const newFieldsCount = Object.keys(enriched.fields).filter(k => enriched.fields[k] && !entry.fields[k]).length;
      setStatuses(s => ({
        ...s,
        [key]: hasAbstract ? "enriched"
          : meta.sources.length > 0 && newFieldsCount > 0 ? "partial"
          : "failed",
      }));
    };

    // Process with concurrency cap
    for (let i = 0; i < allEntryIds.length; i += CONCURRENCY) {
      if (abortRef.current) break;
      await Promise.all(allEntryIds.slice(i, i + CONCURRENCY).map(processEntry));
    }

    setRunning(false);
    setDone(true);
  };

  const download = () => {
    const finalEntries = entries.map(e => enrichedMap[e.key] || e);
    const bib = serializeBib(finalEntries);
    const blob = new Blob([bib], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.bib$/i, "_enriched.bib");
    a.click();
  };

  const total = entries.length;
  const counts = {
    enriched: Object.values(statuses).filter(s => s === "enriched").length,
    partial: Object.values(statuses).filter(s => s === "partial").length,
    failed: Object.values(statuses).filter(s => s === "failed").length,
  };
  const processed = Object.values(statuses).filter(s => !["pending", "processing"].includes(s)).length;
  const pct = total > 0 ? (processed / total) * 100 : 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Mono', 'Fira Code', monospace", color: C.text }}>
      <style>{`
        @keyframes pulseGlow { from { opacity: 0.5; } to { opacity: 1; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      `}</style>

      {/* Buy me a coffee – fixed bottom-right */}
      <div style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 100,
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8,
      }}>
        <div style={{
          fontSize: 11, color: C.textMuted, textAlign: "right", lineHeight: 1.5,
          background: "rgba(8,9,13,0.85)", backdropFilter: "blur(6px)",
          padding: "7px 12px", borderRadius: 8,
          border: `1px solid ${C.border}`,
        }}>
          Did you find this useful?<br />
          <span style={{ color: C.accent }}>It's free — but a coffee keeps it alive.</span>
        </div>
        <a
          href="https://www.buymeacoffee.com/ivancardenas"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "9px 16px",
            background: "#ffdd00",
            borderRadius: 10,
            fontSize: 12, fontWeight: 700,
            color: "#1a1000",
            textDecoration: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.5)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.4)"; }}
        >
          <span style={{ fontSize: 16 }}>☕</span> Buy me a coffee
        </a>
      </div>

      {entries.length === 0 ? (
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 32px" }}>
          <DropZone onFile={loadFile} />
        </div>
      ) : (
        <>
          {/* Top bar */}
          <div style={{
            position: "sticky", top: 0, zIndex: 10,
            background: C.surface, borderBottom: `1px solid ${C.border}`,
            padding: "12px 24px",
            display: "flex", alignItems: "center", gap: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, letterSpacing: "0.05em" }}>
              BIB ENRICHER
            </div>
            <div style={{ fontSize: 11, color: C.textMuted }}>
              {fileName} · {total} entries
            </div>

            {/* Batch phase indicator */}
            {batchPhase && (
              <div style={{ fontSize: 10, color: C.amber, animation: "pulseGlow 0.8s ease-in-out infinite alternate" }}>
                ⚡ {batchPhase}
              </div>
            )}

            {/* Stats */}
            {!batchPhase && (
              <div style={{ display: "flex", gap: 16, marginLeft: 8 }}>
                {[
                  [counts.enriched, C.green, "enriched"],
                  [counts.partial, C.accent, "partial"],
                  [counts.failed, C.red, "failed"],
                ].map(([n, color, label]) => n > 0 && (
                  <div key={label} style={{ fontSize: 11, color }}>
                    {n} <span style={{ color: C.textDim }}>{label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Progress bar */}
            {(running || done) && (
              <div style={{ flex: 1, maxWidth: 200, height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: `linear-gradient(90deg, ${C.accent}, ${C.green})`,
                  transition: "width 0.3s ease", borderRadius: 2,
                }} />
              </div>
            )}

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button onClick={() => { setEntries([]); setFileName(""); }} style={{
                padding: "6px 14px", background: "transparent", border: `1px solid ${C.border}`,
                borderRadius: 6, color: C.textMuted, cursor: "pointer", fontSize: 11, fontFamily: "inherit",
              }}>↩ RESET</button>

              {!running && !done && (
                <button onClick={run} style={{
                  padding: "6px 20px", background: C.accent, border: "none",
                  borderRadius: 6, color: "#fff", cursor: "pointer",
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "inherit",
                }}>▶ ENRICH ALL</button>
              )}
              {running && (
                <button onClick={() => abortRef.current = true} style={{
                  padding: "6px 14px", background: "transparent",
                  border: `1px solid ${C.red}`, borderRadius: 6,
                  color: C.red, cursor: "pointer", fontSize: 11, fontFamily: "inherit",
                }}>■ STOP</button>
              )}
              {done && (
                <button onClick={download} style={{
                  padding: "6px 20px", background: C.green, border: "none",
                  borderRadius: 6, color: "#000", cursor: "pointer",
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "inherit",
                }}>⬇ DOWNLOAD .BIB</button>
              )}
            </div>
          </div>

          {/* Source legend */}
          <div style={{
            padding: "8px 24px", background: C.surface,
            borderBottom: `1px solid ${C.border}`,
            display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.15em" }}>SOURCES</span>
            {Object.entries(SOURCE_COLORS).map(([name, color]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.textMuted }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                {name}{name === "CORE" && <span style={{ color: C.textDim }}> (fallback)</span>}
              </div>
            ))}
          </div>

          {/* Column header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "24px 1fr 56px 90px 168px",
            gap: 12, padding: "6px 16px",
            borderBottom: `1px solid ${C.border}`,
            fontSize: 9, letterSpacing: "0.12em", color: C.textDim,
          }}>
            <div />
            <div>ENTRY</div>
            <div style={{ textAlign: "right" }}>NEW</div>
            <div>STATUS</div>
            <div style={{ textAlign: "right" }}>CR · OA · SS · EP · UP · DC · CO</div>
          </div>

          {/* Entries */}
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            {entries.map(entry => (
              <EntryRow
                key={entry.key}
                entry={entry}
                enrichedEntry={enrichedMap[entry.key]}
                status={statuses[entry.key] || "pending"}
                sourceStates={sourceStates[entry.key]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
