import { useState, useRef, useCallback } from "react";

// ─── BIB PARSER ───────────────────────────────────────────────────────────────
function parseBib(text) {
  const entries = [];
  const entryRegex = /@(\w+)\{([^,]+),([\s\S]*?)\n\}/gm;
  let match;
  while ((match = entryRegex.exec(text)) !== null) {
    const type = match[1];
    const key = match[2].trim();
    const body = match[3];
    const fields = {};
    const fieldRegex = /(\w+)\s*=\s*\{([\s\S]*?)\}(?=\s*,|\s*$)/gm;
    let fm;
    while ((fm = fieldRegex.exec(body)) !== null) {
      fields[fm[1].toLowerCase()] = fm[2].trim();
    }
    entries.push({ type, key, fields, raw: match[0] });
  }
  return entries;
}

function extractIds(fields) {
  const url = fields.url || fields.doi || "";
  const doi = fields.doi ||
    url.match(/https?:\/\/doi\.org\/(.+)/)?.[1] ||
    url.match(/10\.\d{4,}\/\S+/)?.[0] || null;
  const corpusId = url.match(/CorpusId:(\d+)/)?.[1] || null;
  const pmid = url.match(/pubmed\/(\d+)/)?.[1] ||
    url.match(/PMID:(\d+)/)?.[1] || null;
  const semUrl = url.match(/semanticscholar\.org/i) ? url : null;
  return { doi: doi?.trim(), corpusId, pmid, semUrl };
}

// ─── FETCHERS ─────────────────────────────────────────────────────────────────
async function fetchCrossRef(doi) {
  try {
    const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { "User-Agent": "BibEnricher/1.0 (mailto:research@example.com)" }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const w = d.message;
    return {
      abstract: w.abstract?.replace(/<[^>]+>/g, "").trim() || null,
      title: w.title?.[0] || null,
      year: w.published?.["date-parts"]?.[0]?.[0]?.toString() || null,
      journal: w["container-title"]?.[0] || null,
      volume: w.volume || null,
      issue: w.issue || null,
      pages: w.page || null,
      publisher: w.publisher || null,
      issn: w.ISSN?.[0] || null,
      doi: w.DOI || doi,
      url: w.URL || `https://doi.org/${doi}`,
      authors: w.author?.map(a => `${a.given || ""} ${a.family || ""}`.trim()).filter(Boolean) || null,
      type: w.type || null,
      source: "crossref"
    };
  } catch { return null; }
}

async function fetchSemanticScholar(id) {
  const FIELDS = "abstract,title,authors,year,venue,publicationVenue,externalIds,publicationDate,journal,isOpenAccess,openAccessPdf,citationCount,referenceCount,tldr";
  try {
    const r = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${FIELDS}`
    );
    if (!r.ok) return null;
    const w = await r.json();
    return {
      abstract: w.abstract || null,
      title: w.title || null,
      year: w.year?.toString() || null,
      journal: w.journal?.name || w.venue || null,
      volume: w.journal?.volume || null,
      pages: w.journal?.pages || null,
      doi: w.externalIds?.DOI || null,
      pmid: w.externalIds?.PubMed || null,
      authors: w.authors?.map(a => a.name).filter(Boolean) || null,
      citationCount: w.citationCount?.toString() || null,
      openAccessPdf: w.openAccessPdf?.url || null,
      tldr: w.tldr?.text || null,
      source: "semanticscholar"
    };
  } catch { return null; }
}

async function enrichEntry(entry, onStatus) {
  const { doi, corpusId, pmid, semUrl } = extractIds(entry.fields);
  let meta = null;

  // 1. Try CrossRef via DOI
  if (doi) {
    onStatus("CrossRef (DOI)");
    meta = await fetchCrossRef(doi);
  }

  // 2. Try Semantic Scholar
  if (!meta || !meta.abstract) {
    let ssId = null;
    if (corpusId) ssId = `CorpusId:${corpusId}`;
    else if (doi) ssId = doi;
    else if (pmid) ssId = `PMID:${pmid}`;
    if (ssId) {
      onStatus("Semantic Scholar");
      const ssMeta = await fetchSemanticScholar(ssId);
      if (ssMeta) {
        meta = meta ? { ...ssMeta, ...Object.fromEntries(Object.entries(meta).filter(([,v]) => v)) } : ssMeta;
      }
    }
  }

  return meta;
}

// ─── BIB SERIALIZER ───────────────────────────────────────────────────────────
function serializeEntry(entry) {
  const lines = [`@${entry.type}{${entry.key},`];
  const orderedKeys = ["title", "author", "journal", "year", "volume", "issue", "number", "pages",
    "publisher", "doi", "url", "issn", "pmid", "citationcount", "abstract", "note"];
  const allKeys = [...new Set([...orderedKeys, ...Object.keys(entry.fields)])];
  for (const k of allKeys) {
    const v = entry.fields[k];
    if (v && v.trim()) {
      lines.push(`  ${k} = {${v}},`);
    }
  }
  lines.push(`}`);
  return lines.join("\n");
}

function applyMeta(entry, meta) {
  if (!meta) return entry;
  const f = { ...entry.fields };
  const set = (key, val) => { if (val && !f[key]) f[key] = val; };
  if (meta.abstract && (!f.abstract || f.abstract.length < meta.abstract.length))
    f.abstract = meta.abstract;
  set("doi", meta.doi);
  set("year", meta.year);
  set("journal", meta.journal);
  set("volume", meta.volume);
  set("issue", meta.issue);
  set("pages", meta.pages);
  set("publisher", meta.publisher);
  set("issn", meta.issn);
  set("pmid", meta.pmid);
  set("citationcount", meta.citationCount);
  if (meta.doi && !f.doi) f.doi = meta.doi;
  if (!f.author && meta.authors?.length) {
    f.author = meta.authors.join(" and ");
  }
  return { ...entry, fields: f };
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  pending: "#64748b",
  processing: "#f59e0b",
  enriched: "#10b981",
  partial: "#3b82f6",
  failed: "#ef4444",
};

const STATUS_LABELS = {
  pending: "PENDING",
  processing: "FETCHING",
  enriched: "ENRICHED",
  partial: "PARTIAL",
  failed: "NO DATA",
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function BibEnricher() {
  const [entries, setEntries] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [statusMsg, setStatusMsg] = useState({});
  const [enriched, setEnriched] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const abortRef = useRef(false);

  const loadFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    setDone(false);
    setEnriched({});
    setStatuses({});
    setStatusMsg({});
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseBib(e.target.result);
      setEntries(parsed);
      const init = {};
      parsed.forEach(p => { init[p.key] = "pending"; });
      setStatuses(init);
    };
    reader.readAsText(file);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".bib")) loadFile(file);
  }, []);

  const handleFile = (e) => loadFile(e.target.files[0]);

  const runEnrichment = async () => {
    setRunning(true);
    setDone(false);
    abortRef.current = false;
    const results = { ...enriched };
    for (const entry of entries) {
      if (abortRef.current) break;
      setStatuses(s => ({ ...s, [entry.key]: "processing" }));
      setStatusMsg(s => ({ ...s, [entry.key]: "Starting…" }));
      const meta = await enrichEntry(entry, (msg) => {
        setStatusMsg(s => ({ ...s, [entry.key]: msg }));
      });
      const enrichedEntry = applyMeta(entry, meta);
      results[entry.key] = enrichedEntry;
      const hasAbstract = enrichedEntry.fields.abstract;
      const hasAnyMeta = meta !== null;
      setStatuses(s => ({
        ...s,
        [entry.key]: hasAbstract ? "enriched" : hasAnyMeta ? "partial" : "failed"
      }));
      setStatusMsg(s => ({ ...s, [entry.key]: meta?.source || "—" }));
      setEnriched({ ...results });
      await new Promise(r => setTimeout(r, 200));
    }
    setRunning(false);
    setDone(true);
  };

  const download = () => {
    const out = entries.map(e => serializeEntry(enriched[e.key] || e)).join("\n\n");
    const blob = new Blob([out], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(".bib", "_enriched.bib");
    a.click();
  };

  const enrichedCount = Object.values(statuses).filter(s => s === "enriched").length;
  const partialCount = Object.values(statuses).filter(s => s === "partial").length;
  const failedCount = Object.values(statuses).filter(s => s === "failed").length;
  const total = entries.length;
  const processed = Object.values(statuses).filter(s => !["pending", "processing"].includes(s)).length;
  const progress = total > 0 ? (processed / total) * 100 : 0;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      fontFamily: "'DM Mono', 'Fira Mono', 'Courier New', monospace",
      color: "#e2e8f0",
      padding: "0",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e293b",
        padding: "20px 32px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        background: "linear-gradient(90deg, #0f172a 0%, #0a0a0f 100%)",
      }}>
        <div style={{
          width: 36, height: 36,
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18
        }}>⚗️</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.05em", color: "#f1f5f9" }}>
            BIB ENRICHER
          </div>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.12em" }}>
            DOI → CROSSREF · SEMANTIC SCHOLAR · FULL METADATA
          </div>
        </div>
        {total > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 24, fontSize: 12 }}>
            <Stat label="TOTAL" val={total} color="#94a3b8" />
            <Stat label="ENRICHED" val={enrichedCount} color="#10b981" />
            <Stat label="PARTIAL" val={partialCount} color="#3b82f6" />
            <Stat label="FAILED" val={failedCount} color="#ef4444" />
          </div>
        )}
      </div>

      <div style={{ padding: "24px 32px", maxWidth: 1100, margin: "0 auto" }}>
        {/* Upload */}
        {total === 0 && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current.click()}
            style={{
              border: `2px dashed ${dragOver ? "#6366f1" : "#1e293b"}`,
              borderRadius: 16,
              padding: "72px 32px",
              textAlign: "center",
              cursor: "pointer",
              transition: "all 0.2s",
              background: dragOver ? "rgba(99,102,241,0.05)" : "transparent",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
            <div style={{ fontSize: 16, color: "#94a3b8", marginBottom: 8 }}>
              Drop your <span style={{ color: "#6366f1" }}>.bib file</span> here
            </div>
            <div style={{ fontSize: 12, color: "#475569" }}>or click to browse</div>
            <input ref={fileRef} type="file" accept=".bib" style={{ display: "none" }} onChange={handleFile} />
          </div>
        )}

        {/* Loaded state */}
        {total > 0 && (
          <>
            {/* Controls */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
              <div style={{
                flex: 1,
                padding: "8px 16px",
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: 8,
                fontSize: 12,
                color: "#64748b"
              }}>
                📂 {fileName} — {total} entries
              </div>
              <button
                onClick={() => { setEntries([]); setFileName(""); setDone(false); }}
                style={{
                  padding: "8px 16px", background: "transparent",
                  border: "1px solid #1e293b", borderRadius: 8,
                  color: "#64748b", cursor: "pointer", fontSize: 12
                }}
              >CLEAR</button>
              {!running && !done && (
                <button onClick={runEnrichment} style={{
                  padding: "8px 24px",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  border: "none", borderRadius: 8, color: "#fff",
                  cursor: "pointer", fontSize: 13, fontWeight: 700,
                  letterSpacing: "0.05em", fontFamily: "inherit"
                }}>▶ ENRICH ALL</button>
              )}
              {running && (
                <button onClick={() => { abortRef.current = true; }} style={{
                  padding: "8px 24px", background: "#1e293b",
                  border: "1px solid #ef4444", borderRadius: 8,
                  color: "#ef4444", cursor: "pointer", fontSize: 13, fontFamily: "inherit"
                }}>■ STOP</button>
              )}
              {done && (
                <button onClick={download} style={{
                  padding: "8px 24px",
                  background: "linear-gradient(135deg, #059669, #10b981)",
                  border: "none", borderRadius: 8, color: "#fff",
                  cursor: "pointer", fontSize: 13, fontWeight: 700,
                  letterSpacing: "0.05em", fontFamily: "inherit"
                }}>⬇ DOWNLOAD .BIB</button>
              )}
            </div>

            {/* Progress bar */}
            {(running || done) && (
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden"
                }}>
                  <div style={{
                    height: "100%", width: `${progress}%`,
                    background: "linear-gradient(90deg, #6366f1, #10b981)",
                    transition: "width 0.4s ease",
                    borderRadius: 2
                  }} />
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginTop: 6, textAlign: "right" }}>
                  {processed}/{total} processed
                </div>
              </div>
            )}

            {/* Entries table */}
            <div style={{
              border: "1px solid #1e293b",
              borderRadius: 12,
              overflow: "hidden",
            }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px 100px 110px",
                padding: "8px 16px",
                background: "#0f172a",
                fontSize: 10,
                color: "#475569",
                letterSpacing: "0.1em",
                borderBottom: "1px solid #1e293b"
              }}>
                <span>ENTRY</span>
                <span>YEAR</span>
                <span>STATUS</span>
                <span>SOURCE</span>
              </div>
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                {entries.map((entry) => {
                  const status = statuses[entry.key] || "pending";
                  const enrichedEntry = enriched[entry.key] || entry;
                  const hasAbstract = enrichedEntry.fields.abstract;
                  return (
                    <EntryRow
                      key={entry.key}
                      entry={enrichedEntry}
                      originalEntry={entry}
                      status={status}
                      sourceMsg={statusMsg[entry.key]}
                      hasAbstract={!!hasAbstract}
                    />
                  );
                })}
              </div>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", gap: 20, marginTop: 16, fontSize: 11, color: "#475569" }}>
              {Object.entries(STATUS_COLORS).map(([k, c]) => (
                <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />
                  {STATUS_LABELS[k]}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, val, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
      <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.1em" }}>{label}</div>
    </div>
  );
}

function EntryRow({ entry, originalEntry, status, sourceMsg, hasAbstract }) {
  const [expanded, setExpanded] = useState(false);
  const f = entry.fields;
  const of_ = originalEntry.fields;
  const addedFields = Object.keys(f).filter(k => f[k] && !of_[k]);
  const statusColor = STATUS_COLORS[status];

  return (
    <div style={{ borderBottom: "1px solid #0f172a" }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 90px 100px 110px",
          padding: "10px 16px",
          alignItems: "center",
          cursor: "pointer",
          background: expanded ? "#0f172a" : "transparent",
          transition: "background 0.15s",
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 2 }}>
            <span style={{ color: "#6366f1" }}>{entry.type}</span>
            {"{"}
            <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{entry.key}</span>
            {"}"}
          </div>
          <div style={{
            fontSize: 11, color: "#64748b",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 480
          }}>
            {f.title || "—"}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{f.year || "—"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: statusColor, flexShrink: 0,
            boxShadow: status === "processing" ? `0 0 6px ${statusColor}` : "none"
          }} />
          <span style={{ fontSize: 11, color: statusColor }}>
            {STATUS_LABELS[status]}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#475569" }}>
          {sourceMsg || "—"}
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: "12px 16px 16px",
          background: "#070b14",
          borderTop: "1px solid #1e293b",
          fontSize: 11,
        }}>
          {/* Added fields */}
          {addedFields.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#10b981", marginBottom: 6, letterSpacing: "0.08em" }}>
                ✦ {addedFields.length} FIELD{addedFields.length > 1 ? "S" : ""} ADDED
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {addedFields.map(k => (
                  <span key={k} style={{
                    padding: "2px 8px", background: "rgba(16,185,129,0.1)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    borderRadius: 4, color: "#10b981", fontSize: 10
                  }}>{k}</span>
                ))}
              </div>
            </div>
          )}
          {/* Abstract */}
          {f.abstract ? (
            <div>
              <div style={{ color: "#6366f1", marginBottom: 6, letterSpacing: "0.08em" }}>ABSTRACT</div>
              <div style={{ color: "#94a3b8", lineHeight: 1.7, maxWidth: 700 }}>
                {f.abstract}
              </div>
            </div>
          ) : (
            <div style={{ color: "#374151" }}>No abstract retrieved.</div>
          )}
          {/* Citation count */}
          {f.citationcount && (
            <div style={{ marginTop: 10, color: "#475569" }}>
              📚 <span style={{ color: "#94a3b8" }}>{f.citationcount}</span> citations
            </div>
          )}
          {/* DOI */}
          {f.doi && (
            <div style={{ marginTop: 6, color: "#475569" }}>
              DOI: <span style={{ color: "#6366f1" }}>{f.doi}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}