const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("section copy controls are generated as icon-only accessible buttons", () => {
  const js = fs.readFileSync(path.join(__dirname, "../report.js"), "utf8");

  assert.match(js, /copy\.className = "copy-icon"/);
  assert.match(js, /copy\.setAttribute\("aria-label", `复制\$\{label\}`\)/);
  assert.match(js, /copy\.innerHTML = `<svg/);
});

test("modal section heading keeps copy icon next to its label", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../styles.css"),
    "utf8"
  );

  const headingRule = css.match(/\.modal-section-head\s*\{[^}]*\}/)?.[0] || "";
  assert.match(headingRule, /justify-content:\s*flex-start/);
});

test("clear local capture action lives on report page instead of popup", () => {
  const reportHtml = fs.readFileSync(
    path.join(__dirname, "../report.html"),
    "utf8"
  );
  const popupHtml = fs.readFileSync(
    path.join(__dirname, "../popup.html"),
    "utf8"
  );
  const reportJs = fs.readFileSync(
    path.join(__dirname, "../report.js"),
    "utf8"
  );
  const popupJs = fs.readFileSync(
    path.join(__dirname, "../popup.js"),
    "utf8"
  );

  assert.match(reportHtml, /id="clear-local"/);
  assert.match(reportJs, /CLEAR_RUNS/);
  assert.doesNotMatch(popupHtml, /id="clear"/);
  assert.doesNotMatch(popupJs, /CLEAR_RUNS/);
});

test("loop node modal provides a selector for each captured batch", () => {
  const html = fs.readFileSync(path.join(__dirname, "../report.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "../report.js"), "utf8");

  assert.match(html, /id="batch-picker"/);
  assert.match(html, /id="batch-select"/);
  assert.match(js, /node\.iterations/);
  assert.match(js, /iterationIndex/);
});

test("popup and report show the approximate cache size", () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
  const popupJs = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
  const reportJs = fs.readFileSync(path.join(__dirname, "../report.js"), "utf8");

  assert.match(popupHtml, /id="cache-size"/);
  assert.match(popupJs, /storageStats/);
  assert.match(reportJs, /storageStats/);
  assert.match(reportJs, /缓存约/);
});

test("refresh falls back to the first run when the previous selection disappeared", () => {
  const reportJs = fs.readFileSync(path.join(__dirname, "../report.js"), "utf8");

  assert.match(reportJs, /state\.runs\.some\(\(run\) => run\.id === state\.selectedRunId\)/);
  assert.match(reportJs, /state\.selectedRunId = state\.runs\[0\]/);
});
