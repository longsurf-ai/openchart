# Trellis

Onboarding workflows, defined as data and run by `OnboardingHost`.

<!-- HUMAN-ANNOTATION:START -->

- Every workflow lives in its own folder under `workflows/`.
- That folder's only entry point is its top-level `workflow.ts`; arrange
  everything else freely.
- Every action and view a workflow uses extends the common base classes.

<!-- HUMAN-ANNOTATION:END -->

- `workflows.ts` owns the step shape and the registry; register each new
  workflow there and save its ID in progress when it should run.
- A step pairs an optional action with a view: `actions.ts` owns
  `OnboardingAction` (`OpenRouteAction`), `views.tsx` owns `OnboardingView`
  (`CardView` corner card, `PageView` full-window page). The host only calls
  their methods. Views load UI lazily: Desktop's content test imports
  `workflow.ts` without it.
- A view shows where its action leads, or, without one, wherever the user is
  once its step is first unseen. `onDone` marks it seen and runs the next
  unseen step's action; leaving the page also marks it seen. Seeing every step
  ends the workflow.
- Product code never imports trellis, and trellis never reaches into
  product markup: it only follows routes. Pages may reuse product components;
  the starter's agent page reuses Settings' native provider setup, and its
  notification page asks AppHost to turn notifications on.
- `local:onboarding` stores device-local progress: the running workflow and its
  seen step indexes. Desktop starts `starter` for new profiles
  through onboarding `view.json`; its IDs are checked against that content.
- Videos are square 720px faststart MP4s without audio, on #111111 or, for
  macOS prompts, a dark wallpaper; mostly website films cut to product
  behavior; these files are the source.
