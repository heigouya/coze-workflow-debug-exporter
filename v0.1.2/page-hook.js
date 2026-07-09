(function () {
  "use strict";

  if (window.__cozeWorkflowDebugExporterInstalled) return;
  window.__cozeWorkflowDebugExporterInstalled = true;

  const SOURCE = "coze-workflow-debug-exporter";
  const MAX_BODY_CHARS = 8_000_000;
  const ENDPOINT_RE =
    /\/api\/(workflow_api|op_workflow)\/(test_run|stream_run_flow|get_node_execute_history|get_trace|list_spans|store_testrun_history|get_execute_history_list)|\/v1\/workflows\/[^/]+\/run_histories/;

  function isInteresting(url) {
    try {
      const parsed = new URL(String(url), location.href);
      return /\.coze\.(cn|com)$/.test(parsed.hostname) && ENDPOINT_RE.test(parsed.pathname);
    } catch (_error) {
      return false;
    }
  }

  function truncate(text) {
    if (typeof text !== "string") return text;
    if (text.length <= MAX_BODY_CHARS) return text;
    return (
      text.slice(0, MAX_BODY_CHARS) +
      "\n\n[Coze Debug Exporter: response truncated in browser capture]"
    );
  }

  function emit(payload) {
    window.postMessage(
      {
        source: SOURCE,
        type: "NETWORK_CAPTURE",
        payload: {
          pageUrl: location.href,
          timestamp: Date.now(),
          ...payload,
        },
      },
      location.origin
    );
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return String(input || "");
  }

  function bodyFromFetchArgs(input, init) {
    if (init && init.body != null) return stringifyBody(init.body);
    if (input && typeof input.clone === "function") {
      return input
        .clone()
        .text()
        .catch(() => undefined);
    }
    return undefined;
  }

  function stringifyBody(body) {
    if (body == null) return undefined;
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
      const output = {};
      for (const [key, value] of body.entries()) {
        output[key] = typeof value === "string" ? value : `[File:${value.name || "unknown"}]`;
      }
      return JSON.stringify(output);
    }
    try {
      return JSON.stringify(body);
    } catch (_error) {
      return String(body);
    }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function patchedFetch(input, init) {
      const url = requestUrl(input);
      const method =
        (init && init.method) ||
        (input && typeof input.method === "string" && input.method) ||
        "GET";
      const requestBodyMaybe = bodyFromFetchArgs(input, init);
      const responsePromise = originalFetch.apply(this, arguments);

      if (isInteresting(url)) {
        responsePromise
          .then(async (response) => {
            const [requestBody, responseBody] = await Promise.all([
              Promise.resolve(requestBodyMaybe).catch(() => undefined),
              response
                .clone()
                .text()
                .then(truncate)
                .catch(() => undefined),
            ]);
            emit({
              transport: "fetch",
              method,
              url,
              statusCode: response.status,
              requestBody,
              responseBody,
            });
          })
          .catch((error) => {
            emit({
              transport: "fetch",
              method,
              url,
              error: String(error && error.message ? error.message : error),
            });
          });
      }

      return responsePromise;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__cozeDebugExporter = {
      method: method || "GET",
      url: String(url || ""),
    };
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    const meta = this.__cozeDebugExporter;
    if (meta && isInteresting(meta.url)) {
      meta.requestBody = stringifyBody(body);
      this.addEventListener("loadend", () => {
        emit({
          transport: "xhr",
          method: meta.method,
          url: meta.url,
          statusCode: this.status,
          requestBody: meta.requestBody,
          responseBody: truncate(this.responseText),
        });
      });
    }
    return originalSend.apply(this, arguments);
  };
})();
