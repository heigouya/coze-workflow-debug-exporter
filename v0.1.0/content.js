(function () {
  "use strict";

  const SOURCE = "coze-workflow-debug-exporter";

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

  injectHook();
})();
