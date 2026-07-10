(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CozeDebuggerCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INTERESTING_ENDPOINTS = [
    "test_run",
    "stream_run_flow",
    "get_node_execute_history",
    "get_trace",
    "list_spans",
    "store_testrun_history",
    "get_execute_history_list",
    "run_histories",
    "execute_nodes",
  ];

  const SECRET_KEY_RE =
    /(api[_-]?(token|key)|access[_-]?token|refresh[_-]?token|csrf[_-]?token|(^|[_-])token($|[_-])|authorization|cookie|session([_-]?id)?|password|secret|credential|signature|x[-_]?tos[-_]?signature|x[-_]?tos[-_]?credential)/i;
  const FALLBACK_RUN_BUCKET_MS = 120000;
  const NODE_TYPE_LABELS = {
    VideoFrameExtractor: "视频抽帧",
  };

  function tryJson(value) {
    if (value == null || value === "") return undefined;
    if (typeof value === "object") return value;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return value;
    }
  }

  function asUrl(url) {
    try {
      return new URL(url, "https://www.coze.cn");
    } catch (_error) {
      return null;
    }
  }

  function getQueryValue(url, key) {
    const parsed = asUrl(url);
    return parsed ? parsed.searchParams.get(key) || undefined : undefined;
  }

  function findDeep(value, keys) {
    const wanted = new Set(keys);
    const seen = new Set();
    const stack = [value];
    let index = 0;
    while (index < stack.length) {
      const item = stack[index];
      index += 1;
      if (!item || typeof item !== "object" || seen.has(item)) continue;
      seen.add(item);
      for (const [key, child] of Object.entries(item)) {
        if (wanted.has(key) && child !== undefined && child !== null && child !== "") {
          return String(child);
        }
        if (child && typeof child === "object") stack.push(child);
      }
    }
    return undefined;
  }

  function endpointName(url) {
    const parsed = asUrl(url);
    if (!parsed) return "";
    const path = parsed.pathname;
    return (
      INTERESTING_ENDPOINTS.find((name) => path.includes(name)) ||
      path.split("/").filter(Boolean).pop() ||
      ""
    );
  }

  function isInterestingCozeRequest(url) {
    const parsed = asUrl(url);
    if (!parsed) return false;
    if (!/(^|\.)coze\.(cn|com)$/.test(parsed.hostname)) return false;
    return INTERESTING_ENDPOINTS.some((name) => parsed.pathname.includes(name));
  }

  function extractIds(input, parsedBodies) {
    const req = parsedBodies ? parsedBodies.request : tryJson(input.requestBody);
    const res = parsedBodies ? parsedBodies.response : tryJson(input.responseBody);
    const pageUrl = input.pageUrl || "";
    const url = input.url || "";
    const debugUrl =
      findDeep(res, ["debug_url", "debugUrl"]) ||
      findDeep(req, ["debug_url", "debugUrl"]) ||
      "";

    return {
      workflowId:
        getQueryValue(url, "workflow_id") ||
        getQueryValue(pageUrl, "workflow_id") ||
        getQueryValue(debugUrl, "workflow_id") ||
        findDeep(req, ["workflow_id", "workflowId"]) ||
        findDeep(res, ["workflow_id", "workflowId"]),
      spaceId:
        getQueryValue(url, "space_id") ||
        getQueryValue(pageUrl, "space_id") ||
        getQueryValue(debugUrl, "space_id") ||
        findDeep(req, ["space_id", "spaceId"]) ||
        findDeep(res, ["space_id", "spaceId"]),
      executeId:
        getQueryValue(url, "execute_id") ||
        getQueryValue(pageUrl, "execute_id") ||
        getQueryValue(debugUrl, "execute_id") ||
        findDeep(req, ["execute_id", "executeId"]) ||
        findDeep(res, ["execute_id", "executeId"]),
      nodeId:
        getQueryValue(url, "node_id") ||
        findDeep(req, ["node_id", "nodeId", "node_execute_uuid", "nodeExecuteUUID"]),
      nodeType:
        getQueryValue(url, "node_type") ||
        findDeep(req, ["node_type", "nodeType"]) ||
        findDeep(res, ["node_type", "nodeType"]),
      logId:
        getQueryValue(url, "log_id") ||
        findDeep(req, ["log_id", "logid", "logId"]) ||
        findDeep(res, ["log_id", "logid", "logId"]),
      traceId:
        getQueryValue(url, "trace_id") ||
        findDeep(req, ["trace_id", "traceId"]) ||
        findDeep(res, ["trace_id", "traceId"]),
      debugUrl,
      workflowName:
        cleanWorkflowName(input.workflowName) ||
        cleanWorkflowName(findDeep(req, ["workflow_name", "workflowName", "workflow_title", "workflowTitle"])) ||
        cleanWorkflowName(findDeep(res, ["workflow_name", "workflowName", "workflow_title", "workflowTitle"])) ||
        workflowNameFromPageTitle(input.pageTitle),
    };
  }

  function unwrapData(response) {
    const parsed = tryJson(response);
    if (!parsed || typeof parsed !== "object") return parsed;
    if (parsed.data && typeof parsed.data === "object") return parsed.data;
    return parsed;
  }

  function normalizeCapture(input) {
    const endpoint = endpointName(input.url || "");
    const rawResponse = tryJson(input.responseBody);
    const rawRequest = tryJson(input.requestBody);
    const ids = extractIds(input, { request: rawRequest, response: rawResponse });
    const data = unwrapData(rawResponse);
    const workflowName =
      ids.workflowName ||
      cleanWorkflowName(findDeep(data, ["workflow_name", "workflowName", "workflow_title", "workflowTitle"])) ||
      workflowNameFromTraceSpans(data?.spans);
    const startedAt = runStartedAtFromData(data) || runStartedAtFromTraceSpans(data?.spans);
    const base = {
      id: makeId(input),
      endpoint,
      method: input.method || "GET",
      url: input.url || "",
      pageUrl: input.pageUrl || "",
      workflowId: ids.workflowId,
      spaceId: ids.spaceId,
      executeId: ids.executeId,
      logId: ids.logId,
      traceId: ids.traceId,
      debugUrl: ids.debugUrl,
      workflowName,
      startedAt,
      timestamp: input.timestamp || Date.now(),
      rawRequest,
      rawResponse,
    };

    if (endpoint.includes("get_node_execute_history") || endpoint.includes("execute_nodes")) {
      return {
        ...base,
        kind: "node-history",
        executeId: data?.executeId || data?.execute_id || ids.executeId,
        nodeId: data?.nodeId || data?.node_id || ids.nodeId,
        nodeType: data?.NodeType || data?.node_type || ids.nodeType,
        nodeName:
          data?.NodeName ||
          data?.node_name ||
          data?.name ||
          data?.nodeId ||
          data?.node_id ||
          ids.nodeId ||
          "未命名节点",
        status:
          data?.status ||
          data?.execute_status ||
          data?.node_status ||
          data?.nodeStatus ||
          statusFromData(data),
        duration: data?.nodeExeCost || data?.execute_time || data?.duration || data?.cost,
        input: data?.input ?? data?.node_input ?? data?.inputs,
        output:
          data?.raw_output ??
          data?.output ??
          data?.node_output ??
          data?.outputs ??
          data?.NodeOutput,
        error: data?.errorInfo || data?.error || data?.error_info || data?.error_message,
        batchIndex: coerceNumber(data?.batch_index ?? getQueryValue(input.url || "", "batch_index")),
        subExecuteId: data?.sub_execute_id || getQueryValue(input.url || "", "sub_execute_id"),
      };
    }

    if (
      endpoint.includes("test_run") ||
      endpoint.includes("stream_run_flow") ||
      endpoint.includes("store_testrun_history") ||
      endpoint.includes("get_execute_history_list") ||
      endpoint.includes("run_histories")
    ) {
      return {
        ...base,
        kind: "workflow-run",
        status: statusFromData(data) === "unknown" ? statusFromData(rawResponse) : statusFromData(data),
        output: data?.output || data?.data,
        nodeExecuteStatus: data?.node_execute_status,
      };
    }

    return {
      ...base,
      kind: "trace",
      status: statusFromData(data),
      traceId: ids.traceId || traceIdFromSpans(data?.spans),
      logId: ids.logId || logIdFromSpans(data?.spans),
      executeId: ids.executeId || executeIdFromSpans(data?.spans),
      nodes: nodesFromTraceSpans(data?.spans, base),
      data,
    };
  }

  function traceIdFromSpans(spans) {
    return firstSpanValue(spans, "trace_id");
  }

  function logIdFromSpans(spans) {
    return firstSpanValue(spans, "log_id");
  }

  function executeIdFromSpans(spans) {
    return firstSpanValue(spans, "execute_id");
  }

  function workflowNameFromTraceSpans(spans) {
    if (!Array.isArray(spans)) return undefined;
    for (const span of spans) {
      if (!span || typeof span !== "object") continue;
      const spanType = tagValue(span, "span_type") || span.type || span.name || "";
      if (!/Workflow/i.test(spanType)) continue;
      if (/Callback|Status|Start|End|Plugin|Code|LLM|Tool/i.test(spanType)) continue;
      if (tagValue(span, "workflow_node_id")) continue;
      const name =
        tagValue(span, "workflow_name") ||
        span.workflow_name ||
        span.workflowName ||
        span.alias_name ||
        span.name;
      const cleaned = cleanWorkflowName(name);
      if (cleaned) return cleaned;
    }
    return undefined;
  }

  function runStartedAtFromTraceSpans(spans) {
    if (!Array.isArray(spans)) return undefined;
    const values = spans
      .map((span) => coerceTimestamp(span?.start_time || span?.startTime || tagValue(span, "start_time")))
      .filter(Boolean);
    return values.length ? Math.min(...values) : undefined;
  }

  function runStartedAtFromData(data) {
    if (!data || typeof data !== "object") return undefined;
    return coerceTimestamp(
      data.start_time ||
        data.startTime ||
        data.started_at ||
        data.startedAt ||
        data.create_time ||
        data.createTime ||
        data.created_at ||
        data.createdAt ||
        data.run_time ||
        data.runTime
    );
  }

  function firstSpanValue(spans, key) {
    if (!Array.isArray(spans)) return undefined;
    for (const span of spans) {
      const direct = span?.[key] || span?.[camelCase(key)];
      if (direct) return String(direct);
      const tagged = tagValue(span, key);
      if (tagged) return String(tagged);
    }
    return undefined;
  }

  function camelCase(value) {
    return String(value).replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
  }

  function tagValue(span, key) {
    if (!span || !Array.isArray(span.tags)) return undefined;
    const item = span.tags.find((tag) => tag && (tag.key === key || tag.key_alias === key));
    if (!item) return undefined;
    const value = item.value;
    if (!value || typeof value !== "object") return undefined;
    if (value.v_str !== undefined && value.v_str !== "") return String(value.v_str);
    if (value.v_long !== undefined && value.v_long !== "") return String(value.v_long);
    if (value.v_double !== undefined && value.v_double !== "") return String(value.v_double);
    return undefined;
  }

  function nodesFromTraceSpans(spans, base) {
    if (!Array.isArray(spans)) return [];
    return spans
      .filter(isNodeSpan)
      .map((span, index) => nodeFromTraceSpan(span, base, index))
      .filter(Boolean);
  }

  function isNodeSpan(span) {
    if (!span || typeof span !== "object") return false;
    const spanType = tagValue(span, "span_type") || span.type || span.name || "";
    if (/Workflow(Status|Start|End)?$|flow_span|WorkflowCallback/i.test(spanType)) {
      return Boolean(tagValue(span, "workflow_node_id"));
    }
    return Boolean(
      tagValue(span, "workflow_node_id") ||
        span.is_key_span ||
        span.input ||
        span.output ||
        tagValue(span, "node_name")
    );
  }

  function nodeFromTraceSpan(span, base, index) {
    const nodeId = tagValue(span, "workflow_node_id") || span.workflow_node_id || span.node_id;
    const spanType = tagValue(span, "span_type") || span.type || span.name || "TraceSpan";
    const rawNodeName =
      tagValue(span, "node_name") ||
      span.alias_name ||
      span.name ||
      tagValue(span, "span_name") ||
      nodeId ||
      spanType;
    const nodeName = cleanTraceNodeName(rawNodeName, spanType);
    return {
      kind: "trace-node",
      endpoint: base.endpoint,
      method: base.method,
      url: base.url,
      pageUrl: base.pageUrl,
      workflowId: base.workflowId || tagValue(span, "workflow_id"),
      spaceId: base.spaceId || tagValue(span, "space_id"),
      executeId: base.executeId || tagValue(span, "execute_id") || span.execute_id,
      logId: base.logId || span.log_id,
      traceId: base.traceId || span.trace_id,
      nodeId,
      nodeType: spanType,
      nodeName,
      spanId: span.span_id,
      parentSpanId: span.parent_id,
      status: statusFromSpan(span),
      duration: durationFromSpan(span),
      input: contentValue(span.input),
      output: contentValue(span.output),
      error: errorFromSpan(span),
      timestamp: span.start_time || base.timestamp,
      rawResponse: span,
      order: index + 1,
    };
  }

  function cleanTraceNodeName(value, spanType) {
    const text = cleanNodeLabel(value);
    if (!text) return "";
    const prefix = cleanNodeLabel(spanType);
    if (prefix && text.startsWith(prefix) && text.length > prefix.length) {
      return text.slice(prefix.length).trim();
    }
    return text;
  }

  function contentValue(value) {
    if (value && typeof value === "object" && "content" in value) {
      return tryJson(value.content);
    }
    return tryJson(value);
  }

  function statusFromSpan(span) {
    if (!span || typeof span !== "object") return "unknown";
    if (span.status_code === 0 || span.statusCode === 0) return "success";
    if (span.status_code || span.statusCode) return "fail";
    return statusFromData(span);
  }

  function durationFromSpan(span) {
    if (!span || typeof span !== "object") return undefined;
    const value = span.duration ?? tagValue(span, "duration");
    if (value === undefined || value === null || value === "") return undefined;
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    if (number >= 100000) return `${Math.round(number / 1000) / 1000}ms`;
    return `${number}ms`;
  }

  function errorFromSpan(span) {
    if (!span || typeof span !== "object") return undefined;
    return span.error || tagValue(span, "error") || tagValue(span, "error_msg") || tagValue(span, "errorInfo");
  }

  function statusFromData(data) {
    if (!data || typeof data !== "object") return "unknown";
    const raw = data.status || data.execute_status || data.msg || data.message;
    if (typeof raw === "string") {
      if (/success|成功/i.test(raw)) return "success";
      if (/fail|error|失败|异常/i.test(raw)) return "fail";
      if (/running|处理中/i.test(raw)) return "running";
      return raw;
    }
    if (data.code === 0 || data.error_code === "0") return "success";
    if (data.code || data.error_code) return "fail";
    return "unknown";
  }

  function coerceNumber(value) {
    if (value == null || value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function coerceTimestamp(value) {
    if (value == null || value === "") return undefined;
    if (typeof value === "string" && /[-/T:]/.test(value)) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return undefined;
    if (number < 10_000_000_000) return number * 1000;
    if (number > 10_000_000_000_000) return Math.floor(number / 1000);
    return number;
  }

  function cleanWorkflowName(value) {
    if (typeof value !== "string") return "";
    let text = value.replace(/\s+/g, " ").trim();
    if (!text) return "";
    text = text.replace(/^Workflow\s*/i, "").trim();
    text = text.replace(/\s*[-|｜]\s*(Coze|扣子).*$/i, "").trim();
    if (!text || /^(Coze|扣子|工作流|Workflow)$/i.test(text)) return "";
    if (/^\d{8,}$/.test(text)) return "";
    return text.length > 60 ? "" : text;
  }

  function workflowNameFromPageTitle(value) {
    const title = cleanWorkflowName(value);
    if (!title) return undefined;
    return title;
  }

  function makeId(input) {
    return [
      input.timestamp || Date.now(),
      endpointName(input.url || ""),
      Math.random().toString(36).slice(2, 9),
    ].join("-");
  }

  function redactSensitiveValue(value, parentKey) {
    if (value == null) return value;
    if (SECRET_KEY_RE.test(String(parentKey || ""))) return "[REDACTED]";
    if (typeof value === "string") return redactString(value);
    if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          redactSensitiveValue(child, key),
        ])
      );
    }
    return value;
  }

  function redactString(value) {
    if (/^(bearer|pat_|sk-|aklt|eyJ)/i.test(value.trim())) return "[REDACTED]";
    const parsed = asUrl(value);
    if (!parsed) return value;
    const hasSignedQuery = Array.from(parsed.searchParams.keys()).some((key) =>
      /signature|credential|token|authorization/i.test(key)
    );
    if (!hasSignedQuery) return value;
    return `${parsed.origin}${parsed.pathname}?[SIGNED_QUERY_REDACTED]`;
  }

  function stableJson(value, redact) {
    const finalValue = redact ? redactSensitiveValue(value) : value;
    if (finalValue === undefined) return "(未捕获)";
    if (typeof finalValue === "string") {
      const parsed = tryJson(finalValue);
      if (parsed !== finalValue) return JSON.stringify(parsed, null, 2);
      return finalValue;
    }
    return JSON.stringify(finalValue, null, 2);
  }

  function fingerprintRecord(record) {
    if (!record || typeof record !== "object") return String(record);
    const payload = {
      kind: record.kind,
      endpoint: record.endpoint,
      method: record.method,
      workflowId: record.workflowId,
      spaceId: record.spaceId,
      executeId: record.executeId,
      logId: record.logId,
      traceId: record.traceId,
      nodeId: record.nodeId,
      nodeName: record.nodeName,
      nodeType: record.nodeType,
      spanId: record.spanId,
      batchIndex: record.batchIndex,
      subExecuteId: record.subExecuteId,
      status: record.status,
      input: record.input,
      output: record.output,
      error: record.error,
      rawRequest: record.rawRequest,
      rawResponse: record.rawResponse,
    };
    return stableFingerprintJson(payload);
  }

  function limitRecords(records, options) {
    const opts = options || {};
    const maxRecords = Number.isFinite(opts.maxRecords) ? opts.maxRecords : Infinity;
    const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : Infinity;
    const source = Array.isArray(records) ? records : [];
    const selected = source.slice(-Math.max(0, maxRecords));
    const sizes = selected.map(recordSizeChars);
    let totalChars = sizes.reduce((sum, size) => sum + size, 0);
    let droppedCount = source.length - selected.length;

    while (selected.length && totalChars > maxChars) {
      totalChars -= sizes.shift();
      selected.shift();
      droppedCount += 1;
    }

    return { records: selected, totalChars, droppedCount };
  }

  function recordSizeChars(record) {
    try {
      return JSON.stringify(record).length;
    } catch (_error) {
      return 0;
    }
  }

  function stableFingerprintJson(value) {
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableFingerprintJson(item)).join(",")}]`;
    }
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableFingerprintJson(value[key])}`)
      .join(",")}}`;
  }

  function renderJsonHtml(value, redact) {
    return highlightJson(stableJson(value, redact));
  }

  function highlightJson(json) {
    return escapeHtml(json).replace(
      /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:))|("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (match, key, string, bool, nil, number) => {
        if (key) return `<span class="json-key">${key}</span>`;
        if (string) return `<span class="json-string">${string}</span>`;
        if (bool) return `<span class="json-boolean">${bool}</span>`;
        if (nil) return `<span class="json-null">${nil}</span>`;
        if (number) return `<span class="json-number">${number}</span>`;
        return match;
      }
    );
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildAiPrompt(run, nodes, options) {
    const opts = options || {};
    const ordered = [...(nodes || [])].sort((a, b) => {
      const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });

    const lines = [
      "请帮我排查下面这次 Coze/扣子工作流运行。",
      "",
      `工作流 ID: ${run?.workflowId || "(未知)"}`,
      `执行 ID: ${run?.executeId || "(未知)"}`,
      `Trace ID: ${run?.traceId || "(未知)"}`,
      `Log ID: ${run?.logId || "(未知)"}`,
      `捕获时间: ${formatDate(run?.capturedAt || run?.timestamp || Date.now())}`,
      "",
      "我希望你重点检查：",
      "1. 哪个节点最可能导致问题；",
      "2. 上游变量是否传错、类型是否不匹配；",
      "3. 应该怎么改节点配置或 JSON 结构。",
      "",
      "节点数据如下：",
    ];

    ordered.forEach((node, index) => {
      const status = node.status || "unknown";
      lines.push("");
      lines.push(`## 节点 ${index + 1}: ${node.nodeName || node.name || "未命名节点"}`);
      lines.push(`类型: ${node.nodeType || node.type || "(未知)"}`);
      lines.push(`状态: ${status}`);
      if (node.duration) lines.push(`耗时: ${node.duration}`);

      const iterations = Array.isArray(node.iterations) ? node.iterations : [];
      if (iterations.length) {
        lines.push(`批次数: ${iterations.length}`);
        iterations.forEach((iteration, iterationIndex) => {
          const iterationStatus = iteration.status || "unknown";
          lines.push("");
          lines.push(`### 批次 ${iterationIndex + 1}/${iterations.length}`);
          lines.push(`状态: ${iterationStatus}`);
          if (iteration.duration) lines.push(`耗时: ${iteration.duration}`);
          appendPromptValues(lines, iteration, iterationStatus, opts);
        });
        return;
      }

      appendPromptValues(lines, node, status, opts);
    });

    return lines.join("\n");
  }

  function appendPromptValues(lines, record, status, opts) {
      if (record.error || /fail|error|失败|异常/i.test(status)) {
        lines.push("错误信息:");
        lines.push("```json");
        lines.push(stableJson(record.error || record.rawResponse || "(未捕获)", opts.redact));
        lines.push("```");
      }
      lines.push("输入:");
      lines.push("```json");
      lines.push(stableJson(record.input, opts.redact));
      lines.push("```");
      lines.push("输出:");
      lines.push("```json");
      lines.push(stableJson(record.output, opts.redact));
      lines.push("```");
  }

  function formatDate(timestamp) {
    try {
      return new Date(timestamp).toISOString();
    } catch (_error) {
      return String(timestamp);
    }
  }

  function groupRecords(records, options) {
    const opts = options || {};
    const sorted = [...(records || [])].sort((a, b) => a.timestamp - b.timestamp);
    const traceKeyByExecuteId = traceKeysByExecuteId(sorted);
    const runs = new Map();
    const recordFingerprintsByRun = new Map();
    const nodeFingerprintsByRun = new Map();
    const nodesByRun = new Map();
    for (const record of sorted) {
      const key = runKeyForRecord(record, traceKeyByExecuteId);
      if (!runs.has(key)) {
        runs.set(key, {
          id: key,
          workflowId: record.workflowId,
          spaceId: record.spaceId,
          executeId: record.executeId,
          logId: record.logId,
          traceId: record.traceId,
          workflowName: record.workflowName,
          startedAt: record.startedAt,
          capturedAt: record.timestamp,
          records: [],
          nodes: [],
        });
        recordFingerprintsByRun.set(key, new Set());
        nodeFingerprintsByRun.set(key, new Set());
        nodesByRun.set(key, new Map());
      }
      const run = runs.get(key);
      run.workflowId = run.workflowId || record.workflowId;
      run.spaceId = run.spaceId || record.spaceId;
      run.executeId = run.executeId || record.executeId;
      run.logId = run.logId || record.logId;
      run.traceId = run.traceId || record.traceId;
      run.workflowName = preferValue(run.workflowName, record.workflowName, "");
      run.startedAt = preferTimestamp(run.startedAt, record.startedAt);
      const recordFingerprint = fingerprintRecord(record);
      if (!recordFingerprintsByRun.get(key).has(recordFingerprint)) {
        recordFingerprintsByRun.get(key).add(recordFingerprint);
        run.records.push(record);
      }
      if (record.kind === "trace" && Array.isArray(record.nodes)) {
        for (const nodeRecord of record.nodes) {
          addNodeToRun(run, key, nodeRecord, nodeFingerprintsByRun, nodesByRun, opts);
        }
      }
      if (record.kind === "node-history") {
        addNodeToRun(run, key, record, nodeFingerprintsByRun, nodesByRun, opts);
      }
    }
    for (const run of runs.values()) {
      if (run.traceId) run.id = `trace:${run.traceId}`;
      else if (run.logId) run.id = `log:${run.logId}`;
      else if (run.executeId) run.id = `execute:${run.executeId}`;
    }
    return Array.from(runs.values()).sort((a, b) => b.capturedAt - a.capturedAt);
  }

  function traceKeysByExecuteId(records) {
    const mapping = new Map();
    for (const record of records || []) {
      if (!record || record.kind !== "trace") continue;
      const key = runKeyForRecord(record, new Map());
      if (record.executeId) mapping.set(record.executeId, key);
      if (Array.isArray(record.nodes)) {
        for (const node of record.nodes) {
          if (node.executeId) mapping.set(node.executeId, key);
        }
      }
    }
    return mapping;
  }

  function runKeyForRecord(record, traceKeyByExecuteId) {
    if (record.traceId) return `trace:${record.traceId}`;
    if (record.logId) return `log:${record.logId}`;
    if (record.executeId && traceKeyByExecuteId && traceKeyByExecuteId.has(record.executeId)) {
      return traceKeyByExecuteId.get(record.executeId);
    }
    if (record.executeId) return `execute:${record.executeId}`;
    if (record.kind === "node-history" && (record.nodeId || record.nodeName)) {
      return [
        "node",
        record.workflowId || "unknown-workflow",
        record.spaceId || "unknown-space",
        record.nodeId || record.nodeName || "unknown-node",
        record.subExecuteId || record.batchIndex || timeBucket(record.timestamp),
      ].join(":");
    }
    return `${record.workflowId || "unknown"}-${timeBucket(record.timestamp)}`;
  }

  function timeBucket(timestamp) {
    const value = Number(timestamp || Date.now());
    return Math.floor(value / FALLBACK_RUN_BUCKET_MS);
  }

  function nodeIdentity(record, runKey) {
    return [
      runKey,
      record.spanId || "",
      record.nodeId || record.nodeName || "unknown-node",
      record.nodeType || "unknown-type",
      record.batchIndex ?? "",
      record.subExecuteId || "",
    ].join(":");
  }

  function addNodeToRun(run, key, record, nodeFingerprintsByRun, nodesByRun, opts) {
    const labelledRecord = applyNodeLabel(record, opts.nodeLabels);
    const nodeFingerprint = nodeIdentity(labelledRecord, key);
    if (!nodeFingerprintsByRun.get(key).has(nodeFingerprint)) {
      const equivalentFingerprint = findEquivalentNodeFingerprint(nodesByRun.get(key), labelledRecord);
      if (equivalentFingerprint) {
        mergeNode(nodesByRun.get(key).get(equivalentFingerprint), labelledRecord);
        return;
      }
      nodeFingerprintsByRun.get(key).add(nodeFingerprint);
      const node = { ...labelledRecord, order: run.nodes.length + 1 };
      nodesByRun.get(key).set(nodeFingerprint, node);
      run.nodes.push(node);
    } else {
      mergeNode(nodesByRun.get(key).get(nodeFingerprint), labelledRecord);
    }
  }

  function findEquivalentNodeFingerprint(nodes, record) {
    if (!nodes || !record || !record.nodeId) return undefined;
    for (const [fingerprint, node] of nodes.entries()) {
      if (node.nodeId !== record.nodeId) continue;
      if (node.executeId && record.executeId && node.executeId !== record.executeId) continue;
      return fingerprint;
    }
    return undefined;
  }

  function mergeNode(target, source) {
    if (!target) return;
    mergeNodeIterations(target, source);
    if (source.kind === "trace-node") target.kind = "trace-node";
    target.nodeName =
      source.kind === "trace-node"
        ? preferNodeName(source.nodeName, target.nodeName)
        : preferNodeName(target.nodeName, source.nodeName);
    target.spanId = target.spanId || source.spanId;
    target.traceId = target.traceId || source.traceId;
    target.logId = target.logId || source.logId;
    target.status = preferValue(target.status, source.status, "unknown");
    target.duration = target.duration || source.duration;
    target.input = target.input === undefined ? source.input : target.input;
    target.output = target.output === undefined ? source.output : target.output;
    target.error = target.error === undefined ? source.error : target.error;
    target.rawRequest = target.rawRequest === undefined ? source.rawRequest : target.rawRequest;
    target.rawResponse = mergeRawResponse(target.rawResponse, source.rawResponse);
  }

  function mergeNodeIterations(target, source) {
    const targetIsIteration = hasIterationIdentity(target);
    const sourceIsIteration = hasIterationIdentity(source);
    const isRepeatedTraceExecution =
      target?.kind === "trace-node" &&
      source?.kind === "trace-node" &&
      Boolean(target.spanId) &&
      Boolean(source.spanId) &&
      target.spanId !== source.spanId;
    if (
      !targetIsIteration &&
      !sourceIsIteration &&
      !isRepeatedTraceExecution &&
      !Array.isArray(target.iterations)
    ) {
      return;
    }

    const iterations = Array.isArray(target.iterations) ? target.iterations : [];
    if (targetIsIteration || isRepeatedTraceExecution) upsertIteration(iterations, target);
    if (sourceIsIteration || isRepeatedTraceExecution) upsertIteration(iterations, source);
    if (!iterations.length) return;

    target.iterations = iterations.sort((a, b) => {
      const ai = Number.isFinite(a.batchIndex) ? a.batchIndex : Number.MAX_SAFE_INTEGER;
      const bi = Number.isFinite(b.batchIndex) ? b.batchIndex : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      const subExecuteOrder = String(a.subExecuteId || "").localeCompare(String(b.subExecuteId || ""));
      if (subExecuteOrder) return subExecuteOrder;
      return (a.order || 0) - (b.order || 0);
    });
  }

  function hasIterationIdentity(record) {
    return Boolean(
      record &&
        (record.batchIndex !== undefined ||
          record.subExecuteId)
    );
  }

  function iterationKey(record) {
    if (record.subExecuteId) return `sub:${record.subExecuteId}`;
    if (record.batchIndex !== undefined) return `batch:${record.batchIndex}`;
    return `span:${record.spanId}`;
  }

  function upsertIteration(iterations, record) {
    const key = iterationKey(record);
    const existing = iterations.find((item) => item.id === key);
    if (!existing) {
      iterations.push({
        id: key,
        batchIndex: record.batchIndex,
        subExecuteId: record.subExecuteId,
        spanId: record.spanId,
        order: record.order,
        status: record.status,
        duration: record.duration,
        input: record.input,
        output: record.output,
        error: record.error,
        rawRequest: record.rawRequest,
        rawResponse: record.rawResponse,
      });
      return;
    }
    existing.status = preferValue(existing.status, record.status, "unknown");
    existing.duration = existing.duration || record.duration;
    existing.input = existing.input === undefined ? record.input : existing.input;
    existing.output = existing.output === undefined ? record.output : existing.output;
    existing.error = existing.error === undefined ? record.error : existing.error;
    existing.rawRequest = existing.rawRequest === undefined ? record.rawRequest : existing.rawRequest;
    existing.rawResponse = mergeRawResponse(existing.rawResponse, record.rawResponse);
  }

  function preferValue(current, next, emptyValue) {
    if (current === undefined || current === null || current === "" || current === emptyValue) {
      return next === undefined || next === null || next === "" ? current : next;
    }
    return current;
  }

  function preferTimestamp(current, next) {
    if (!current) return next;
    if (!next) return current;
    return Math.min(current, next);
  }

  function mergeRawResponse(current, next) {
    if (current === undefined) return next;
    if (next === undefined) return current;
    if (current && next && typeof current === "object" && typeof next === "object") {
      return { ...next, ...current };
    }
    return current;
  }

  function applyNodeLabel(record, nodeLabels) {
    const label = lookupNodeLabel(record, nodeLabels) || readableNodeTypeName(record.nodeType);
    if (!label) {
      return record;
    }
    return {
      ...record,
      nodeName: preferNodeName(label, record.nodeName),
    };
  }

  function lookupNodeLabel(record, nodeLabels) {
    if (!nodeLabels || !record) return undefined;
    const candidates = [
      nodeLabels[record.workflowId]?.[record.nodeId],
      nodeLabels[record.workflowId]?.[record.nodeName],
      nodeLabels[record.nodeId],
      nodeLabels[record.nodeName],
    ];
    return candidates
      .map((value) => cleanNodeLabel(value))
      .find((value) => isUsefulNodeName(value, record));
  }

  function preferNodeName(primary, fallback) {
    const cleanPrimary = cleanNodeLabel(primary);
    const cleanFallback = cleanNodeLabel(fallback);
    if (isUsefulNodeName(cleanPrimary)) return cleanPrimary;
    if (isUsefulNodeName(cleanFallback)) return cleanFallback;
    return primary || fallback;
  }

  function isUsefulNodeName(value, record) {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^\d+$/.test(trimmed)) return false;
    if (isExecutionResultLabel(trimmed)) return false;
    if (record && (trimmed === record.nodeId || trimmed === record.endpoint)) return false;
    return true;
  }

  function isExecutionResultLabel(value) {
    return /^(运行成功|运行失败|运行中|运行完成|执行成功|执行失败|成功|失败|输入|输出|错误信息|复制|运行|调试|节点)(\s*\d+(\.\d+)?\s*(ms|s|秒|毫秒))?$/i.test(value) ||
      /^\d+(\.\d+)?\s*(ms|s|秒|毫秒)$/i.test(value);
  }

  function sanitizeNodeLabels(labels) {
    if (!labels || typeof labels !== "object") return {};
    return Object.fromEntries(
      Object.entries(labels)
        .map(([nodeId, label]) => [nodeId, cleanNodeLabel(label)])
        .filter(([nodeId, label]) => nodeId && isUsefulNodeName(label, { nodeId }))
    );
  }

  function cleanNodeLabel(value) {
    if (typeof value !== "string") return "";
    let text = value.replace(/\s+/g, "").trim();
    if (!text) return "";
    text = text.replace(/^(运行成功|运行失败|运行中|运行完成|执行成功|执行失败|成功|失败)\d*(\.\d+)?(ms|s|秒|毫秒)?/i, "");
    const fieldIndex = firstPositiveIndex(
      text.indexOf("输入"),
      text.indexOf("输出"),
      text.indexOf("错误信息")
    );
    if (fieldIndex >= 0) text = text.slice(0, fieldIndex);
    return text.trim();
  }

  function firstPositiveIndex(...values) {
    const positives = values.filter((value) => value >= 0);
    return positives.length ? Math.min(...positives) : -1;
  }

  function readableNodeTypeName(nodeType) {
    if (!nodeType || typeof nodeType !== "string") return undefined;
    if (NODE_TYPE_LABELS[nodeType]) return NODE_TYPE_LABELS[nodeType];
    return undefined;
  }

  function summarizeRuns(runs) {
    const list = Array.isArray(runs) ? runs : [];
    return {
      runCount: list.length,
      nodeCount: list.reduce((sum, run) => sum + (run.nodes ? run.nodes.length : 0), 0),
    };
  }

  function statusBadgeClass(status) {
    const value = String(status || "unknown");
    if (/fail|error|失败|异常/i.test(value)) return "is-fail";
    if (/running|pending|处理中|运行中|等待/i.test(value)) return "is-running";
    if (/success|成功|ok|完成/i.test(value)) return "is-ok";
    return "is-unknown";
  }

  function formatRunLabel(run) {
    const name = cleanWorkflowName(run?.workflowName) || "未命名工作流";
    const timestamp = run?.startedAt || run?.capturedAt || run?.timestamp;
    const timeLabel = run?.startedAt ? "运行时间" : "捕获时间";
    if (!timestamp) return name;
    return `${name} / ${timeLabel} ${formatLocalDate(timestamp)}`;
  }

  function formatLocalDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return String(timestamp);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function focusRuns(runs, options) {
    const opts = options || {};
    const list = Array.isArray(runs) ? runs : [];
    const scoped = opts.workflowId
      ? list.filter((run) => run.workflowId === opts.workflowId)
      : list;
    const candidates = scoped.length ? scoped : list;
    if (!candidates.length) return [];
    const latest = [...candidates].sort((a, b) => {
      const bt = Number(b.capturedAt || b.timestamp || 0);
      const at = Number(a.capturedAt || a.timestamp || 0);
      if (bt !== at) return bt - at;
      return String(b.id || "").localeCompare(String(a.id || ""));
    })[0];
    return latest ? [latest] : [];
  }

  return {
    buildAiPrompt,
    formatRunLabel,
    focusRuns,
    fingerprintRecord,
    groupRecords,
    isInterestingCozeRequest,
    limitRecords,
    normalizeCapture,
    redactSensitiveValue,
    renderJsonHtml,
    sanitizeNodeLabels,
    stableJson,
    statusBadgeClass,
    summarizeRuns,
    tryJson,
  };
});
