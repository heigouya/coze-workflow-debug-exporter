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
    /(api[_-]?token|access[_-]?token|authorization|password|secret|credential|signature|x[-_]?tos[-_]?signature|x[-_]?tos[-_]?credential)/i;

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
    while (stack.length) {
      const item = stack.shift();
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

  function extractIds(input) {
    const req = tryJson(input.requestBody);
    const res = tryJson(input.responseBody);
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
      debugUrl,
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
    const ids = extractIds(input);
    const data = unwrapData(input.responseBody);
    const rawResponse = tryJson(input.responseBody);
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
      debugUrl: ids.debugUrl,
      timestamp: input.timestamp || Date.now(),
      rawRequest: tryJson(input.requestBody),
      rawResponse,
    };

    if (endpoint.includes("get_node_execute_history") || endpoint.includes("execute_nodes")) {
      return {
        ...base,
        kind: "node-history",
        nodeId: ids.nodeId,
        nodeType: data?.node_type || ids.nodeType,
        nodeName: data?.node_name || data?.name || ids.nodeId || "未命名节点",
        status: data?.status || data?.execute_status || data?.node_status || statusFromData(data),
        duration: data?.execute_time || data?.duration || data?.cost,
        input: data?.input ?? data?.node_input ?? data?.inputs,
        output: data?.output ?? data?.node_output ?? data?.outputs ?? data?.NodeOutput,
        error: data?.error ?? data?.error_info ?? data?.error_message,
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
      data,
    };
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
      nodeId: record.nodeId,
      nodeName: record.nodeName,
      nodeType: record.nodeType,
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
      if (node.error || /fail|error|失败|异常/i.test(status)) {
        lines.push("错误信息:");
        lines.push("```json");
        lines.push(stableJson(node.error || node.rawResponse || "(未捕获)", opts.redact));
        lines.push("```");
      }
      lines.push("输入:");
      lines.push("```json");
      lines.push(stableJson(node.input, opts.redact));
      lines.push("```");
      lines.push("输出:");
      lines.push("```json");
      lines.push(stableJson(node.output, opts.redact));
      lines.push("```");
    });

    return lines.join("\n");
  }

  function formatDate(timestamp) {
    try {
      return new Date(timestamp).toISOString();
    } catch (_error) {
      return String(timestamp);
    }
  }

  function groupRecords(records) {
    const sorted = [...(records || [])].sort((a, b) => a.timestamp - b.timestamp);
    const runs = new Map();
    const recordFingerprintsByRun = new Map();
    const nodeFingerprintsByRun = new Map();
    for (const record of sorted) {
      const key =
        record.executeId ||
        record.logId ||
        `${record.workflowId || "unknown"}-${record.timestamp || Date.now()}`;
      if (!runs.has(key)) {
        runs.set(key, {
          id: key,
          workflowId: record.workflowId,
          spaceId: record.spaceId,
          executeId: record.executeId,
          logId: record.logId,
          capturedAt: record.timestamp,
          records: [],
          nodes: [],
        });
        recordFingerprintsByRun.set(key, new Set());
        nodeFingerprintsByRun.set(key, new Set());
      }
      const run = runs.get(key);
      run.workflowId = run.workflowId || record.workflowId;
      run.spaceId = run.spaceId || record.spaceId;
      run.executeId = run.executeId || record.executeId;
      run.logId = run.logId || record.logId;
      const recordFingerprint = fingerprintRecord(record);
      if (!recordFingerprintsByRun.get(key).has(recordFingerprint)) {
        recordFingerprintsByRun.get(key).add(recordFingerprint);
        run.records.push(record);
      }
      if (record.kind === "node-history") {
        const nodeFingerprint = fingerprintRecord({
          ...record,
          timestamp: undefined,
          id: undefined,
        });
        if (!nodeFingerprintsByRun.get(key).has(nodeFingerprint)) {
          nodeFingerprintsByRun.get(key).add(nodeFingerprint);
          run.nodes.push({ ...record, order: run.nodes.length + 1 });
        }
      }
    }
    return Array.from(runs.values()).sort((a, b) => b.capturedAt - a.capturedAt);
  }

  return {
    buildAiPrompt,
    fingerprintRecord,
    groupRecords,
    isInterestingCozeRequest,
    normalizeCapture,
    redactSensitiveValue,
    renderJsonHtml,
    stableJson,
    tryJson,
  };
});
