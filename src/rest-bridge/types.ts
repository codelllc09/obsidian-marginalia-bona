/** Structural types for the obsidian-local-rest-api extension API (v3+).
 *  Deliberately duck-typed: the host plugin is an optional runtime
 *  dependency, never an import. */

export interface VaultRouteContext {
  vaultFile: { path: string };
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
}

export interface RouteResult {
  status: number;
  body?: unknown;
}

export type RouteHandler = (
  req: VaultRouteContext
) => Promise<RouteResult> | RouteResult;

/** Express-style middleware: the host passes (req, res) and the handler
 *  MUST send the response itself (returned values are ignored). */
export type SubresourceHandler = (
  req: VaultRouteContext,
  res: {
    status(code: number): { json(body: unknown): void; end(): void };
  }
) => Promise<void> | void;

export interface SubresourceRouter {
  get(path: string, handler: SubresourceHandler): void;
  post(path: string, handler: SubresourceHandler): void;
  patch(path: string, handler: SubresourceHandler): void;
  delete(path: string, handler: SubresourceHandler): void;
}

export interface RestApiHost {
  apiVersion?: number;
  addVaultSubresource(name: string): SubresourceRouter;
  unregister(): void;
}

interface RestApiHostPlugin {
  getPublicApi(manifest: unknown): RestApiHost;
}

function isHostPlugin(value: unknown): value is RestApiHostPlugin {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { getPublicApi?: unknown }).getPublicApi === "function"
  );
}

export type LocalRestApiConnection =
  | { kind: "connected"; api: RestApiHost }
  | { kind: "missing" }
  | { kind: "unsupported"; version: number };

/** Connect to a running Local REST API plugin (extension API v3+).
 *  Returns "missing" when it is not installed/enabled - the bridge is an
 *  optional integration and its absence is not an error. */
export function connectLocalRestApi(
  app: { plugins?: { plugins?: Record<string, unknown> } },
  manifest: unknown,
  requiredVersion = 3
): LocalRestApiConnection {
  const host = app.plugins?.plugins?.["obsidian-local-rest-api"];
  if (!isHostPlugin(host)) return { kind: "missing" };
  const api = host.getPublicApi(manifest);
  const version = typeof api?.apiVersion === "number" ? api.apiVersion : 1;
  if (version < requiredVersion) {
    api.unregister();
    return { kind: "unsupported", version };
  }
  return { kind: "connected", api };
}
