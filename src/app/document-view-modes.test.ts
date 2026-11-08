import { describe, expect, it } from "vitest";
import { modeOnLoad, panelViewMode, rememberedViewMode, setsDocumentMode, type RememberedViewModes } from "./document-view-modes";

const modes = (overrides: Partial<RememberedViewModes> = {}): RememberedViewModes => ({
  files: new Map([["site/chosen.html", "split"]]), bib: "source", document: "pdf", ...overrides,
});

describe("document view modes", () => {
  it("opens each readable kind in the view last chosen for it", () => {
    expect(rememberedViewMode("notes.md", modes())).toBe("pdf");
    expect(rememberedViewMode("main.tex", modes({ document: "split" }))).toBe("split");
    expect(rememberedViewMode("references.bib", modes({ bib: "pdf" }))).toBe("pdf");
    expect(rememberedViewMode("site/chosen.html", modes())).toBe("split");
    expect(rememberedViewMode("site/page.html", modes())).toBe("pdf");
    expect(rememberedViewMode("data.csv", modes())).toBeNull();
  });

  it("draws LaTeX and other sources in the file panel as their source only", () => {
    expect(panelViewMode("main.tex", modes({ document: "split" }))).toBe("source");
    expect(panelViewMode("notes.txt", modes())).toBe("source");
    expect(panelViewMode("notes.md", modes({ document: "split" }))).toBe("pdf");
    expect(panelViewMode("site/page.html", modes())).toBe("pdf");
    expect(panelViewMode("references.bib", modes({ bib: "pdf" }))).toBe("pdf");
  });

  it("keeps or widens the canvas for a document with one view", () => {
    expect(modeOnLoad("notes.txt", "main.tex", "split", true, modes())).toBe("source");
    expect(modeOnLoad("notes.txt", "main.tex", "split", false, modes())).toBe("split");
    expect(modeOnLoad("notes.txt", "figure.png", "asset", false, modes())).toBe("split");
    expect(modeOnLoad("notes.txt", "page.html", "pdf", false, modes({ document: "source" }))).toBe("source");
    expect(modeOnLoad("notes.md", "page.html", "split", true, modes())).toBe("pdf");
  });

  it("remembers Markdown choices per file without changing the shared LaTeX view", () => {
    const chosen = modes({ files: new Map([["notes.md", "source"]]), document: "split" });
    expect(rememberedViewMode("notes.md", chosen)).toBe("source");
    expect(rememberedViewMode("other.MD", chosen)).toBe("pdf");
    expect(rememberedViewMode("main.tex", chosen)).toBe("split");
    expect(setsDocumentMode("notes.md", "pdf")).toBe(false);
    expect(setsDocumentMode("main.tex", "split")).toBe(true);
    expect(setsDocumentMode("page.html", "pdf")).toBe(false);
    expect(setsDocumentMode("notes.md", "asset")).toBe(false);
    expect(setsDocumentMode("references.bib", "pdf")).toBe(false);
  });
});
