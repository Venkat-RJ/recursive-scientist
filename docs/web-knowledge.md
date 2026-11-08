# Knowledge from Web

Knowledge from Web is a sibling tab of Papers and Literature. It uses the
native search field, Literature result rows and inline previews, shared
buttons, hover surface, empty artwork, and Trellis docking. Source details and
agent notes appear only when a row is expanded. Long notes use the existing
reading measure, including in maximized panels.

## Shared library

- Search uses the configured agent's built-in web search through the existing
  composer/orchestration bridge. It leaves the selected conversation unchanged.
- Save source and Read in Lattice retrieve page text before saving. A search
  snippet alone is insufficient. Saved content opens in the native Markdown
  reader; revisiting a saved capture requires no new retrieval.
- `list_web_sources`, `read_web_source`, and `save_web_source` expose the same
  library to agents. `set_research_panel` accepts `web-knowledge`.
- Each URL has a stable ID. Immutable, versioned captures live in
  `.research/web/<source-id>/`, with JSON metadata and readable Markdown.
  The JSON retains the source text separately from the agent's summary.
- The library lists the latest capture per URL. Concurrent saves preserve both
  captures. Existing captures are never overwritten by a refresh.
- Project file watching updates the visible library when an agent saves.
  Web captures do not enter `references.bib` or depend on Prior Knowledge.
- Captures identify excerpts versus full text. The application validates the
  record shape and provenance fields; it does not independently certify an
  agent's quotation or scientific interpretation.

## Verification, 8 November 2026

Native Codex workflow exercised in Scheduling Optimization:

1. Search for official OR-Tools scheduling documentation: seven results.
2. Select Scheduling Overview, read it through the agent, save the excerpt and
   separate notes, and open its local Markdown capture.
3. Ask Codex to read the official job-shop guide and save it with scientific
   notes. Verify with list/read tools and show the Web panel. The saved source
   appeared automatically, labeled Added by Agent.
4. Restart the native application and revisit both saved entries.
5. Compare Papers, Literature, and Web typography, row spacing, search controls,
   previews, and floating/maximized panel behavior in light and dark themes.
6. Paste the official CP-SAT guide URL, retrieve and save it, and open the
   capture with its readable filename and original-source link. Revisit the
   three saved sources with Web docked beside Papers and Literature. Existing
   Papers still lists all 22 entries.

Automated coverage includes source capture/read, independent concurrent
versions, URL deduplication, project symlink handling, snippet-only rejection,
source/summary separation, reopening without retrieval, and retry after panel
suspension. The live provider tested was Codex; Claude's shared tool interface
is implemented but has not been separately exercised in this verification.

The Synara integration is maintained in the patches documented in
[synara-runtime.md](synara-runtime.md). Apply them to the pinned runtime and
rebuild it when changing the agent implementation.
