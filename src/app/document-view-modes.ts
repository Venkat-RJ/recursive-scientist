import type { CanvasMode, DocumentViewMode } from "../app-types";
import { isBibFilePath, isHtmlFilePath, isPreviewableSourceFilePath } from "../app-utils";

/**
 * Markdown and HTML open in Preview until a view is chosen for that file.
 * Bibliographies and LaTeX each remember the view last chosen for their kind.
 */
export type RememberedViewModes = {
  files: ReadonlyMap<string, DocumentViewMode>;
  bib: DocumentViewMode;
  document: DocumentViewMode;
};

export function hasPerFileViewMode(path: string): boolean {
  return /\.md$/i.test(path) || isHtmlFilePath(path);
}

/**
 * The view `path` opens in: what the canvas switches to when it loads, and
 * what a tab on its way to becoming active draws its skeleton as. Null for a
 * document with a single view, which keeps the canvas's.
 */
export function rememberedViewMode(path: string, modes: RememberedViewModes): DocumentViewMode | null {
  if (hasPerFileViewMode(path)) return modes.files.get(path) ?? "pdf";
  if (isBibFilePath(path)) return modes.bib;
  if (isPreviewableSourceFilePath(path)) return modes.document;
  return null;
}

/**
 * The view the file panel draws `path` in: a readable document's remembered
 * one; LaTeX and other source files are only ever their source there (their
 * PDF is a panel of its own).
 */
export function panelViewMode(path: string, modes: RememberedViewModes): DocumentViewMode {
  const readable = hasPerFileViewMode(path) || isBibFilePath(path);
  return (readable && rememberedViewMode(path, modes)) || "source";
}

/**
 * The canvas mode loading `path` switches to from `current`: its remembered
 * view, else the source when the open asks for it, else what LaTeX returns
 * to when leaving a document with views of its own, else
 * the current one (an asset's widened back to Split).
 */
export function modeOnLoad(
  path: string, previousPath: string, current: CanvasMode, revealSource: boolean | undefined, modes: RememberedViewModes,
): CanvasMode {
  const remembered = rememberedViewMode(path, modes);
  if (remembered) return remembered;
  if (revealSource) return "source";
  if (hasPerFileViewMode(previousPath) || isBibFilePath(previousPath)) return modes.document;
  return current === "asset" ? "split" : current;
}

/** Whether `mode`, shown for `path`, is the view LaTeX returns to. */
export function setsDocumentMode(path: string, mode: CanvasMode): mode is DocumentViewMode {
  return isPreviewableSourceFilePath(path) && !hasPerFileViewMode(path) && mode !== "asset";
}

/** A canvas mode that brings an editor on screen, widening a preview-only or asset surface to split. */
export const withEditor = (mode: CanvasMode): CanvasMode => (mode === "pdf" || mode === "asset" ? "split" : mode);
/** The canvas mode a jump into `path` needs: Markdown's Preview is its visual editor, which takes the jump itself. */
export const withEditorFor = (path: string) => (mode: CanvasMode): CanvasMode => (
  mode === "pdf" && /\.md$/i.test(path) ? mode : withEditor(mode)
);
/** A canvas mode that brings the PDF on screen beside an editor-only view. */
export const withPdf = (mode: CanvasMode): CanvasMode => (mode === "source" ? "split" : mode);
