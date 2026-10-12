// Purpose: Share Workspace Tea file discovery across code-selection surfaces.
import { useQueries, useQuery } from "@tanstack/react-query";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  defaultWorkspaceQueryOptions,
  workspacesQueryOptions,
  workspaceTreeQueryOptions,
} from "./workspace";

/**
 * Find user Tea files by path or Workspace root, excluding installed built-ins.
 * The default Workspace query also supplies the home used by catalog previews;
 * registry/tree reads run only while enabled. Query owns cancellation and refresh.
 * Failed or unavailable trees set `failed` while readable files remain available;
 * `unavailable` distinguishes a missing/unavailable root from request failures.
 * `retry` refreshes every discovery read without installing or opening code.
 * @example const scripts = useWorkspaceTeaFiles(transport, { enabled: true, search });
 */
export function useWorkspaceTeaFiles(
  transport: AppTransport,
  { enabled, search }: { enabled: boolean; search: string },
) {
  const home = useQuery(defaultWorkspaceQueryOptions(transport));
  const workspaces = useQuery({
    ...workspacesQueryOptions(transport),
    enabled,
  });
  const trees = useQueries({
    queries: (workspaces.data ?? []).map(({ id }) => ({
      ...workspaceTreeQueryOptions(transport, id),
      enabled,
    })),
  });
  const needle = search.trim().toLocaleLowerCase();
  const unavailable = trees.some(
    (tree) => tree.data && tree.data.status !== "ready",
  );
  const files = (home.data ? (workspaces.data ?? []) : []).flatMap(
    (workspace, index) => {
      const tree = trees[index]?.data;
      return tree?.status === "ready"
        ? tree.entries
            .filter(
              ({ path }) =>
                path.endsWith(".tea") &&
                !(
                  workspace.id === home.data &&
                  path.toLocaleLowerCase().startsWith("indicators/builtin/")
                ) &&
                `${path} ${workspace.root}`
                  .toLocaleLowerCase()
                  .includes(needle),
            )
            .map(({ path }) => ({
              workspaceId: workspace.id,
              path,
              root: workspace.root,
            }))
        : [];
    },
  );
  return {
    home,
    files,
    unavailable,
    pending:
      workspaces.isPending ||
      home.isPending ||
      trees.some((tree) => tree.isPending),
    failed:
      workspaces.isError ||
      home.isError ||
      trees.some((tree) => tree.isError) ||
      unavailable,
    retry: () => {
      void workspaces.refetch();
      void home.refetch();
      trees.forEach((tree) => void tree.refetch());
    },
  };
}
