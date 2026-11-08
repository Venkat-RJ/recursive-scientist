import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { ScrollArea } from "../components/ui/scroll-area";
import "./research-panel.css";

export function ResearchPanelBody({ children, className }: { children: ReactNode; className: string }) {
  return <ScrollArea className="research-panel-scroll" contentClassName={`research-panel-body ${className}`}>
    {children}
  </ScrollArea>;
}

/** Keep drafts mounted when folded, and expose a field before native validation focuses it. */
export function ResearchDisclosure({ title, children, open, className = "" }: {
  title: ReactNode; children: ReactNode; open?: boolean; className?: string;
}) {
  return <details className={`research-disclosure ${className}`} open={open}
    onInvalidCapture={(event) => { event.currentTarget.open = true; }}>
    <summary><ChevronRight size={12} aria-hidden="true" /><span>{title}</span></summary>
    <div className="research-disclosure-body">{children}</div>
  </details>;
}
