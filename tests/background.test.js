const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../core.js");

test("keeps both records when captures arrive at the same time", async () => {
  const harness = loadBackgroundHarness({ getDelay: 10, setDelay: 10 });

  const [first, second] = await Promise.all([
    harness.capture(1001),
    harness.capture(1002),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(harness.records().length, 2);
  assert.deepEqual(
    harness.records().map((record) => record.executeId).sort(),
    ["exec-1001", "exec-1002"]
  );
});

function loadBackgroundHarness({ getDelay = 0, setDelay = 0 } = {}) {
  let listener;
  let storage = {
    cozeWorkflowDebugRecords: [],
    cozeWorkflowNodeLabels: {},
  };

  global.CozeDebuggerCore = core;
  global.importScripts = () => {};
  global.chrome = {
    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
    },
    storage: {
      local: {
        get(defaults, callback) {
          const snapshot = structuredClone(storage);
          setTimeout(() => callback({ ...defaults, ...snapshot }), getDelay);
        },
        set(values, callback) {
          setTimeout(() => {
            storage = { ...storage, ...structuredClone(values) };
            callback?.();
          }, setDelay);
        },
      },
    },
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
    },
    tabs: {
      create() {},
      query() {},
      sendMessage() {},
    },
  };

  delete require.cache[require.resolve("../background.js")];
  require("../background.js");

  return {
    records() {
      return storage.cozeWorkflowDebugRecords;
    },
    capture(id) {
      return new Promise((resolve) => {
        listener(
          {
            type: "COZE_NETWORK_CAPTURE",
            payload: {
              url: "https://www.coze.cn/api/workflow_api/test_run",
              method: "POST",
              timestamp: id,
              requestBody: JSON.stringify({
                workflow_id: "wf",
                execute_id: `exec-${id}`,
              }),
              responseBody: JSON.stringify({
                code: 0,
                data: { execute_id: `exec-${id}` },
              }),
            },
          },
          { tab: { id: 1 } },
          resolve
        );
      });
    },
  };
}
