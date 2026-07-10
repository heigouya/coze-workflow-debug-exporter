# Changelog

## v0.2.7

- Fixes Mac/Windows report differences caused by browser-dependent capture order.
- Uses Trace node order as the final report order, so node cards and copied prompts stay aligned with the workflow.
- Treats `试运行中...` canvas text as temporary status text instead of a real node name.
- Adds regression tests for trial-running labels and node-history-before-trace ordering.

## v0.2.6

- Preserves every repeated Trace span for loop-body and batch nodes, even when Coze omits `batch_index` and `sub_execute_id`.
- Keeps repeated executions under one node card and reuses the existing iteration selector to inspect each input, output, and error.
- Avoids creating false iterations for ordinary single-run nodes or duplicate captures of the same span.
- Adds a six-execution regression test matching the reported `image2image` loop behavior.

## v0.2.5

- Serializes capture writes so simultaneous Trace/history responses cannot overwrite each other in local storage.
- Preserves loop and batch executions under one node and adds a batch selector to the detail modal.
- Expands copy-time redaction for cookies, generic tokens, refresh tokens, API keys, and sessions.
- Caps local capture storage at 500 records and approximately 40 million characters, with cache-size indicators in popup and report views.
- Parses each captured request/response body once and removes quadratic queue traversal from deep-field lookup.
- Gives success, running, unknown, and failure distinct badge states and restores report selection fallback after refresh.
- Restores the Node test suite with 30 regression tests.

## v0.2.4

- Reverts the v0.2.3 "only show runs since last clear" filter: it wrongly hid the current run whenever that run started before the last cache clear, leaving the report page empty. The report page shows all captured runs again (same as v0.2.2).
- Keeps the v0.2.3 badge (node count) and URL-underline fixes.

## v0.2.3

- Toolbar badge now shows the current run's node count (matching the popup) instead of the raw captured-record count, so the numbers are consistent.
- The report page only shows runs started after the last local-cache clear, filtering out old runs that Coze's history/trace list endpoint returns; the summary now reads "本会话 N 次日志". Note: after clearing you won't see pre-clear history runs in the extension.
- Fixes URL links in the modal not being underlined (a CSS specificity issue where `pre.json a` overrode the underline); links now have a solid underline and brighten on hover.

## v0.2.2

- Detail modal now keeps a fixed height when switching All / Input / Output / Error tabs, so the panel no longer resizes (no layout shift); content is top-aligned and the body scrolls.
- Cards have a clear hover state (accent border, ring, and lift); fixed the entrance animation locking the transform and swallowing the hover effect.
- URLs inside JSON string values are linkified: clickable and opened in a new tab inside the modal, non-interactive in card previews so the whole card stays one click target.
- Redesigns the extension popup to match the report page (logo, connected-workflow chip with click-to-copy id, refined stat tiles, fixed 340px width).
- Replaces the placeholder icon with a custom orange (#E94618) icon at 16/32/48/128; adds `icons` and `action.default_icon`.
- Renames the extension to "Coze 调试" and updates the description to Chinese.

## v0.2.1

- Switches the gallery from CSS multi-column to a JS masonry that fills columns in node order, so cards read left-to-right (1, 2, 3 …) instead of top-to-bottom.
- Moves the per-card copy icon right next to the node name; pushes the status badge to the far right.
- Aligns the modal section copy icon next to its section title (input / output / error) instead of the far right.
- Fixes the modal prev/next arrows being clipped by moving them outside the panel's overflow area.
- Error node cards are now fully tinted red (background + title), not just a red border.
- Rewrites JSON highlighting to a VS Code-style tokenizer with bracket pair colorization (gold / purple / blue by depth) and punctuation coloring.

## v0.2.0

- Redesigns the report page from a paginated vertical list into a Masonry gallery where each node output is a card.
- Adds a compact / default / loose layout density switch, persisted to localStorage.
- Cards show a truncated, syntax-highlighted JSON preview with a fixed height; only the detail modal scrolls, so the gallery no longer traps the mouse wheel.
- Clicking a card opens a dark VS Code-style detail modal over a light overlay, with input / output / error segments and an All / Input / Output / Error tab switch.
- The modal supports previous/next node navigation, Esc and overlay-click to close.
- Refreshes the visual system (workbench light theme, refined cards, VS Code Dark+ JSON colors) without touching the capture pipeline.

## v0.1.7

- Formats run selector labels as workflow name plus actual run time instead of raw workflow/log/trace IDs.
- Extracts workflow names and run start times from captured Coze Trace/log payloads, falling back to capture time when needed.
- Moves local cache clearing from the popup to the report page and renames it to local cache clearing.
- Adds report summary text showing total local log count.

## v0.1.6

- Focuses popup statistics on the latest captured run for the active workflow instead of summing all local history.
- Allows switching Coze historical logs without manually clearing local captures first.
- Keeps report history available through the run selector while defaulting to the newest capture.

## v0.1.5

- Switches report grouping to a Trace-first model using Coze `list_spans` and `get_trace` captures.
- Counts runs by `trace_id` / `log_id`, so node detail requests no longer create duplicate runs.
- Builds node cards from Trace spans and prefers `node_name`, `alias_name`, and `workflow_node_id` over DOM-derived labels.
- Keeps `get_node_execute_history` as supplemental data for filling node input, output, and errors.

## v0.1.4

- Cleans concatenated canvas labels such as `运行成功1s视频抽帧输入video输出...` into the real display name `视频抽帧`.
- Re-sanitizes cached invalid labels during report grouping, so old bad labels no longer require clearing local history.
- Replaces the copy control with the user-provided SVG icon and adapts it to the report UI size.

## v0.1.3

- Moves section copy icons next to the section labels instead of the far right edge.
- Refines the copy icon to a clearer overlapping-rectangles symbol.
- Filters execution result panel labels such as "运行成功" and elapsed time text from node title extraction.
- Keeps popup/report statistics grouped by node execution unit rather than visual panels.

## v0.1.2

- Replaces text copy buttons in JSON sections with icon-only copy controls.
- Prefers captured canvas node labels over numeric node IDs in report card titles.
- Groups popup stats and report runs by node execution unit, so one node trial is not split into separate input/output runs.

## v0.1.1

- Deduplicates repeated workflow/node capture records.
- Prevents repeated node cards when Coze refreshes node history after switching tabs.
- Adds VS Code-like JSON syntax highlighting in the report page.
- Adds independent copy buttons for input, output, and error sections.

## v0.1.0

- First MVP of the Chrome extension.
- Captures Coze workflow trial-run related frontend API responses.
- Displays workflow/node data in report cards.
- Supports copying one node or all captured data for AI debugging.
- Supports pagination with 10 cards per page.
