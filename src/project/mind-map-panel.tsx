import { useCallback, useReducer, useSyncExternalStore } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowUpRight, Network, Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PanelHeader } from "../components/ui/panel-header";
import { ScrollArea } from "../components/ui/scroll-area";
import { ResizableDrawer } from "../components/ui/resizable-drawer";
import { decodeMindMap, editMindMap, MIND_MAP_LABEL_LIMIT, mindMapSnapshot, subscribeMindMap, type MindMapEdit, type MindMapTopic } from "./mind-map-store";
import { MIND_MAP_STARTER_LABELS } from "../agent/agent-mind-map-tools";
import { parseKnowledgeReference, type KnowledgeReference } from "./prior-knowledge/knowledge-reference";
import "./research-panel.css";
import "./mind-map-panel.css";

type Branch = { index: number; children: Branch[] };
type MapState = { selected: string | null; draft: string | null; saveFailed: boolean };

function mapBranches(topics: MindMapTopic[]): Branch {
  const root: Branch = { index: 0, children: [] };
  const parents = [root];
  for (let index = 1; index < topics.length; index++) {
    const { depth } = topics[index];
    const branch = { index, children: [] };
    parents[depth - 1].children.push(branch);
    parents[depth] = branch;
  }
  return root;
}

export function MindMapPanel({ projectRoot, onClose, openPriorKnowledge }: {
  projectRoot: string; onClose: () => void;
  openPriorKnowledge?: (reference?: KnowledgeReference) => void;
}) {
  const { t, i18n } = useLingui();
  const labels = MIND_MAP_STARTER_LABELS.map((label) => i18n._(label));
  const subscribe = useCallback((listener: () => void) => subscribeMindMap(projectRoot, listener), [projectRoot]);
  const stored = useSyncExternalStore(subscribe, () => mindMapSnapshot(projectRoot));
  let topics: MindMapTopic[];
  try { topics = decodeMindMap(stored, labels); }
  catch { topics = decodeMindMap(null, labels); }
  const [{ selected, draft, saveFailed }, update] = useReducer(
    (previous: MapState, next: Partial<MapState>) => ({ ...previous, ...next }),
    { selected: null, draft: null, saveFailed: false },
  );
  const selectedTopic = topics.find(({ id }) => id === selected);
  const parent = selectedTopic ?? topics[0];
  const selectedLabel = selectedTopic?.label ?? "";
  const target = selectedLabel.match(/^\[[^\]]+\]\(([^)]+)\)$/)?.[1] ?? selectedLabel;
  const knowledgeReference = parseKnowledgeReference(target) ?? undefined;
  const save = (edit: MindMapEdit) => {
    try {
      const result = editMindMap(projectRoot, labels, edit);
      update({ saveFailed: false });
      return result.node;
    } catch {
      update({ saveFailed: true });
      return null;
    }
  };

  const renderBranch = ({ index, children }: Branch) => (
    <li key={topics[index].id} className="mind-map-branch" data-deep={topics[index].depth >= 5 || undefined}>
      {topics[index].id === selected && draft !== null ? (
        <Input
          className="mind-map-node"
          aria-label={t`Topic name`}
          autoFocus
          maxLength={MIND_MAP_LABEL_LIMIT}
          value={draft}
          onFocus={(event) => event.target.select()}
          onBlur={() => {
            if (draft.trim() && draft.trim() !== topics[index].label) {
              save({ operation: "rename", nodeId: topics[index].id, label: draft });
            }
            update({ draft: null });
          }}
          onChange={(event) => update({ draft: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      ) : (
        <button type="button" className="mind-map-node" aria-pressed={topics[index].id === selected} onClick={() => update({ selected: topics[index].id, draft: topics[index].label })}>
          {topics[index].label.match(/^\[([^\]]+)\]\(([^)]+)\)$/)?.[1] ?? topics[index].label}
        </button>
      )}
      {children.length > 0 && <ul>{children.map(renderBranch)}</ul>}
    </li>
  );

  return (
    <ResizableDrawer className="mind-map-drawer research-panel" onClose={onClose}>
      <PanelHeader className="drawer-header" icon={<Network size={16} />} title={t`Mind Map`} onClose={onClose} />
      <div className="research-actions mind-map-actions">
        <Button size="compact" variant="tinted" onClick={() => {
          const node = save({ operation: "add", nodeId: parent.id, label: t`New topic` });
          if (node) update({ selected: node.id, draft: node.label });
        }}>
          <Plus size={14} /> {t`Add branch`}
        </Button>
        {selectedTopic && selectedTopic.depth > 0 && <Button size="compact" variant="secondary" onClick={() => {
          if (save({ operation: "delete", nodeId: selectedTopic.id })) update({ selected: null, draft: null });
        }}>
          <Trash2 size={14} /> {t`Remove branch`}
        </Button>}
        {openPriorKnowledge && <Button size="compact" variant="ghost" onClick={() => openPriorKnowledge(knowledgeReference)}>
          {knowledgeReference ? t`Open linked finding` : t`Prior Knowledge`}
          <ArrowUpRight size={12} />
        </Button>}
        {saveFailed && <span role="status">{t`This mind map could not be saved on this device.`}</span>}
      </div>
      <ScrollArea className="research-panel-scroll" contentClassName="mind-map-canvas" orientation="both" fadeEdges={false}>
        <ul aria-label={t`Mind Map`}>{renderBranch(mapBranches(topics))}</ul>
      </ScrollArea>
    </ResizableDrawer>
  );
}
