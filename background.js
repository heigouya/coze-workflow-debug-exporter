importScripts("core.js");

const STORAGE_KEY = "cozeWorkflowDebugRecords";
const LABELS_KEY = "cozeWorkflowNodeLabels";
const MAX_RECORDS = 500;
let captureQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "COZE_NETWORK_CAPTURE") {
    const task = captureQueue.then(() => handleCapture(message.payload, sender));
    captureQueue = task.catch(() => undefined);
    task.then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    });
    return true;
  }

  if (message.type === "COZE_NODE_LABELS") {
    handleNodeLabels(message.payload).then(sendResponse);
    return true;
  }

  if (message.type === "GET_RUNS") {
    Promise.all([getRecords(), getNodeLabels()]).then(([records, nodeLabels]) => {
      sendResponse({
        records,
        runs: CozeDebuggerCore.groupRecords(records, { nodeLabels }),
      });
    });
    return true;
  }

  if (message.type === "CLEAR_RUNS") {
    chrome.storage.local.set({ [STORAGE_KEY]: [], [LABELS_KEY]: {} }, () => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "OPEN_REPORT") {
    chrome.tabs.create({ url: chrome.runtime.getURL("report.html") }, (tab) => {
      sendResponse({ ok: true, tabId: tab && tab.id });
    });
    return true;
  }

  if (message.type === "GET_ACTIVE_COZE_CONTEXT") {
    getActiveCozeContext().then(sendResponse);
    return true;
  }

  return false;
});

async function handleCapture(payload, sender) {
  if (!payload || !CozeDebuggerCore.isInterestingCozeRequest(payload.url)) {
    return { ok: false, ignored: true };
  }

  const record = CozeDebuggerCore.normalizeCapture({
    ...payload,
    tabId: sender?.tab?.id,
  });

  const records = await getRecords();
  const fingerprint = CozeDebuggerCore.fingerprintRecord(record);
  if (records.some((existing) => CozeDebuggerCore.fingerprintRecord(existing) === fingerprint)) {
    return { ok: true, duplicate: true, record };
  }

  records.push(record);
  const limited = records.slice(-MAX_RECORDS);
  await setRecords(limited);

  if (record.kind === "node-history" || record.kind === "workflow-run") {
    // 角标显示当前工作流最新一次运行的节点数，与 popup 的「节点记录」一致
    const runs = CozeDebuggerCore.groupRecords(limited);
    const focused = CozeDebuggerCore.focusRuns(runs, { workflowId: record.workflowId });
    const nodeCount = CozeDebuggerCore.summarizeRuns(focused).nodeCount || 0;
    chrome.action.setBadgeText({
      tabId: sender?.tab?.id,
      text: nodeCount ? String(Math.min(nodeCount, 99)) : "",
    });
    chrome.action.setBadgeBackgroundColor({ color: "#4D53E8" });
  }

  return { ok: true, record };
}

async function handleNodeLabels(payload) {
  if (!payload || !payload.workflowId || !payload.labels) {
    return { ok: false, ignored: true };
  }
  const labels = CozeDebuggerCore.sanitizeNodeLabels(payload.labels);
  if (!Object.keys(labels).length) {
    return { ok: true, ignored: true, count: 0 };
  }
  const current = await getNodeLabels();
  const workflowLabels = current[payload.workflowId] || {};
  current[payload.workflowId] = {
    ...workflowLabels,
    ...labels,
  };
  await setNodeLabels(current);
  return { ok: true, count: Object.keys(labels).length };
}

function getRecords() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
      resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
    });
  });
}

function getNodeLabels() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [LABELS_KEY]: {} }, (result) => {
      resolve(result[LABELS_KEY] && typeof result[LABELS_KEY] === "object" ? result[LABELS_KEY] : {});
    });
  });
}

function setNodeLabels(nodeLabels) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [LABELS_KEY]: nodeLabels }, () => resolve());
  });
}

function setRecords(records) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: records }, () => resolve());
  });
}

async function getActiveCozeContext() {
  const tabs = await queryActiveTab();
  const tab = tabs && tabs[0];
  if (!tab || !tab.id || !/https:\/\/[^/]*coze\.(cn|com)\//.test(tab.url || "")) {
    return { ok: false, reason: "当前标签页不是 Coze 页面" };
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve({ ok: true, tabId: tab.id, ...response });
    });
  });
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, resolve);
  });
}
