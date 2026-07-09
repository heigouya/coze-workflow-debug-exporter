document.addEventListener("DOMContentLoaded", init);

async function init() {
  const contextEl = document.getElementById("context");
  const textEl = contextEl.querySelector(".ctx-text");
  const runCountEl = document.getElementById("run-count");
  const nodeCountEl = document.getElementById("node-count");

  const [context, data] = await Promise.all([
    send({ type: "GET_ACTIVE_COZE_CONTEXT" }),
    send({ type: "GET_RUNS" }),
  ]);

  if (context && context.ok) {
    contextEl.classList.add("is-ok");
    textEl.classList.remove("muted");
    const wid = context.workflowId || "";
    const short = wid ? `…${wid.slice(-6)}` : "未识别";
    textEl.innerHTML = `已连接 · 工作流 <code>${short}</code>`;
    if (wid) {
      contextEl.classList.add("copyable");
      contextEl.title = `点击复制工作流 ID：${wid}`;
      contextEl.addEventListener("click", async () => {
        await navigator.clipboard.writeText(wid);
        const prev = textEl.innerHTML;
        textEl.textContent = "已复制工作流 ID";
        setTimeout(() => {
          textEl.innerHTML = prev;
        }, 1200);
      });
    }
  } else {
    textEl.textContent = context?.reason || "当前不是 Coze 工作流页面";
  }

  const runs = data?.runs || [];
  const focusedRuns = CozeDebuggerCore.focusRuns(runs, {
    workflowId: context && context.ok ? context.workflowId : undefined,
  });
  const summary = CozeDebuggerCore.summarizeRuns(focusedRuns);
  runCountEl.textContent = String(summary.runCount);
  nodeCountEl.textContent = String(summary.nodeCount);

  document.getElementById("open-report").addEventListener("click", () => {
    send({ type: "OPEN_REPORT" });
  });
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}
