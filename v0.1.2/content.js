(function () {
  "use strict";

  const SOURCE = "coze-workflow-debug-exporter";
  let lastLabelsSignature = "";
  let labelScanTimer;

  function injectHook() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-hook.js");
    script.async = false;
    script.onload = () => script.remove();
    const target = document.documentElement || document.head || document.body;
    if (target) {
      target.appendChild(script);
      return;
    }
    document.addEventListener("DOMContentLoaded", () => {
      (document.documentElement || document.head || document.body).appendChild(script);
    }, { once: true });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== SOURCE) return;
    if (event.data.type !== "NETWORK_CAPTURE") return;
    chrome.runtime.sendMessage({
      type: "COZE_NETWORK_CAPTURE",
      payload: event.data.payload,
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "GET_PAGE_CONTEXT") {
      const params = new URL(location.href).searchParams;
      sendResponse({
        pageUrl: location.href,
        workflowId: params.get("workflow_id") || undefined,
        spaceId: params.get("space_id") || undefined,
        executeId: params.get("execute_id") || undefined,
      });
      return true;
    }
    return false;
  });

  function scheduleNodeLabelScan() {
    clearTimeout(labelScanTimer);
    labelScanTimer = setTimeout(sendNodeLabels, 500);
  }

  function sendNodeLabels() {
    const payload = collectNodeLabels();
    const signature = JSON.stringify(payload);
    if (!payload.workflowId || !Object.keys(payload.labels).length || signature === lastLabelsSignature) {
      return;
    }
    lastLabelsSignature = signature;
    chrome.runtime.sendMessage({
      type: "COZE_NODE_LABELS",
      payload,
    });
  }

  function collectNodeLabels() {
    const params = new URL(location.href).searchParams;
    const workflowId = params.get("workflow_id") || undefined;
    const spaceId = params.get("space_id") || undefined;
    const labels = {};
    const nodes = document.querySelectorAll(
      ".react-flow__node, [data-id], [data-node-id], [data-nodeid]"
    );

    nodes.forEach((node) => {
      const nodeId = node.getAttribute("data-id") ||
        node.getAttribute("data-node-id") ||
        node.getAttribute("data-nodeid") ||
        extractNodeIdFromAttribute(node.id);
      const label = extractNodeLabel(node, nodeId);
      if (nodeId && label) labels[nodeId] = label;
    });

    return { workflowId, spaceId, labels };
  }

  function extractNodeIdFromAttribute(value) {
    if (!value) return undefined;
    const match = String(value).match(/\d{3,}/);
    return match ? match[0] : undefined;
  }

  function extractNodeLabel(node, nodeId) {
    const preferred = node.querySelector(
      '[class*="title"], [class*="Title"], [class*="name"], [class*="Name"]'
    );
    const candidates = [
      preferred?.textContent,
      node.getAttribute("aria-label"),
      node.textContent,
    ]
      .flatMap((value) => String(value || "").split(/\n|\r/))
      .map((value) => value.trim())
      .filter(Boolean);

    return candidates.find((value) => isUsefulLabel(value, nodeId));
  }

  function isUsefulLabel(value, nodeId) {
    if (!value || value === nodeId) return false;
    if (/^\d+$/.test(value)) return false;
    if (value.length > 40) return false;
    if (/^(输入|输出|错误信息|复制|运行|调试|节点|成功|失败)$/i.test(value)) return false;
    return /[\u4e00-\u9fa5A-Za-z]/.test(value);
  }

  injectHook();
  document.addEventListener("DOMContentLoaded", scheduleNodeLabelScan, { once: true });
  window.addEventListener("load", scheduleNodeLabelScan, { once: true });
  setInterval(scheduleNodeLabelScan, 3000);
  new MutationObserver(scheduleNodeLabelScan).observe(document.documentElement || document, {
    childList: true,
    subtree: true,
  });
})();
