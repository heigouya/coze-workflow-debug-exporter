# Changelog

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
