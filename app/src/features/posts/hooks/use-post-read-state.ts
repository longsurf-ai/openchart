// Purpose: Keep published-Post read marks device-local and separate from legacy Alert events.
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const PostReadState = z.object({
  lastReadAt: z.number().nonnegative().default(0),
  readIds: z.array(z.string()).default([]),
});
/** Device-local Post marks used only as transient read filters. */
export type PostReadState = z.infer<typeof PostReadState>;

/** Read state follows Post publication time, independent of source-event time. @example isPostUnread(state, post); */
export function isPostUnread(
  state: PostReadState,
  post: { id: string; createdAt: number },
) {
  // ponytail: individual marks grow until Mark all read; use a Set if this becomes a measured bottleneck.
  return post.createdAt > state.lastReadAt && !state.readIds.includes(post.id);
}

/** Persist only local Post IDs and a read watermark; invalid storage starts unread. No backend writes. @example const read = usePostReadState(); */
export const usePostReadState = create<
  PostReadState & {
    markRead: (id: string) => void;
    markAllRead: (now: number) => void;
  }
>()(
  persist(
    (set) => ({
      ...PostReadState.parse({}),
      markRead: (id) =>
        set((state) =>
          state.readIds.includes(id)
            ? state
            : { readIds: [...state.readIds, id] },
        ),
      markAllRead: (now) => set({ lastReadAt: now, readIds: [] }),
    }),
    {
      name: "local:posts:read",
      version: 1,
      partialize: ({ lastReadAt, readIds }) => ({ lastReadAt, readIds }),
      merge: (saved, current) => {
        const parsed = PostReadState.safeParse(saved);
        return parsed.success ? { ...current, ...parsed.data } : current;
      },
    },
  ),
);
