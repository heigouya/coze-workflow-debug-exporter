# Changelog

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
