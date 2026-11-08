import { useEffect, useId, useReducer, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRight, Bookmark, BookOpen, Check, ChevronUp, ExternalLink, FileText, GitBranch, Globe, ListFilter, Plus, Search } from "lucide-react";
import type { WebSearchHit as Hit } from "../agent/agent-web-search";
import { toMessage } from "../app-utils";
import { formatCount } from "../i18n";
import { loadLinkPreview } from "../editor/markdown/engine/chrome/link-preview";
import { InfinityLoader } from "../components/ui/activity-icons";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { FluidHoverSurface } from "../components/ui/fluid-hover-surface";
import { IconButton } from "../components/ui/icon-button";
import { InlineMessage } from "../components/ui/inline-message";
import { PanelHeader } from "../components/ui/panel-header";
import { ResizableDrawer } from "../components/ui/resizable-drawer";
import { ResearchArt } from "../components/ui/research-art";
import { READING_FOLIO } from "../components/ui/research-art-reading-folio";
import { SearchField } from "../components/ui/search-field";
import { isKnowledgeUrl, sourceKey } from "./prior-knowledge/knowledge-model";
import { onProjectTreeStale } from "./project-files-changed";

type Source = Hit & { id: string; contentPath: string; savedAt: string; savedBy: string; contentKind: "excerpt" | "full-text" };

function isGitHubSource(url: string) {
  return isKnowledgeUrl(url) && new URL(url).hostname === "github.com";
}

function WebSourceIcon({ origin, saved }: { origin: string; saved: boolean }) {
  const [favicon, setFavicon] = useReducer(
    (_current: string | null, next: string | null) => next,
    null,
  );
  useEffect(() => {
    const request = new AbortController();
    // Share a single preview request per site, without sending page paths.
    void loadLinkPreview(origin, request.signal).then((metadata) => {
      if (request.signal.aborted) return;
      const icon = metadata?.faviconDataUri;
      if (icon?.startsWith("data:image/")) setFavicon(icon);
    });
    return () => request.abort();
  }, [origin]);

  const Glyph = saved ? FileText : Globe;
  return <span className="paper-glyph" aria-hidden="true">
    {favicon
      ? <img className="web-source-favicon" src={favicon} alt="" onError={() => setFavicon(null)} />
      : <Glyph size={14} />}
  </span>;
}
type State = {
  query: string;
  submittedQuery: string;
  results: Hit[] | null;
  selected: string;
  view: "results" | "saved";
  filter: "all" | "saved" | "unsaved";
  sort: "default" | "title" | "source";
  knowledge?: Source[];
  searchError: string;
  knowledgeError: string;
  actionError: string;
  searching: boolean;
  busy: string;

};
const initial: State = {
  query: "", submittedQuery: "", results: null, selected: "", searchError: "", knowledgeError: "", actionError: "",
  searching: false, busy: "", view: "saved", filter: "all", sort: "default",
};

export function WebKnowledgePanel(props: Parameters<typeof WebKnowledge>[0] & { onClose: () => void }) {
  const { t } = useLingui();
  const title = props.github ? t`Knowledge from GitHub` : t`Knowledge from Web`;
  return <ResizableDrawer className={props.github ? "github-knowledge-drawer" : "web-knowledge-drawer"} ariaLabel={title} onClose={props.onClose}>
    <PanelHeader className="drawer-header" title={title} icon={props.github ? <GitBranch size={16} /> : <Globe size={16} />} onClose={props.onClose} />
    <WebKnowledge github={props.github} root={props.root} claimRead={props.claimRead} searchWeb={props.searchWeb} />
  </ResizableDrawer>;
}

export function WebKnowledge({ root, claimRead, searchWeb, github = false }: {
  github?: boolean;
  searchWeb: (query: string, signal: AbortSignal, read?: boolean) => Promise<Hit[]>;
  root: string;
  claimRead?: () => { isCurrent: () => boolean; open: (path: string) => void };
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const [state, update] = useReducer((current: State, patch: Partial<State>) => ({ ...current, ...patch }), initial);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const owner = new AbortController();
    lifetime.current = owner;
    // Trellis can suspend a hidden panel's effects while retaining its state.
    // A cancelled retrieval must not leave that panel permanently busy on return.
    update({ searching: false, busy: "" });
    let generation = 0;
    const refresh = () => {
      const ticket = ++generation;
      void invoke<{ sources: Source[] }>("list_web_sources", { projectRoot: root }).then(({ sources: knowledge }) => {
        if (!owner.signal.aborted && ticket === generation) update({ knowledge, knowledgeError: "" });
      }, (reason: unknown) => {
        if (!owner.signal.aborted && ticket === generation) update({ knowledgeError: toMessage(reason) });
      });
    };
    const unsubscribe = onProjectTreeStale(root, refresh);
    refresh();
    return () => {
      owner.abort();
      unsubscribe();
    };
  }, [root]);

  const currentScope = () => {
    const owner = lifetime.current;
    return () => Boolean(owner && !owner.signal.aborted);
  };
  const sources = new Map((state.knowledge ?? []).map((source) => [sourceKey(source.url), source]));
  const saved: Hit[] = (state.knowledge ?? [])
    .filter((source) => !github || isGitHubSource(source.url))
    .map((source) => ({ ...source, description: source.summary }));
  const showingResults = state.view === "results";
  const domain = (hit: Hit) => new URL(hit.url).hostname;
  const rows = showingResults
    ? (state.results ?? []).filter((hit) => state.filter === "all" ||
      sources.has(sourceKey(hit.url)) === (state.filter === "saved"))
    : [...saved];
  if (state.sort !== "default") {
    rows.sort((a, b) => (state.sort === "source" ? domain(a) : a.title || a.url)
      .localeCompare(state.sort === "source" ? domain(b) : b.title || b.url, i18n.locale));
  }
  const search = async () => {
    const query = state.query.trim();
    const owner = lifetime.current;
    if (!query || state.searching || !owner) return;
    const current = currentScope();
    update({ view: "results", filter: "all", searching: true, submittedQuery: query, results: null, selected: "", searchError: "", actionError: "" });
    try {
      const direct = isKnowledgeUrl(query);
      if (direct && github && !isGitHubSource(query)) throw new Error(t`Enter a github.com URL or search GitHub by keyword.`);
      const hits = direct ? [{ url: query }] : await searchWeb(github ? `site:github.com ${query}` : query, owner.signal);
      if (!current()) return;
      const distinct = new Map<string, Hit>();
      for (const hit of hits) {
        if (isKnowledgeUrl(hit.url) && (!github || isGitHubSource(hit.url)) && !distinct.has(sourceKey(hit.url))) {
          distinct.set(sourceKey(hit.url), hit);
        }
      }
      const results = [...distinct.values()];
      update({ results, selected: results.length === 1 ? sourceKey(results[0].url) : "", searching: false });
    } catch (reason) {
      if (current()) update({ results: [], searching: false, searchError: toMessage(reason) });
    }
  };

  const capture = async (hit: Hit, open: boolean) => {
    const key = sourceKey(hit.url);
    const owner = lifetime.current;
    if (!owner || state.busy) return;
    const opening = open ? claimRead?.() : undefined;
    const existing = sources.get(key);
    if (existing) {
      if (opening?.isCurrent()) opening.open(existing.contentPath);
      return;
    }
    const current = currentScope();
    update({ busy: key, selected: key, actionError: "" });
    try {
      const retrieved = (await searchWeb(hit.url, owner.signal, true))
        .find((result) => sourceKey(result.url) === key && result.content?.trim());
      if (!current()) return;
      if (!retrieved?.content || !retrieved.contentKind) throw new Error(t`This page has no readable capture.`);
      const source = await invoke<Source>("save_web_source", { projectRoot: root, source: {
        url: hit.url, title: retrieved.title || hit.title || hit.url,
        content: retrieved.content, contentKind: retrieved.contentKind, summary: retrieved.summary || "",
      } });
      if (!current()) return;
      const library = await invoke<{ sources: Source[] }>("list_web_sources", { projectRoot: root });
      if (!current()) return;
      update({ knowledge: library.sources, knowledgeError: "" });
      if (opening?.isCurrent()) opening.open(source.contentPath);
    } catch (reason) {
      if (current()) update({ actionError: toMessage(reason) });
    } finally {
      if (current()) update({ busy: "" });
    }
  };
  const read = (hit: Hit) => capture(hit, true);
  const save = (hit: Hit) => capture(hit, false);
  const openPage = (url: string) => {
    void openUrl(url).catch((reason: unknown) => update({ actionError: toMessage(reason) }));
  };

  const count = formatCount(rows.length, i18n.locale);
  const shownQuery = state.submittedQuery;
  const resultSummary = rows.length === 1
    ? t`1 result for “${shownQuery}”`
    : t`${count} results for “${shownQuery}”`;

  return <>
    <form className="literature-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <SearchField controlSize="compact" autoFocus
        aria-label={github ? t`Search GitHub` : t`Search the web`}
        placeholder={github ? t`Search GitHub or enter a GitHub URL` : t`Search the web or enter a URL`} maxLength={1024}
        value={state.query} onChange={(event) => update({ query: event.target.value })}
        onClear={state.searching ? undefined : () => update({ query: "", view: "saved", results: null, selected: "", searchError: "", actionError: "" })}
        trailing={<button type="submit" className="literature-search-submit" title={t`Search`} aria-label={t`Search`}
          disabled={state.searching || !state.query.trim()}>
          {state.searching ? <InfinityLoader size={14} /> : <ArrowRight size={14} />}
        </button>}
      />
    </form>
    {state.searching && <p className="literature-count" role="status">{t`Searching the web…`}</p>}
    <div aria-busy={state.searching || undefined}>
      <div className="web-library-views" role="group" aria-label={github ? t`Knowledge from GitHub` : t`Knowledge from Web`}>
        <Button size="compact" variant="ghost" aria-pressed={showingResults}
          onClick={() => update({ view: "results", selected: "", actionError: "" })}>
          <Search size={13} aria-hidden="true" />{t`Search results`} ({formatCount(state.results?.length ?? 0, i18n.locale)})
        </Button>
        <Button size="compact" variant="ghost" aria-pressed={!showingResults}
          onClick={() => update({ view: "saved", selected: "", actionError: "" })}>
          <Bookmark size={13} aria-hidden="true" />{t`Saved web sources`} ({formatCount(saved.length, i18n.locale)})
        </Button>
      </div>
      <div className="literature-count web-library-toolbar">
        <span className="literature-count-query">
          {showingResults && state.results ? resultSummary : !showingResults ? t`Saved web sources` : ""}
        </span>
        <div className="web-library-controls">
          {showingResults && <label>
            <ListFilter size={13} aria-hidden="true" />
            <select aria-label={t`Filter`} value={state.filter}
              onChange={(event) => update({ filter: event.target.value as State["filter"], selected: "", actionError: "" })}>
              <option value="all">{t`Filter`}</option>
              <option value="saved">{t`Saved`}</option>
              <option value="unsaved">{t`Unsaved`}</option>
            </select>
          </label>}
          <select aria-label={t`Sort`} value={state.sort}
            onChange={(event) => update({ sort: event.target.value as State["sort"] })}>
            <option value="default">{t`Sort`}</option>
            <option value="title">{t`Title`}</option>
            <option value="source">{t`Source`}</option>
          </select>
        </div>
      </div>
      {showingResults && state.searchError && <InlineMessage level="error">{state.searchError}</InlineMessage>}
      {!showingResults && state.knowledgeError && <InlineMessage level="error">{state.knowledgeError}</InlineMessage>}
      {state.actionError && <InlineMessage level="error">{state.actionError}</InlineMessage>}
      {!state.searching && rows.length > 0 && <div className="web-table-head web-row-grid" aria-hidden="true">
        <span className="web-row-title">{t`Title`}</span>
        <span className="web-row-summary">{t`Summary`}</span>
        <span className="web-row-domain">{t`Source`}</span>
        <span className="web-row-type">{t`Type`}</span>
        <span className="web-row-status">{t`Saved`}</span>
      </div>}
      <div role="list" aria-label={showingResults ? t`Web results` : t`Saved web sources`} className="literature-results fluid-hover-surface">
        <FluidHoverSurface selector=".literature-result" follow={null} />
        {!state.searching && rows.map((hit, index) => {
          const key = sourceKey(hit.url);
          const expanded = state.selected === key;
          const source = sources.get(key);
          const title = source?.title || hit.title || hit.url;
          const savedDate = source && new Date(source.savedAt).toLocaleDateString(i18n.locale);
          const origin = new URL(hit.url).origin;
          const preview = id + "-" + index;
          return <div role="listitem" key={key} className="literature-result web-row-grid" data-expanded={expanded || undefined}>
            <button type="button" className="literature-open" aria-label={title} aria-expanded={expanded}
              aria-controls={expanded ? preview : undefined}
              onClick={() => update({ selected: expanded ? "" : key, actionError: "" })} />
            <WebSourceIcon key={origin} origin={origin} saved={Boolean(source)} />
            <strong className="web-row-title">{title}</strong>
            <small className="web-row-domain">{domain(hit)}</small>
            <small className="web-row-type">{source?.contentKind === "full-text" ? t`Full text` : source ? t`Excerpt` : t`Web page`}</small>
            <p className="web-row-summary">{hit.description || source?.summary}</p>
            {source && <span className="web-row-status literature-in" title={savedDate}>
              <Check size={12} aria-hidden="true" />
              <span className="web-row-saved-label">{t`Saved`}</span>
            </span>}
            {expanded ? <ChevronUp size={14} className="web-row-collapse" aria-hidden="true" /> : <div className="web-row-actions">
              <IconButton size="compact" label={t`Open page`} onClick={() => openPage(hit.url)}>
                <ExternalLink size={13} aria-hidden="true" />
              </IconButton>
              {source
                ? <IconButton size="compact" label={t`Read in Lattice`} disabled={Boolean(state.busy)} onClick={() => void read(hit)}>
                    <BookOpen size={14} aria-hidden="true" />
                  </IconButton>
                : <IconButton size="compact" label={t({ message: `Save ${{ title }} to Web` })} tooltip={t`Save source`}
                    disabled={Boolean(state.busy) || !state.knowledge} onClick={() => void save(hit)}>
                    {state.busy === key ? <InfinityLoader size={12} /> : <Bookmark size={14} aria-hidden="true" />}
                  </IconButton>}
            </div>}
            {expanded && <div id={preview} className="literature-preview">
              {source &&
                <dl className="literature-facts">
                  <div><dt>{t`Content`}</dt><dd>{source.contentKind === "full-text" ? t`Full text` : t`Source excerpts`}</dd></div>
                  <div><dt>{t`Saved`}</dt><dd>{savedDate}</dd></div>
                  <div><dt>{t`Added by`}</dt><dd>{source.savedBy === "agent" ? t`Agent` : t`You`}</dd></div>
                </dl>}
              {!source && state.knowledgeError && <InlineMessage level="error">{state.knowledgeError}</InlineMessage>}
              <div className="literature-preview-actions">
                {!source && <Button size="compact" variant="tinted" disabled={Boolean(state.busy) || !state.knowledge}
                  onClick={() => void save(hit)}>
                  {state.busy === key ? <InfinityLoader size={12} /> : <Plus size={13} aria-hidden="true" />}{t`Save source`}
                </Button>}
                <Button size="compact" variant="secondary" onClick={() => openPage(hit.url)}>
                  <ExternalLink size={12} aria-hidden="true" />{t`Open page`}
                </Button>
                <Button size="compact" variant="ghost" disabled={Boolean(state.busy)} onClick={() => void read(hit)}>
                  {state.busy === key ? <InfinityLoader size={12} /> : <BookOpen size={13} aria-hidden="true" />}{t`Read in Lattice`}
                </Button>
              </div>
              {source
                ? source.summary && <><span className="literature-count-sources">{t`Agent notes`}</span><p className="literature-abstract">{source.summary}</p></>
                : hit.description && <p className="literature-abstract">{hit.description}</p>}
            </div>}
          </div>;
        })}
      </div>
      {showingResults && state.results !== null && rows.length === 0 && !state.searchError && <InlineMessage level="info">{t`No web results. Try broader terms or paste a URL.`}</InlineMessage>}
    </div>
    {!state.searching && (showingResults ? state.results === null && !state.searchError : !saved.length && !state.knowledgeError) &&
      <EmptyState className="literature-empty" fill
          icon={<ResearchArt drawing={READING_FOLIO} />}
          title={t`Find and save web sources`} />}
  </>;
}
