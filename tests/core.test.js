const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAiPrompt,
  formatRunLabel,
  fingerprintRecord,
  focusRuns,
  groupRecords,
  limitRecords,
  renderJsonHtml,
  normalizeCapture,
  redactSensitiveValue,
  sanitizeNodeLabels,
  summarizeRuns,
  statusBadgeClass,
} = require("../core.js");

test("normalizes workflow test_run response with debug_url and execute_id", () => {
  const record = normalizeCapture({
    method: "POST",
    url: "https://www.coze.cn/api/workflow_api/test_run",
    pageUrl:
      "https://www.coze.cn/work_flow?workflow_id=7659767431749320750&space_id=7555038132773896234",
    requestBody: JSON.stringify({
      workflow_id: "7659767431749320750",
      space_id: "7555038132773896234",
      input: { prompt: "hello" },
    }),
    responseBody: JSON.stringify({
      code: 0,
      data: {
        execute_id: "7413647890307281111",
        debug_url:
          "https://www.coze.cn/work_flow?execute_id=7413647890307281111&space_id=7555038132773896234&workflow_id=7659767431749320750",
      },
    }),
    timestamp: 1720420000000,
  });

  assert.equal(record.kind, "workflow-run");
  assert.equal(record.workflowId, "7659767431749320750");
  assert.equal(record.spaceId, "7555038132773896234");
  assert.equal(record.executeId, "7413647890307281111");
  assert.equal(record.status, "success");
});

test("parses each captured request and response body only once", () => {
  const originalParse = JSON.parse;
  let parseCount = 0;
  JSON.parse = function countedParse(value) {
    parseCount += 1;
    return originalParse(value);
  };

  try {
    normalizeCapture({
      method: "POST",
      url: "https://www.coze.cn/api/workflow_api/test_run",
      requestBody: JSON.stringify({ workflow_id: "wf1", space_id: "sp1" }),
      responseBody: JSON.stringify({ code: 0, data: { execute_id: "exec1" } }),
      timestamp: 1000,
    });
  } finally {
    JSON.parse = originalParse;
  }

  assert.equal(parseCount, 2);
});

test("drops the oldest records when the cache exceeds its size limit", () => {
  const records = [1, 2, 3].map((id) => ({ id, payload: "x".repeat(40) }));
  const oneRecordChars = JSON.stringify(records[0]).length;

  const limited = limitRecords(records, {
    maxRecords: 10,
    maxChars: oneRecordChars * 2,
  });

  assert.deepEqual(limited.records.map((record) => record.id), [2, 3]);
  assert.equal(limited.droppedCount, 1);
  assert.ok(limited.totalChars <= oneRecordChars * 2);
});

test("normalizes node execute history response with node input and output", () => {
  const record = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?workflow_id=wf1&space_id=sp1&execute_id=exec1&node_id=node1&node_type=Code",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        node_name: "最终汇总_2",
        node_type: "Code",
        status: "success",
        input: { image_url: "https://s.coze.cn/t/demo/" },
        output: { image_str: "{\"image_url\":\"https://s.coze.cn/t/demo/\"}" },
        execute_time: "0.188s",
      },
    }),
    timestamp: 1720420000000,
  });

  assert.equal(record.kind, "node-history");
  assert.equal(record.workflowId, "wf1");
  assert.equal(record.spaceId, "sp1");
  assert.equal(record.executeId, "exec1");
  assert.equal(record.nodeId, "node1");
  assert.equal(record.nodeName, "最终汇总_2");
  assert.deepEqual(record.input, { image_url: "https://s.coze.cn/t/demo/" });
  assert.deepEqual(record.output, {
    image_str: "{\"image_url\":\"https://s.coze.cn/t/demo/\"}",
  });
});

test("redacts obvious secrets and signed URL parameters", () => {
  const redacted = redactSensitiveValue({
    api_token: "pat_secret_123",
    video_url:
      "https://coze-dianbo.tos-cn-beijing.volces.com/demo.mp4?X-Tos-Signature=abc&X-Tos-Credential=cred&keep=1",
    nested: { Authorization: "Bearer hello" },
  });

  assert.equal(redacted.api_token, "[REDACTED]");
  assert.equal(
    redacted.video_url,
    "https://coze-dianbo.tos-cn-beijing.volces.com/demo.mp4?[SIGNED_QUERY_REDACTED]"
  );
  assert.equal(redacted.nested.Authorization, "[REDACTED]");
});

test("redacts common browser session and API credential fields", () => {
  const redacted = redactSensitiveValue({
    cookie: "sid=abc",
    token: "opaque-value",
    refresh_token: "refresh-value",
    api_key: "api-key-value",
    session_id: "session-value",
    ordinary_key: "safe-value",
  });

  assert.equal(redacted.cookie, "[REDACTED]");
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.refresh_token, "[REDACTED]");
  assert.equal(redacted.api_key, "[REDACTED]");
  assert.equal(redacted.session_id, "[REDACTED]");
  assert.equal(redacted.ordinary_key, "safe-value");
});

test("uses different badge colors for success, running, unknown, and failure", () => {
  assert.equal(statusBadgeClass("success"), "is-ok");
  assert.equal(statusBadgeClass("running"), "is-running");
  assert.equal(statusBadgeClass("unknown"), "is-unknown");
  assert.equal(statusBadgeClass("fail"), "is-fail");
});

test("builds ordered AI prompt text with errored nodes highlighted", () => {
  const text = buildAiPrompt(
    {
      workflowId: "wf1",
      executeId: "exec1",
      capturedAt: 1720420000000,
    },
    [
      {
        order: 2,
        nodeName: "结束",
        nodeType: "End",
        status: "success",
        input: { result: "ok" },
        output: { output: "done" },
      },
      {
        order: 1,
        nodeName: "HTTP 请求",
        nodeType: "HTTP",
        status: "fail",
        error: { message: "timeout" },
        input: { url: "https://example.com" },
      },
    ],
    { redact: true }
  );

  assert.match(text, /工作流 ID: wf1/);
  assert.match(text, /执行 ID: exec1/);
  assert.match(text, /节点 1: HTTP 请求/);
  assert.match(text, /状态: fail/);
  assert.match(text, /错误信息/);
  assert.match(text, /节点 2: 结束/);
});

test("includes every loop batch when copying a loop node", () => {
  const text = buildAiPrompt(
    { workflowId: "wf1", executeId: "exec1", capturedAt: 1000 },
    [
      {
        order: 1,
        nodeName: "循环处理",
        nodeType: "Loop",
        status: "success",
        iterations: [
          { batchIndex: 0, status: "success", input: { item: 0 }, output: { result: "A" } },
          { batchIndex: 1, status: "success", input: { item: 1 }, output: { result: "B" } },
        ],
      },
    ],
    { redact: true }
  );

  assert.match(text, /批次 1\/2/);
  assert.match(text, /批次 2\/2/);
  assert.match(text, /"result": "A"/);
  assert.match(text, /"result": "B"/);
});

test("groups records by execute id and removes duplicate node history", () => {
  const first = normalizeCapture({
    method: "POST",
    url: "https://www.coze.cn/api/workflow_api/test_run",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    requestBody: JSON.stringify({ workflow_id: "wf1", space_id: "sp1" }),
    responseBody: JSON.stringify({ code: 0, data: { execute_id: "exec1" } }),
    timestamp: 1000,
  });
  const node = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?workflow_id=wf1&space_id=sp1&execute_id=exec1&node_id=node1&node_type=Code",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        node_name: "176069",
        node_type: "Code",
        input: { chunks: [1, 2, 3] },
        output: { chunks: [2, 3] },
      },
    }),
    timestamp: 2000,
  });

  const runs = groupRecords([first, node, { ...node, id: "duplicate", timestamp: 3000 }]);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].records.length, 2);
  assert.equal(runs[0].nodes.length, 1);
  assert.equal(runs[0].nodes[0].nodeName, "176069");
});

test("fingerprint ignores volatile capture id and timestamp", () => {
  const a = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?workflow_id=wf1&space_id=sp1&execute_id=exec1&node_id=node1",
    responseBody: JSON.stringify({ code: 0, data: { input: { a: 1 }, output: { b: 2 } } }),
    timestamp: 1000,
  });
  const b = { ...a, id: "changed-id", timestamp: 9999 };

  assert.equal(fingerprintRecord(a), fingerprintRecord(b));
});

test("renders JSON as escaped highlighted html tokens", () => {
  const html = renderJsonHtml({
    message: "<script>",
    count: 5,
    active: true,
    empty: null,
  });

  assert.match(html, /<span class="json-key">"message"<\/span>/);
  assert.match(html, /<span class="json-string">"&lt;script&gt;"<\/span>/);
  assert.match(html, /<span class="json-number">5<\/span>/);
  assert.match(html, /<span class="json-boolean">true<\/span>/);
  assert.match(html, /<span class="json-null">null<\/span>/);
});

test("groups one node trial without execute id as one run and one merged node", () => {
  const inputRecord = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?workflow_id=wf1&space_id=sp1&node_id=node-video&node_type=Plugin",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        node_name: "122370",
        node_type: "Plugin",
        input: { video_url: "https://example.com/a.mp4" },
      },
    }),
    timestamp: 1000,
  });
  const outputRecord = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?workflow_id=wf1&space_id=sp1&node_id=node-video&node_type=Plugin",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        node_name: "122370",
        node_type: "Plugin",
        output: { chunks: [{ index: 0 }] },
      },
    }),
    timestamp: 2500,
  });

  const runs = groupRecords([inputRecord, outputRecord]);
  const summary = summarizeRuns(runs);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].nodes.length, 1);
  assert.deepEqual(runs[0].nodes[0].input, { video_url: "https://example.com/a.mp4" });
  assert.deepEqual(runs[0].nodes[0].output, { chunks: [{ index: 0 }] });
  assert.deepEqual(summary, { runCount: 1, nodeCount: 1 });
});

test("uses captured canvas node label instead of numeric node id", () => {
  const record = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?workflow_id=wf1&space_id=sp1&execute_id=exec1&node_id=122370&node_type=Plugin",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        node_name: "122370",
        node_type: "Plugin",
        output: { ok: true },
      },
    }),
    timestamp: 1000,
  });

  const runs = groupRecords([record], {
    nodeLabels: {
      wf1: {
        "122370": "视频抽帧",
      },
    },
  });

  assert.equal(runs[0].nodes[0].nodeName, "视频抽帧");
});

test("ignores execution result panel text when collecting node labels", () => {
  const labels = sanitizeNodeLabels({
    "122370": "运行成功",
    "122371": "运行成功 1s",
    "122372": "视频抽帧",
  });

  assert.deepEqual(labels, {
    "122372": "视频抽帧",
  });
});

test("cleans concatenated canvas text into the real node display name", () => {
  const labels = sanitizeNodeLabels({
    "122370": "运行成功1s视频抽帧输入video输出datalog_idmsg",
  });

  assert.deepEqual(labels, {
    "122370": "视频抽帧",
  });
});

test("falls back to readable node type when cached canvas label is invalid", () => {
  const record = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?workflow_id=wf1&space_id=sp1&execute_id=exec1&node_id=122370&node_type=VideoFrameExtractor",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        node_name: "122370",
        node_type: "VideoFrameExtractor",
        output: { ok: true },
      },
    }),
    timestamp: 1000,
  });

  const runs = groupRecords([record], {
    nodeLabels: {
      wf1: {
        "122370": "运行成功1s视频抽帧输入video输出datalog_idmsg",
      },
    },
  });

  assert.equal(runs[0].nodes[0].nodeName, "视频抽帧");
});

test("normalizes get_trace spans into node cards with stable display names", () => {
  const trace = normalizeCapture({
    method: "POST",
    url:
      "https://www.coze.cn/api/workflow_api/get_trace?log_id=log1&start_at=1782921600000&end_at=1783612799999",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        spans: [
          {
            span_id: "root",
            parent_id: "0",
            log_id: "log1",
            trace_id: "trace1",
            type: "Workflow",
            name: "测试工作流",
            alias_name: "Workflow 测试工作流",
            status_code: 0,
            start_time: 1000,
            tags: [
              tag("workflow_id", "wf1"),
              tag("execute_id", "exec1"),
              tag("space_id", "sp1"),
            ],
          },
          {
            span_id: "span-video",
            parent_id: "root",
            log_id: "log1",
            trace_id: "trace1",
            type: "WorkflowPluginTool",
            name: "VideoFrameExtractor",
            alias_name: "WorkflowPluginTool 视频抽帧",
            status_code: 0,
            duration: 3460,
            input: { content: "{\"video\":\"https://example.com/a.mp4\"}", type: 0 },
            output: { content: "{\"data\":[1,2],\"msg\":\"success\"}", type: 0 },
            start_time: 1200,
            tags: [
              tag("workflow_id", "wf1"),
              tag("execute_id", "exec1"),
              tag("workflow_node_id", "122370"),
              tag("node_name", "视频抽帧"),
              tag("span_type", "WorkflowPluginTool"),
              tag("space_id", "sp1"),
            ],
          },
        ],
      },
    }),
    timestamp: 2000,
  });

  const runs = groupRecords([trace]);

  assert.equal(trace.kind, "trace");
  assert.equal(trace.traceId, "trace1");
  assert.equal(trace.logId, "log1");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, "trace:trace1");
  assert.equal(runs[0].nodes.length, 1);
  assert.equal(runs[0].nodes[0].nodeName, "视频抽帧");
  assert.equal(runs[0].nodes[0].nodeId, "122370");
  assert.equal(runs[0].nodes[0].iterations, undefined);
  assert.deepEqual(runs[0].nodes[0].input, { video: "https://example.com/a.mp4" });
  assert.deepEqual(runs[0].nodes[0].output, { data: [1, 2], msg: "success" });
});

test("keeps repeated trace spans when node history arrives first", () => {
  const nodeHistory = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?" +
      "workflow_id=wf1&space_id=sp1&execute_id=exec-loop&node_id=image2image-node&" +
      "node_type=WorkflowPluginTool",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        node_name: "image2image",
        node_type: "WorkflowPluginTool",
        input: {
          prompt: "prompt-1",
          url: "https://example.com/frame_001.jpg",
        },
        output: {
          code: 0,
          data: { images: [{ image_url: "https://example.com/result-1.jpg" }] },
          msg: "success",
        },
      },
    }),
    timestamp: 500,
  });
  const trace = normalizeCapture({
    method: "POST",
    url: "https://www.coze.cn/api/workflow_api/get_trace?log_id=log-loop",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        spans: Array.from({ length: 6 }, (_item, index) => ({
          span_id: `image-span-${index + 1}`,
          parent_id: "loop-span",
          log_id: "log-loop",
          trace_id: "trace-loop",
          type: "WorkflowPluginTool",
          name: "image2image",
          status_code: 0,
          start_time: 1000 + index,
          input: {
            content: JSON.stringify({
              prompt: `prompt-${index + 1}`,
              url: `https://example.com/frame_${String(index + 1).padStart(3, "0")}.jpg`,
            }),
            type: 0,
          },
          output: {
            content: JSON.stringify({
              code: 0,
              data: { images: [{ image_url: `https://example.com/result-${index + 1}.jpg` }] },
              msg: "success",
            }),
            type: 0,
          },
          tags: [
            tag("workflow_id", "wf1"),
            tag("execute_id", "exec-loop"),
            tag("workflow_node_id", "image2image-node"),
            tag("node_name", "image2image"),
            tag("span_type", "WorkflowPluginTool"),
            tag("space_id", "sp1"),
          ],
        })),
      },
    }),
    timestamp: 2000,
  });

  const runs = groupRecords([nodeHistory, trace]);
  const node = runs[0].nodes[0];

  assert.equal(runs[0].nodes.length, 1);
  assert.equal(node.iterations.length, 6);
  assert.deepEqual(
    node.iterations.map((iteration) => iteration.input.url),
    Array.from(
      { length: 6 },
      (_item, index) => `https://example.com/frame_${String(index + 1).padStart(3, "0")}.jpg`
    )
  );
  assert.deepEqual(
    node.iterations.map((iteration) => iteration.output.data.images[0].image_url),
    Array.from({ length: 6 }, (_item, index) => `https://example.com/result-${index + 1}.jpg`)
  );
});

test("groups trace records by log id and ignores node history as a separate run", () => {
  const listSpans = normalizeCapture({
    method: "POST",
    url: "https://www.coze.cn/api/workflow_api/list_spans",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    requestBody: JSON.stringify({ workflow_id: "wf1", limit: 50, offset: 0 }),
    responseBody: JSON.stringify({
      code: 0,
      data: {
        spans: [
          {
            span_id: "status",
            log_id: "log1",
            trace_id: "trace1",
            type: "flow_span",
            name: "WorkflowCallback",
            status_code: 0,
            start_time: 1000,
            tags: [
              tag("workflow_id", "wf1"),
              tag("execute_id", "exec1"),
              tag("space_id", "sp1"),
              tag("span_type", "WorkflowStatus"),
            ],
          },
        ],
      },
    }),
    timestamp: 1000,
  });
  const nodeHistory = normalizeCapture({
    method: "GET",
    url:
      "https://www.coze.cn/api/workflow_api/get_node_execute_history?workflow_id=wf1&space_id=sp1&execute_id=exec1&node_id=122370&node_type=VideoFrameExtractor",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        NodeName: "VideoFrameExtractor",
        NodeType: "VideoFrameExtractor",
        executeId: "exec1",
        nodeId: "122370",
        input: "{\"video\":\"https://example.com/a.mp4\"}",
        output: "{\"data\":[1]}",
      },
    }),
    timestamp: 1500,
  });
  const trace = normalizeCapture({
    method: "POST",
    url: "https://www.coze.cn/api/workflow_api/get_trace?log_id=log1",
    pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
    responseBody: JSON.stringify({
      code: 0,
      data: {
        spans: [
          {
            span_id: "span-video",
            log_id: "log1",
            trace_id: "trace1",
            type: "WorkflowPluginTool",
            name: "VideoFrameExtractor",
            status_code: 0,
            start_time: 1200,
            tags: [
              tag("workflow_id", "wf1"),
              tag("execute_id", "exec1"),
              tag("workflow_node_id", "122370"),
              tag("node_name", "视频抽帧"),
              tag("space_id", "sp1"),
            ],
          },
        ],
      },
    }),
    timestamp: 2000,
  });

  const runs = groupRecords([listSpans, nodeHistory, trace]);
  const summary = summarizeRuns(runs);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, "trace:trace1");
  assert.equal(runs[0].records.length, 3);
  assert.equal(runs[0].nodes.length, 1);
  assert.equal(runs[0].nodes[0].nodeName, "视频抽帧");
  assert.equal(runs[0].nodes[0].iterations, undefined);
  assert.deepEqual(summary, { runCount: 1, nodeCount: 1 });
});

test("keeps loop batches inside one node without losing each batch output", () => {
  const records = [0, 1].map((batchIndex) =>
    normalizeCapture({
      method: "GET",
      url:
        `https://www.coze.cn/api/workflow_api/get_node_execute_history?` +
        `workflow_id=wf1&space_id=sp1&execute_id=exec1&node_id=loop1&` +
        `node_type=Loop&batch_index=${batchIndex}&sub_execute_id=sub-${batchIndex}`,
      pageUrl: "https://www.coze.cn/work_flow?workflow_id=wf1&space_id=sp1",
      responseBody: JSON.stringify({
        code: 0,
        data: {
          node_name: "循环处理",
          node_type: "Loop",
          input: { item: batchIndex },
          output: { result: `result-${batchIndex}` },
          status: "success",
          batch_index: batchIndex,
          sub_execute_id: `sub-${batchIndex}`,
        },
      }),
      timestamp: 1000 + batchIndex,
    })
  );

  const runs = groupRecords(records);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].nodes.length, 1);
  assert.equal(runs[0].nodes[0].iterations.length, 2);
  assert.deepEqual(
    runs[0].nodes[0].iterations.map((iteration) => iteration.output),
    [{ result: "result-0" }, { result: "result-1" }]
  );
});

test("focuses the latest run for the current workflow instead of summarizing all history", () => {
  const first = traceRecord({
    workflowId: "wf1",
    spaceId: "sp1",
    logId: "log1",
    traceId: "trace1",
    executeId: "exec1",
    nodeName: "第一次日志节点",
    timestamp: 1000,
  });
  const third = traceRecord({
    workflowId: "wf1",
    spaceId: "sp1",
    logId: "log3",
    traceId: "trace3",
    executeId: "exec3",
    nodeName: "第三次日志节点",
    timestamp: 3000,
  });
  const otherWorkflow = traceRecord({
    workflowId: "wf2",
    spaceId: "sp1",
    logId: "log-other",
    traceId: "trace-other",
    executeId: "exec-other",
    nodeName: "其他工作流节点",
    timestamp: 4000,
  });

  const runs = groupRecords([first, third, otherWorkflow]);
  const focused = focusRuns(runs, { workflowId: "wf1" });

  assert.equal(runs.length, 3);
  assert.equal(focused.length, 1);
  assert.equal(focused[0].id, "trace:trace3");
  assert.deepEqual(summarizeRuns(focused), { runCount: 1, nodeCount: 1 });
  assert.equal(focused[0].nodes[0].nodeName, "第三次日志节点");
});

test("formats run selector with workflow name and actual run time", () => {
  const runTime = new Date(2026, 6, 9, 15, 30, 3).getTime();
  const captureTime = new Date(2026, 6, 9, 15, 45, 3).getTime();
  const trace = traceRecord({
    workflowId: "wf1",
    spaceId: "sp1",
    workflowName: "短视频处理工作流",
    logId: "log1",
    traceId: "trace1",
    executeId: "exec1",
    nodeName: "视频抽帧",
    timestamp: runTime,
    capturedAt: captureTime,
  });

  const runs = groupRecords([trace]);

  assert.equal(runs[0].workflowName, "短视频处理工作流");
  assert.equal(runs[0].startedAt, runTime);
  assert.equal(
    formatRunLabel(runs[0]),
    `短视频处理工作流 / 运行时间 ${new Date(runTime).toLocaleString("zh-CN", { hour12: false })}`
  );
  assert.doesNotMatch(formatRunLabel(runs[0]), /trace1|log1|wf1/);
  assert.doesNotMatch(formatRunLabel(runs[0]), new RegExp(new Date(captureTime).toLocaleString("zh-CN", { hour12: false })));
});

function traceRecord({ workflowId, spaceId, workflowName, logId, traceId, executeId, nodeName, timestamp, capturedAt }) {
  return normalizeCapture({
    method: "POST",
    url: `https://www.coze.cn/api/workflow_api/get_trace?log_id=${logId}`,
    pageUrl: `https://www.coze.cn/work_flow?workflow_id=${workflowId}&space_id=${spaceId}`,
    pageTitle: workflowName ? `${workflowName} - Coze` : undefined,
    workflowName,
    responseBody: JSON.stringify({
      code: 0,
      data: {
        workflow_name: workflowName,
        spans: [
          {
            span_id: `${traceId}-node`,
            log_id: logId,
            trace_id: traceId,
            type: "WorkflowCode",
            name: nodeName,
            status_code: 0,
            start_time: timestamp,
            tags: [
              tag("workflow_id", workflowId),
              tag("space_id", spaceId),
              tag("execute_id", executeId),
              tag("workflow_node_id", `${traceId}-node-id`),
              tag("node_name", nodeName),
            ],
          },
        ],
      },
    }),
    timestamp: capturedAt || timestamp,
  });
}

function tag(key, value) {
  return {
    key,
    tag_type: 0,
    value: { v_str: value },
  };
}
