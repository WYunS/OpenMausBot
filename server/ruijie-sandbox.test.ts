import { describe, expect, it } from "vitest";

import type { AppConfig } from "./config.ts";
import {
  disconnectRuijieSandbox,
  joinRuijieSandbox,
  provisionRuijieSandbox,
  readyRuijieSandboxForTurn,
  releaseRuijieSandbox,
  ruijieCuaBridgeAccess,
  ruijieCuaBridgeReady,
  ruijieSandboxConfigured,
  ruijieSandboxStatus,
} from "./ruijie-sandbox.ts";

const config = (request: Record<string, unknown> = {}): AppConfig => ({
  ruijieSandbox: {
    managerUrl: "http://172.24.37.150:12581",
    requestJson: JSON.stringify({
      client_id: "client-1",
      vnc_key: "viewer-secret",
      minio_url: "http://minio.internal:9100",
      image: "registry.internal/desktop:latest",
      ...request,
    }),
  },
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Ruijie sandbox adapter", () => {
  it('shared installation attaches to a ready desktop but never submits a replacement', async () => {
    const attached = config({ attach_only: true });
    const calls: string[] = [];
    const readyFetch = async (url: string | URL | Request) => {
      calls.push(String(url));
      return response({ task_id: 'client-1', status: 'finished', vnc_proxy: 'http://viewer.internal/vnc.html' });
    };
    expect((await readyRuijieSandboxForTurn(attached, readyFetch as typeof fetch)).ready).toBe(true);
    await expect(provisionRuijieSandbox(attached, readyFetch as typeof fetch)).rejects.toThrow('existing shared sandbox only');
    const missingFetch = async (url: string | URL | Request) => { calls.push(String(url)); return response({}, 404); };
    await expect(readyRuijieSandboxForTurn(attached, missingFetch as typeof fetch)).rejects.toThrow('administrator');
    expect(calls.every((url) => url.endsWith('/task/client-1'))).toBe(true);
  });

  it("requires the manager URL and complete request template", () => {
    expect(ruijieSandboxConfigured(config())).toBe(true);
    expect(ruijieSandboxConfigured({ ruijieSandbox: { managerUrl: "http://manager", requestJson: "{}" } })).toBe(false);
  });

  it("derives authenticated CUA bridge access without exposing the viewer secret", async () => {
    const access = ruijieCuaBridgeAccess(config(), "http://172.24.37.151:11095/sandboxes/client-1/proxy/6080/vnc.html");
    expect(access?.baseUrl).toBe("http://172.24.37.151:11095/sandboxes/client-1/proxy/18765");
    expect(access?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(access?.token).not.toContain("viewer-secret");

    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({ authorization: `Bearer ${access?.token}` });
      return response({ ok: true });
    };
    await expect(ruijieCuaBridgeReady(access!, fetchImpl as typeof fetch)).resolves.toBe(true);
  });

  it("submits the provider template while forcing the persistent sandbox contract", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return response({ task_id: "client-1", status: "queued", vnc_proxy: null });
    };
    const result = await provisionRuijieSandbox(config({ priority: 10, never_reclaim: false }), fetchImpl as typeof fetch);
    expect(result.status).toBe("queued");
    expect(calls[0]?.url).toBe("http://172.24.37.150:12581/submit");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      client_id: "client-1",
      vnc_key: "viewer-secret",
      priority: 10,
      never_reclaim: true,
    });
  });

  it("omits the captured null xiaobing password rejected by the manager schema", async () => {
    let submitted: Record<string, unknown> = {};
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      submitted = JSON.parse(String(init?.body));
      return response({ task_id: "client-1", status: "queued", vnc_proxy: null });
    };

    await provisionRuijieSandbox(config({ xiaobing_pswd: null }), fetchImpl as typeof fetch);

    expect(submitted).not.toHaveProperty("xiaobing_pswd");
  });

  it("maps a finished task and returns an autoconnecting VNC viewer", async () => {
    const fetchImpl = async () => response({
      task_id: "client-1",
      status: "finished",
      vnc_proxy: "http://172.24.37.150:11095/sandboxes/id/proxy/6080/vnc.html?host=172.24.37.150&port=11095",
    });
    const status = await ruijieSandboxStatus(config(), fetchImpl as typeof fetch);
    expect(status.ready).toBe(true);
    const joined = await joinRuijieSandbox(config(), fetchImpl as typeof fetch);
    const url = new URL(joined.joinUrl);
    expect(url.hash).toContain("autoconnect=true");
    expect(url.hash).toContain("password=viewer-secret");
  });

  it("submits a missing pooled sandbox and waits for its VNC endpoint", async () => {
    let statusChecks = 0;
    let submitted = 0;
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).endsWith("/submit")) {
        submitted += 1;
        return response({ task_id: "client-1", status: "queued", vnc_proxy: null });
      }
      statusChecks += 1;
      if (statusChecks === 1) return response({}, 404);
      return response({ task_id: "client-1", status: "finished", vnc_proxy: "http://172.24.37.150:11095/vnc.html" });
    };

    const ready = await readyRuijieSandboxForTurn(config(), fetchImpl as typeof fetch, { timeoutMs: 1_000, pollMs: 50 });

    expect(submitted).toBe(1);
    expect(ready.ready).toBe(true);
  });

  it("explains manager timeouts instead of exposing an AbortError", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const fetchImpl = async () => { throw timeout; };

    const status = await ruijieSandboxStatus(config(), fetchImpl as unknown as typeof fetch);

    expect(status.status).toBe("unreachable");
    expect(status.problem).toContain("Could not reach the Ruijie sandbox manager");
    expect(status.problem).toContain("network/VPN");
    expect(status.problem).not.toContain("operation was aborted");
  });

  it("releases the configured client id", async () => {
    let body: unknown;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return response({ status: "ok" });
    };
    await expect(releaseRuijieSandbox(config(), fetchImpl as typeof fetch)).resolves.toEqual({ ok: true });
    expect(body).toEqual({ client_id: "client-1" });
  });

  it("disconnects locally without calling the provider release endpoint", () => {
    expect(disconnectRuijieSandbox(config())).toEqual({ closed: true, released: false });
  });
});
