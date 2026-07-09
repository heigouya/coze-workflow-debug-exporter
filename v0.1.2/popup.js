document.addEventListener("DOMContentLoaded", init);

async function init() {
  const contextEl = document.getElementById("context");
  const runCountEl = document.getElementById("run-count");
  const nodeCountEl = document.getElementById("node-count");

  const [context, data] = await Promise.all([
    send({ type: "GET_ACTIVE_COZE_CONTEXT" }),
    send({ type: "GET_RUNS" }),
  ]);

  if (context && context.ok) {
    contextEl.textContent = `当前工作流: ${context.workflowId || "未识别"} / 空间: ${context.spaceId || "未识别"}`;
  } else {
    contextEl.textContent = context?.reason || "当前不是 Coze 工作流页面";
  }

  const runs = data?.runs || [];
  const summary = CozeDebuggerCore.summarizeRuns(runs);
  runCountEl.textContent = String(summary.runCount);
  nodeCountEl.textContent = String(summary.nodeCount);

  document.getElementById("open-report").addEventListener("click", () => {
    send({ type: "OPEN_REPORT" });
  });

  document.getElementById("clear").addEventListener("click", async () => {
    if (!confirm("确认清空本地捕获的 Coze 调试数据？")) return;
    await send({ type: "CLEAR_RUNS" });
    window.close();
  });
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}
