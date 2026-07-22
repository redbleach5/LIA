// ============================================================================
// Runtime health probes — TCP + HTTP (pure enough for unit tests with injected fetch).
// ============================================================================

export type HttpProbeResult = {
  ok: boolean;
  status?: number;
  error?: string;
};

/**
 * Poll GET until 2xx/3xx or timeout.
 * 404 = server up but wrong root → not ok (forces correct index.html layout).
 */
export async function probeHttpUrl(
  url: string,
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<HttpProbeResult> {
  const timeoutMs = opts?.timeoutMs ?? 25_000;
  const pollMs = opts?.pollMs ?? 400;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let lastError = 'timeout';

  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(Math.min(2000, Math.max(500, deadline - Date.now()))),
      });
      if (res.status >= 200 && res.status < 400) {
        return { ok: true, status: res.status };
      }
      lastError = `HTTP ${res.status}`;
      // 404/5xx while server responds — keep polling briefly (serve may still be binding)
      if (res.status === 404) {
        lastError = 'HTTP 404 — нет index.html в корне preview (нужны index.html/style.css/script.js в корне)';
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return { ok: false, error: lastError };
}
