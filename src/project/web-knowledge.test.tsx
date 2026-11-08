import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { WebKnowledge } from "./web-knowledge";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("retrieves actual text before saving, reopens it, and discovers agent additions", async () => {
  const url = "https://example.org/method";
  const hit = { url, title: "Scheduling method", description: "Discovery snippet" };
  const content = "Source passage actually retrieved from the page.";
  let sources: object[] = [];
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === "list_web_sources") return { sources };
    if (name === "save_web_source") {
      expect(args).toMatchObject({ projectRoot: "/research", source: { url, content, contentKind: "excerpt" } });
      const source = { ...(args as { source: object }).source, id: "source", contentPath: ".research/web/source/1.md", savedAt: new Date().toISOString(), savedBy: "human" };
      sources = [source];
      return source;
    }
    throw new Error("Unexpected command " + name);
  });
  const searchWeb = vi.fn(async (_query: string, _signal: AbortSignal, read?: boolean) => read
    ? [{ ...hit, content, contentKind: "excerpt" as const, summary: "An agent interpretation." }]
    : [hit]);
  const open = vi.fn();
  const props = { root: "/research", searchWeb, claimRead: () => ({ isCurrent: () => true, open }) };
  const panel = render(<WebKnowledge {...props} />);
  const box = screen.getByRole("searchbox");
  fireEvent.change(box, { target: { value: "scheduling" } });
  fireEvent.submit(box.closest("form")!);
  await screen.findByText("1 result for “scheduling”");
  fireEvent.click(screen.getByRole("button", { name: "Save source" }));
  await screen.findByText("Source excerpts");
  expect(searchWeb).toHaveBeenCalledWith(url, expect.any(AbortSignal), true);
  expect(screen.getByText("Agent notes")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: hit.title }));
  fireEvent.click(screen.getByRole("button", { name: "Read in Lattice" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(".research/web/source/1.md"));
  expect(searchWeb).toHaveBeenCalledTimes(2);
  panel.unmount();
  sources.push({ url: "https://example.org/agent", title: "Added by the agent", id: "agent", contentPath: ".research/web/agent/1.md", savedAt: new Date().toISOString(), savedBy: "agent", contentKind: "excerpt" });
  render(<WebKnowledge {...props} />);
  const agentEntry = await screen.findByRole("button", { name: "Added by the agent" });
  fireEvent.click(agentEntry);
  expect(screen.getByText("Agent")).toBeVisible();
  fireEvent.click(within(agentEntry.closest<HTMLElement>('[role="listitem"]')!).getByRole("button", { name: "Read in Lattice" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(".research/web/agent/1.md"));
  expect(searchWeb).toHaveBeenCalledTimes(2);
});

it("does not save a search snippet when the page could not be read", async () => {
  vi.mocked(invoke).mockResolvedValue({ sources: [] });
  const searchWeb = vi.fn(async () => [{ url: "https://example.org", title: "Source", description: "Only a snippet" }]);
  render(<WebKnowledge root="/research" searchWeb={searchWeb} />);
  const box = screen.getByRole("searchbox");
  fireEvent.change(box, { target: { value: "source" } });
  fireEvent.submit(box.closest("form")!);
  fireEvent.click(await screen.findByRole("button", { name: "Save source" }));
  await screen.findByText("This page has no readable capture.");
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === "save_web_source")).toBe(false);
});

it("allows retry after a suspended panel cancels an in-flight capture", async () => {
  const { Activity } = await import("react");
  vi.mocked(invoke).mockResolvedValue({ sources: [] });
  const searchWeb = vi.fn((_query: string, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const view = (mode: "visible" | "hidden") => <Activity mode={mode}><WebKnowledge root="/research" searchWeb={searchWeb} /></Activity>;
  const panel = render(view("visible"));
  const box = screen.getByRole("searchbox");
  fireEvent.change(box, { target: { value: "https://example.org/method" } });
  fireEvent.submit(box.closest("form")!);
  fireEvent.click(await screen.findByRole("button", { name: "Save source" }));
  await waitFor(() => expect(searchWeb).toHaveBeenCalledTimes(1));
  panel.rerender(view("hidden"));
  panel.rerender(view("visible"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save source" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Save source" }));
  await waitFor(() => expect(searchWeb).toHaveBeenCalledTimes(2));
});

it("keeps results across view changes and applies saved status and title ordering", async () => {
  const saved = {
    url: "https://example.org/saved", title: "Zebra", id: "saved",
    contentPath: ".research/web/saved.md", savedAt: new Date().toISOString(),
    savedBy: "agent", contentKind: "excerpt" as const,
  };
  vi.mocked(invoke).mockResolvedValue({ sources: [saved] });
  const searchWeb = vi.fn(async () => [saved, { url: "https://example.org/new", title: "Alpha" }]);
  render(<WebKnowledge root="/research" searchWeb={searchWeb} />);
  const box = screen.getByRole("searchbox");
  fireEvent.change(box, { target: { value: "scheduling" } });
  fireEvent.submit(box.closest("form")!);
  const results = await screen.findByRole("button", { name: "Search results (2)" });
  fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "title" } });
  expect(within(screen.getAllByRole("listitem")[0]).getByRole("button", { name: "Alpha" })).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Filter" }), { target: { value: "unsaved" } });
  expect(screen.queryByRole("button", { name: "Zebra" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Saved web sources (1)" }));
  expect(screen.getByRole("button", { name: "Zebra" })).toBeVisible();
  fireEvent.click(results);
  expect(screen.getByRole("button", { name: "Alpha" })).toBeVisible();
  expect(searchWeb).toHaveBeenCalledTimes(1);
});

it("scopes GitHub discovery and saved sources to github.com", async () => {
  const repo = { url: "https://github.com/example/solver", title: "GitHub solver" };
  const other = { url: "https://github.com.example.org/solver", title: "Other solver" };
  vi.mocked(invoke).mockResolvedValue({ sources: [repo, other] });
  const searchWeb = vi.fn(async () => [repo, other]);
  render(<WebKnowledge root="/research" github searchWeb={searchWeb} />);
  await screen.findByRole("button", { name: repo.title });
  expect(screen.queryByRole("button", { name: other.title })).not.toBeInTheDocument();
  const box = screen.getByRole("searchbox", { name: "Search GitHub" });
  fireEvent.change(box, { target: { value: "constraint solver" } });
  fireEvent.submit(box.closest("form")!);
  await screen.findByRole("button", { name: "Search results (1)" });
  expect(searchWeb).toHaveBeenCalledWith("site:github.com constraint solver", expect.any(AbortSignal));
  expect(screen.queryByRole("button", { name: other.title })).not.toBeInTheDocument();
});
