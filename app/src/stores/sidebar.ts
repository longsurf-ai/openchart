// Purpose: Remember each sidebar directory's display order locally, outside Resource data.
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SidebarSort = z.enum(["updatedAt", "createdAt"]);
const preferences = z.object({
  dashboards: SidebarSort.default("updatedAt"),
  alerts: SidebarSort.default("updatedAt"),
  chats: SidebarSort.default("updatedAt"),
});
type Preferences = z.infer<typeof preferences>;
export type SidebarSection = keyof Preferences;

/** Persist only per-directory display choices; Query owns the ordered rows. @example useSidebarSort(s => s.alerts); */
export const useSidebarSort = create<
  Preferences & {
    setSort: (
      section: SidebarSection,
      order: z.infer<typeof SidebarSort>,
    ) => void;
  }
>()(
  persist(
    (set) => ({
      ...preferences.parse({}),
      setSort: (section, order) => set({ [section]: order }),
    }),
    {
      name: "sidebar-sort",
      version: 1,
      partialize: ({ dashboards, alerts, chats }) => ({
        dashboards,
        alerts,
        chats,
      }),
      merge: (saved, current) => {
        const parsed = preferences.safeParse(saved);
        return parsed.success ? { ...current, ...parsed.data } : current;
      },
    },
  ),
);
