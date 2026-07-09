importScripts("core.js");

const STORAGE_KEY = "cozeWorkflowDebugRecords";
const MAX_RECORDS = 500;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "COZE_NETWORK_CAPTURE") {
    handleCapture(message.payload, sender).then(sendResponse);
    return true;
  }

  if (message.type === "GET_RUNS") {
    getRecords().then((records) => {
      sendResponse({
        records,
        runs: CozeDebuggerCore.groupRecords(records),
      });
    });
    return true;
  }

  if (message.type === "CLEAR_RUNS") {
    chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => sendResponse({ ok: true }));
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
  records.push(record);
  const limited = records.slice(-MAX_RECORDS);
  await setRecords(limited);

  if (record.kind === "node-history" || record.kind === "workflow-run") {
    chrome.action.setBadgeText({
      tabId: sender?.tab?.id,
      text: String(Math.min(limited.length, 99)),
    });
    chrome.action.setBadgeBackgroundColor({ color: "#4D53E8" });
  }

  return { ok: true, record };
}

function getRecords() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
      resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
    });
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
