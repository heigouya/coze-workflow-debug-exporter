const DENSITY_KEY = "coze-debug-density";
const DENSITIES = ["compact", "default", "loose"];

let state = {
  runs: [],
  selectedRunId: "",
  density: "default",
  storageStats: { recordCount: 0, approxChars: 0 },
  modal: { open: false, index: -1, tab: "all", iterationIndex: 0 },
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.density = readDensity();

  document.getElementById("refresh").addEventListener("click", load);
  document.getElementById("copy-all").addEventListener("click", copyAll);
  document.getElementById("clear-local").addEventListener("click", clearLocal);
  document.getElementById("run-select").addEventListener("change", (event) => {
    state.selectedRunId = event.target.value;
    render();
  });

  document.getElementById("density-switch").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-density]");
    if (!button) return;
    setDensity(button.dataset.density);
  });

  initModalControls();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentRun()) layoutGallery();
    }, 150);
  });

  await load();
}

/* ---------- 数据加载与渲染 ---------- */

async function load() {
  const data = await send({ type: "GET_RUNS" });
  state.runs = data?.runs || [];
  state.storageStats = data?.storageStats || { recordCount: 0, approxChars: 0 };
  if (!state.runs.some((run) => run.id === state.selectedRunId)) {
    state.selectedRunId = state.runs[0] ? state.runs[0].id : "";
  }
  render();
}

function render() {
  const select = document.getElementById("run-select");
  const content = document.getElementById("content");
  const summary = document.getElementById("summary");
  select.innerHTML = "";

  for (const run of state.runs) {
    const option = document.createElement("option");
    option.value = run.id;
    option.textContent = CozeDebuggerCore.formatRunLabel(run);
    select.appendChild(option);
  }
  select.value = state.selectedRunId;

  applyDensity();

  const run = currentRun();
  content.className = `gallery density-${state.density}`;
  content.innerHTML = "";
  if (!run) {
    summary.textContent = "";
    content.classList.add("is-empty");
    content.innerHTML = `<section class="empty"><h2>还没有捕获到调试数据</h2><p>打开 Coze 工作流页面，点击「试运行」，等节点结果出现后再回到这里。</p></section>`;
    return;
  }

  summary.textContent = `本地共 ${state.runs.length} 次日志；缓存约 ${formatApproxSize(state.storageStats.approxChars)}；当前 ${run.records.length} 条接口记录，${run.nodes.length} 条节点详情`;
  layoutGallery();
}

/* ---------- JS Masonry：按节点顺序横排铺入最短列 ---------- */

function columnCount() {
  const base = { compact: 4, default: 3, loose: 2 }[state.density] || 3;
  const w = window.innerWidth;
  if (w <= 620) return 1;
  if (w <= 900) return Math.min(base, 2);
  if (w <= 1180) return Math.min(base, 3);
  return base;
}

function layoutGallery() {
  const content = document.getElementById("content");
  if (!currentRun()) return;
  content.innerHTML = "";
  const colCount = columnCount();
  const cols = [];
  for (let i = 0; i < colCount; i++) {
    const col = document.createElement("div");
    col.className = "masonry-col";
    content.appendChild(col);
    cols.push(col);
  }
  // 按节点顺序遍历：首行天然铺成 1、2、3…，之后每张卡放进当前最矮的列
  currentNodes().forEach((node, index) => {
    const card = renderNodeCard(node, index);
    let target = cols[0];
    for (const col of cols) {
      if (col.offsetHeight < target.offsetHeight) target = col;
    }
    target.appendChild(card);
  });
  requestAnimationFrame(markClippedCards);
}

function renderNodeCard(node, index) {
  const template = document.getElementById("node-card-template");
  const card = template.content.firstElementChild.cloneNode(true);

  const status = node.status || "unknown";
  const iterationError = Array.isArray(node.iterations) && node.iterations.some((iteration) =>
    /fail|error|失败|异常/i.test(iteration.status || "") || Boolean(iteration.error)
  );
  const isError = /fail|error|失败|异常/i.test(status) || Boolean(node.error) || iterationError;
  if (isError) card.classList.add("is-error");

  card.querySelector(".card-index").textContent = index + 1;
  card.querySelector(".card-title").textContent =
    node.nodeName || node.name || node.endpoint || "未命名节点";

  const badge = card.querySelector(".status-badge");
  badge.textContent = isError ? "失败" : statusLabel(status);
  badge.classList.add(CozeDebuggerCore.statusBadgeClass(isError ? "fail" : status));

  const meta = card.querySelector(".card-meta");
  const parts = [`类型 ${node.nodeType || node.type || "未知"}`];
  if (node.duration) parts.push(`耗时 ${node.duration}`);
  if (Array.isArray(node.iterations) && node.iterations.length) {
    parts.push(`${node.iterations.length} 个批次`);
  }
  meta.textContent = parts.join(" · ");

  const values = nodeValues(node);
  const preview = values.output ?? values.input ?? values.error;
  card.querySelector(".card-preview .json").innerHTML = renderJson(preview);

  card.addEventListener("click", () => openModal(index));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openModal(index);
    }
  });

  const copyBtn = card.querySelector(".copy-node");
  copyBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    const redact = document.getElementById("redact").checked;
    const text = CozeDebuggerCore.buildAiPrompt(currentRun(), [node], { redact });
    await navigator.clipboard.writeText(text);
    toast("已复制本节点");
  });

  return card;
}

function markClippedCards() {
  document.querySelectorAll(".node-card .card-preview").forEach((box) => {
    const pre = box.querySelector(".json");
    if (pre && pre.scrollHeight - box.clientHeight > 4) {
      box.classList.add("is-clipped");
    } else {
      box.classList.remove("is-clipped");
    }
  });
}

/* ---------- 布局密度 ---------- */

function readDensity() {
  try {
    const saved = localStorage.getItem(DENSITY_KEY);
    return DENSITIES.includes(saved) ? saved : "default";
  } catch (_) {
    return "default";
  }
}

function setDensity(density) {
  if (!DENSITIES.includes(density) || density === state.density) return;
  state.density = density;
  try {
    localStorage.setItem(DENSITY_KEY, density);
  } catch (_) {}
  const content = document.getElementById("content");
  content.className = `gallery density-${state.density}`;
  applyDensity();
  layoutGallery();
}

function applyDensity() {
  document.querySelectorAll("#density-switch button").forEach((button) => {
    button.classList.toggle("active", button.dataset.density === state.density);
  });
}

/* ---------- 详情 Modal ---------- */

function initModalControls() {
  const modal = document.getElementById("modal");
  modal.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", closeModal)
  );
  modal.querySelector(".modal-nav.prev").addEventListener("click", () => navModal(-1));
  modal.querySelector(".modal-nav.next").addEventListener("click", () => navModal(1));
  modal.querySelector(".modal-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (button && !button.disabled) setTab(button.dataset.tab);
  });
  modal.querySelector("#batch-select").addEventListener("change", (event) => {
    state.modal.iterationIndex = Number(event.target.value) || 0;
    state.modal.tab = "all";
    renderModal();
  });
  document.addEventListener("keydown", (event) => {
    if (!state.modal.open) return;
    if (event.key === "Escape") closeModal();
    else if (event.key === "ArrowLeft") navModal(-1);
    else if (event.key === "ArrowRight") navModal(1);
  });
}

function openModal(index) {
  state.modal = { open: true, index, tab: "all", iterationIndex: 0 };
  document.getElementById("modal").hidden = false;
  document.body.classList.add("modal-open");
  renderModal();
}

function closeModal() {
  state.modal.open = false;
  document.getElementById("modal").hidden = true;
  document.body.classList.remove("modal-open");
}

function navModal(direction) {
  const nodes = currentNodes();
  const next = state.modal.index + direction;
  if (next < 0 || next >= nodes.length) return;
  state.modal.index = next;
  state.modal.tab = "all";
  state.modal.iterationIndex = 0;
  renderModal();
}

function renderModal() {
  const nodes = currentNodes();
  const node = nodes[state.modal.index];
  if (!node) return closeModal();

  const iterations = Array.isArray(node.iterations) ? node.iterations : [];
  if (state.modal.iterationIndex >= iterations.length) state.modal.iterationIndex = 0;
  const activeRecord = iterations[state.modal.iterationIndex] || node;
  const status = activeRecord.status || node.status || "unknown";
  const isError = /fail|error|失败|异常/i.test(status) || Boolean(activeRecord.error);
  const values = nodeValues(activeRecord);
  const hasError = values.error !== undefined && values.error !== null;

  const modal = document.getElementById("modal");
  const panel = modal.querySelector(".modal-panel");
  panel.classList.toggle("is-error", isError);

  modal.querySelector(".modal-title").textContent =
    `${state.modal.index + 1}. ${node.nodeName || node.name || node.endpoint || "未命名节点"}`;
  const metaParts = [`类型 ${node.nodeType || node.type || "未知"}`, `状态 ${statusLabel(status)}`];
  if (activeRecord.duration || node.duration) metaParts.push(`耗时 ${activeRecord.duration || node.duration}`);
  if (iterations.length) {
    metaParts.push(`批次 ${state.modal.iterationIndex + 1}/${iterations.length}`);
  }
  modal.querySelector(".modal-meta").textContent = metaParts.join(" · ");

  const batchPicker = modal.querySelector("#batch-picker");
  const batchSelect = modal.querySelector("#batch-select");
  batchPicker.hidden = !iterations.length;
  batchSelect.innerHTML = "";
  iterations.forEach((iteration, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    const rawIndex = Number.isFinite(iteration.batchIndex)
      ? `（原始序号 ${iteration.batchIndex}）`
      : "";
    option.textContent = `第 ${index + 1} 次 ${rawIndex}`.trim();
    batchSelect.appendChild(option);
  });
  batchSelect.value = String(state.modal.iterationIndex);

  // 无错误时禁用「错误」标签；若当前正停在错误标签则回退到全部
  const errorTab = modal.querySelector('button[data-tab="error"]');
  errorTab.disabled = !hasError;
  if (!hasError && state.modal.tab === "error") state.modal.tab = "all";

  modal.querySelectorAll(".modal-tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.modal.tab);
  });

  modal.querySelector(".modal-nav.prev").disabled = state.modal.index <= 0;
  modal.querySelector(".modal-nav.next").disabled = state.modal.index >= nodes.length - 1;

  const body = modal.querySelector(".modal-body");
  body.innerHTML = "";
  const tab = state.modal.tab;
  const sections = [];
  if (tab === "all" || tab === "input") sections.push(["input", "输入", values.input]);
  if (tab === "all" || tab === "output") sections.push(["output", "输出", values.output]);
  if ((tab === "all" && hasError) || tab === "error") sections.push(["error", "错误", values.error]);

  for (const [key, label, value] of sections) {
    if (tab === "all" && (value === undefined || value === null)) continue;
    body.appendChild(buildSection(key, label, value));
  }
  if (!body.children.length) {
    body.innerHTML = `<p class="modal-hint">该节点在此分类下没有数据。</p>`;
  }
  body.scrollTop = 0;
}

function buildSection(key, label, value) {
  const section = document.createElement("section");
  section.className = `modal-section section-${key}`;

  const head = document.createElement("div");
  head.className = "modal-section-head";
  const title = document.createElement("span");
  title.className = "modal-section-title";
  title.textContent = label;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-icon";
  copy.setAttribute("aria-label", `复制${label}`);
  copy.title = `复制${label}`;
  copy.innerHTML = `<svg aria-hidden="true" viewBox="0 0 1024 1024" focusable="false"><path d="M661.333333 234.666667A64 64 0 0 1 725.333333 298.666667v597.333333a64 64 0 0 1-64 64h-469.333333A64 64 0 0 1 128 896V298.666667a64 64 0 0 1 64-64z m-21.333333 85.333333H213.333333v554.666667h426.666667v-554.666667z m191.829333-256a64 64 0 0 1 63.744 57.856l0.256 6.144v575.701333a42.666667 42.666667 0 0 1-85.034666 4.992l-0.298667-4.992V149.333333H384a42.666667 42.666667 0 0 1-42.368-37.674666L341.333333 106.666667a42.666667 42.666667 0 0 1 37.674667-42.368L384 64h447.829333z" fill="currentColor"></path></svg>`;
  copy.addEventListener("click", async () => {
    const redact = document.getElementById("redact").checked;
    await navigator.clipboard.writeText(CozeDebuggerCore.stableJson(value, redact));
    toast(`已复制${label}`);
  });
  head.append(title, copy);

  const pre = document.createElement("pre");
  pre.className = "json";
  if (value === undefined || value === null) {
    pre.classList.add("is-blank");
    pre.textContent = "（无数据）";
  } else {
    pre.innerHTML = renderJson(value);
  }

  section.append(head, pre);
  return section;
}

function setTab(tab) {
  state.modal.tab = tab;
  renderModal();
}

/* ---------- 工具函数 ---------- */

/* ---------- VS Code 风格 JSON 高亮（含括号分层配色） ---------- */

function renderJson(value) {
  return highlightJson(CozeDebuggerCore.stableJson(value, false));
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{[])|([}\]])|([:,])/g;

function highlightJson(src) {
  const escaped = String(src)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  let depth = 0;
  return escaped.replace(
    JSON_TOKEN,
    (match, str, num, lit, open, close, punc, offset, whole) => {
      if (str !== undefined) {
        const isKey = /^\s*:/.test(whole.slice(offset + match.length));
        if (isKey) return `<span class="json-key">${match}</span>`;
        // 值字符串里的 http/https 网址 linkify 成可点击链接
        const linked = match.replace(
          /(https?:\/\/[^\s"<]+)/g,
          '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        return `<span class="json-string">${linked}</span>`;
      }
      if (num !== undefined) return `<span class="json-number">${match}</span>`;
      if (lit !== undefined)
        return `<span class="json-${lit === "null" ? "null" : "boolean"}">${match}</span>`;
      if (open !== undefined) {
        const cls = `b${depth % 3}`;
        depth += 1;
        return `<span class="json-bracket ${cls}">${match}</span>`;
      }
      if (close !== undefined) {
        depth = Math.max(0, depth - 1);
        return `<span class="json-bracket b${depth % 3}">${match}</span>`;
      }
      if (punc !== undefined) return `<span class="json-punc">${match}</span>`;
      return match;
    }
  );
}

function nodeValues(node) {
  return {
    input: node.input ?? node.rawRequest,
    output: node.output ?? node.rawResponse,
    error: node.error,
  };
}

function statusLabel(status) {
  if (/success|成功|ok/i.test(status)) return "成功";
  if (/fail|error|失败|异常/i.test(status)) return "失败";
  if (/running|pending|处理中|运行中|等待/i.test(status)) return "运行中";
  if (!status || /unknown/i.test(status)) return "未知";
  return status;
}

function currentNodes() {
  const run = currentRun();
  if (!run) return [];
  return run.nodes.length ? run.nodes : fallbackNodes(run.records);
}

function fallbackNodes(records) {
  return records.map((record, index) => ({
    ...record,
    order: index + 1,
    nodeName: record.endpoint,
    nodeType: record.kind,
    input: record.rawRequest,
    output: record.rawResponse,
  }));
}

async function copyAll() {
  const run = currentRun();
  if (!run) return;
  const redact = document.getElementById("redact").checked;
  const text = CozeDebuggerCore.buildAiPrompt(run, currentNodes(), { redact });
  await navigator.clipboard.writeText(text);
  toast("已复制全部调试数据");
}

async function clearLocal() {
  if (!confirm("确认清空报告页里的本地 Coze 调试缓存？这不会删除 Coze 平台上的历史日志。")) return;
  await send({ type: "CLEAR_RUNS" });
  state.runs = [];
  state.selectedRunId = "";
  closeModal();
  render();
  toast("已清空本地缓存");
}

function currentRun() {
  return state.runs.find((run) => run.id === state.selectedRunId);
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function toast(text) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = text;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 1800);
}

function formatApproxSize(chars) {
  const value = Number(chars || 0);
  if (value < 1000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}
