import { useEffect, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toMessage } from "../../app-utils";
import { EXPERIMENT_JOURNAL, loadExperiments, subscribeExperiments } from "../experiments/experiment-store";
import { FORMULATION_JOURNAL, loadFormulation, subscribeFormulation } from "../formulation/formulation-store";
import { changesReach, onProjectFilesChanged } from "../project-files-changed";
import { NOTEBOOK_PATH, readNotebook } from "./research-progress-model";

type Sources = {
  experiments: Awaited<ReturnType<typeof loadExperiments>>;
  formulation: Awaited<ReturnType<typeof loadFormulation>>;
  notebook: ReturnType<typeof readNotebook>;
};

type Resource<T> = { value?: T; error?: string };
type State = { [K in keyof Sources]: Resource<Sources[K]> };
type Action = { [K in keyof Sources]: { source: K; result: Resource<Sources[K]> } }[keyof Sources];

const initial: State = { experiments: {}, formulation: {}, notebook: {} };

async function loadNotebook(root: string) {
  let markdown: string;
  try {
    markdown = await invoke<string>("read_project_file", { projectRoot: root, path: NOTEBOOK_PATH });
  } catch (error) {
    const stat = await invoke<{ exists: boolean }>("stat_project_file", { path: NOTEBOOK_PATH });
    if (stat.exists) throw error;
    return {};
  }
  return readNotebook(markdown);
}

export function useResearchProgress(root: string) {
  const [state, dispatch] = useReducer((current: State, action: Action): State => ({
    ...current, [action.source]: { value: current[action.source].value, ...action.result },
  }), initial);

  useEffect(() => {
    let disposed = false;
    let evidence = new Set<string>();
    function reader<T>(load: () => Promise<T>, publish: (result: Resource<T>) => void) {
      let busy = false;
      let pending = false;
      async function refresh() {
        if (disposed) return;
        if (busy) {
          pending = true;
          return;
        }
        busy = true;
        try {
          const value = await load();
          if (!disposed && !pending) publish({ value });
        } catch (error) {
          if (!disposed && !pending) publish({ error: toMessage(error) });
        } finally {
          busy = false;
          if (pending) {
            pending = false;
            void refresh();
          }
        }
      }
      return () => void refresh();
    }
    const experiments = reader(() => loadExperiments(root), (result) => {
      if (result.value) {
        evidence = new Set(result.value.flatMap(({ evidence: links }) =>
          links.filter(({ kind }) => kind === "result").map(({ path }) => path)));
      }
      dispatch({ source: "experiments", result });
    });
    const formulation = reader(() => loadFormulation(root), (result) => dispatch({ source: "formulation", result }));
    const notebook = reader(() => loadNotebook(root), (result) => dispatch({ source: "notebook", result }));
    const stopExperiments = subscribeExperiments(root, experiments);
    const stopFormulation = subscribeFormulation(root, formulation);
    const stopFiles = onProjectFilesChanged(root, (paths) => {
      if (changesReach(paths, EXPERIMENT_JOURNAL) || [...evidence].some((path) => changesReach(paths, path))) experiments();
      if (changesReach(paths, FORMULATION_JOURNAL)) formulation();
      if (changesReach(paths, NOTEBOOK_PATH)) notebook();
    });
    const refresh = () => { experiments(); formulation(); notebook(); };
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
      stopExperiments();
      stopFormulation();
      stopFiles();
    };
  }, [root]);

  return state;
}
