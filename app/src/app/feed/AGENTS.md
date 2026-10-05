# Feed composition

- `/app/feed` reads all published Posts through `post.feed`, without requiring
  Alert provenance. Posts/model/publishing remain with their existing owners.
- Use SectionPage without section navigation; retain the centered stream,
  fixed header, responsive gutters and Copilot. Header icons reuse NewAlertMenu
  and NewScheduleMenu. Manual Schedule creation reuses its form; Agent creation
  prefills the current Copilot without navigating or sending. Opening Feed never
  creates Sessions, Runs or Posts.
- Post read marks are device-local. Search/unread filters run before pagination,
  which loads near the stream's end. Rule counts remain specific to their Rules
  in the main sidebar.
- `feed-page.tsx` composes source-aware Post links: Agent Posts open their actual
  Session; only Alert provenance queries Alert execution/prompt status. Missing
  source Rules retain historical titles. Text references use agent chips. Chart
  Resources alone attach, as read-only cells opened at the alert (or publication)
  time in an unsaved viewport.
- Icon-only Post actions have tooltips; no status text. New instruction
  opens the prompt editor inline with the Session's last model/workspace, sends
  there (Rule Posts start one) and opens it in Copilot. Rule Posts show
  the Spinner in its place while their Agent runs.
- Quotes resolve current Posts once; missing targets show the shared placeholder.
