let state = {
  runs: [],
  selectedRunId: "",
  page: 1,
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  document.getElementById("refresh").addEventListener("click", load);
  document.getElementById("copy-all").addEventListener("click", copyAll);
  document.getElementById("clear-local").addEventListener("click", clearLocal);
  document.getElementById("run-select").addEventListener("change", (event) => {
    state.selectedRunId = event.target.value;
    state.page = 1;
    render();
  });
  await load();
}

async function load() {
  const data = await send({ type: "GET_RUNS" });
  state.runs = data?.runs || [];
  if (!state.selectedRunId && state.runs[0]) state.selectedRunId = state.runs[0].id;
  render();
}

function render() {
  const select = document.getElementById("run-select");
  const content = document.getElementById("content");
  const pagination = document.getElementById("pagination");
  const summary = document.getElementById("summary");
  select.innerHTML = "";
  pagination.innerHTML = "";

  for (const run of state.runs) {
    const option = document.createElement("option");
    option.value = run.id;
    option.textContent = CozeDebuggerCore.formatRunLabel(run);
    select.appendChild(option);
  }
  select.value = state.selectedRunId;

  const run = currentRun();
  content.innerHTML = "";
  if (!run) {
    summary.textContent = "";
    content.innerHTML = `<section class="empty"><h2>还没有捕获到调试数据</h2><p>打开 Coze 工作流页面，点击「试运行」，等节点结果出现后再回到这里。</p></section>`;
    return;
  }

  summary.textContent = `本地共 ${state.runs.length} 次日志；当前 ${run.records.length} 条接口记录，${run.nodes.length} 条节点详情`;
  const nodes = run.nodes.length ? run.nodes : fallbackNodes(run.records);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(nodes.length / pageSize));
  state.page = Math.min(Math.max(state.page, 1), totalPages);
  const start = (state.page - 1) * pageSize;
  nodes.slice(start, start + pageSize).forEach((node, index) => {
    content.appendChild(renderNodeCard(node, start + index));
  });

  renderPagination(nodes.length, pageSize);
}

function renderNodeCard(node, index) {
  const template = document.getElementById("node-card-template");
  const card = template.content.firstElementChild.cloneNode(true);
  const title = card.querySelector("h2");
  const meta = card.querySelector(".meta");
  const errorBlock = card.querySelector(".error-block");

  const status = node.status || "unknown";
  title.textContent = `${index + 1}. ${node.nodeName || node.name || node.endpoint || "未命名节点"}`;
  meta.textContent = `类型: ${node.nodeType || node.type || "未知"} | 状态: ${status}${node.duration ? ` | 耗时: ${node.duration}` : ""}`;

  if (/fail|error|失败|异常/i.test(status) || node.error) card.classList.add("is-error");

  const values = {
    input: node.input ?? node.rawRequest,
    output: node.output ?? node.rawResponse,
    error: node.error,
  };
  renderJsonBlock(card.querySelector(".input"), values.input);
  renderJsonBlock(card.querySelector(".output"), values.output);
  renderJsonBlock(card.querySelector(".error"), values.error);
  if (!node.error) errorBlock.hidden = true;

  card.querySelector(".copy-node").addEventListener("click", async () => {
    const redact = document.getElementById("redact").checked;
    const text = CozeDebuggerCore.buildAiPrompt(currentRun(), [node], { redact });
    await navigator.clipboard.writeText(text);
    toast("已复制本节点");
  });

  card.querySelectorAll(".copy-section").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const section = button.dataset.section;
      const redact = document.getElementById("redact").checked;
      await navigator.clipboard.writeText(CozeDebuggerCore.stableJson(values[section], redact));
      toast(button.getAttribute("aria-label") || "已复制");
    });
  });

  return card;
}

function renderJsonBlock(element, value) {
  element.innerHTML = CozeDebuggerCore.renderJsonHtml(value, false);
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

function renderPagination(total, pageSize) {
  const pagination = document.getElementById("pagination");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return;

  const prev = document.createElement("button");
  prev.className = "secondary";
  prev.textContent = "上一页";
  prev.disabled = state.page <= 1;
  prev.addEventListener("click", () => {
    state.page -= 1;
    render();
  });

  const next = document.createElement("button");
  next.className = "secondary";
  next.textContent = "下一页";
  next.disabled = state.page >= totalPages;
  next.addEventListener("click", () => {
    state.page += 1;
    render();
  });

  const info = document.createElement("span");
  info.className = "muted";
  info.textContent = `第 ${state.page} / ${totalPages} 页，共 ${total} 个节点；复制全部会包含所有节点`;

  pagination.append(prev, info, next);
}

async function copyAll() {
  const run = currentRun();
  if (!run) return;
  const redact = document.getElementById("redact").checked;
  const nodes = run.nodes.length ? run.nodes : fallbackNodes(run.records);
  const text = CozeDebuggerCore.buildAiPrompt(run, nodes, { redact });
  await navigator.clipboard.writeText(text);
  toast("已复制全部调试数据");
}

async function clearLocal() {
  if (!confirm("确认清空报告页里的本地 Coze 调试缓存？这不会删除 Coze 平台上的历史日志。")) return;
  await send({ type: "CLEAR_RUNS" });
  state.runs = [];
  state.selectedRunId = "";
  state.page = 1;
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
