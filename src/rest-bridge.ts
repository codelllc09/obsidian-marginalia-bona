import type MarginaliaPlugin from "./main";
import { connectLocalRestApi } from "./rest-bridge/types";
import type {
  RestApiHost,
  RouteResult,
  SubresourceHandler,
  VaultRouteContext
} from "./rest-bridge/types";
import { AnnotationsApi } from "./rest-bridge/annotations-api";

const SUBRESOURCE = "annotations";

function route(
  handle: (req: VaultRouteContext) => RouteResult | Promise<RouteResult>
): SubresourceHandler {
  return async (req, res) => {
    try {
      const result = await handle(req);
      if (result.body === undefined) res.status(result.status).end();
      else res.status(result.status).json(result.body);
    } catch (error) {
      res.status(500).json({
        errorCode: 50000,
        message: `Marginalia couldn't handle the request: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };
}

/** Mounts the annotations sub-resource on a running obsidian-local-rest-api
 *  plugin (extension API v3+). Optional integration: absent host = silent
 *  no-op. Reads and writes both live here - writes are the sanctioned path
 *  because the plugin builds the anchor and guarantees the format. */
export class RestBridge {
  private api: RestApiHost | null = null;

  constructor(private readonly plugin: MarginaliaPlugin) {}

  connect(): void {
    this.disconnect();
    const connection = connectLocalRestApi(
      {
        plugins: (this.plugin.app as unknown as {
          plugins?: Record<string, unknown>;
        }).plugins
      },
      this.plugin.manifest
    );
    // An old host version is quietly unsupported: routes stay unmounted.
    if (connection.kind !== "connected") return;
    this.api = connection.api;
    const api = new AnnotationsApi(this.plugin);
    const router = connection.api.addVaultSubresource(SUBRESOURCE);
    router.get("/", route((req) => api.list(req.vaultFile.path, req.query)));
    router.post("/", route((req) => api.create(req.vaultFile.path, req.body)));
    router.get("/:id", route((req) => api.get(req.vaultFile.path, req.params.id)));
    router.patch("/:id", route((req) =>
      api.patch(req.vaultFile.path, req.params.id, req.body)
    ));
    router.delete("/:id", route((req) => api.remove(req.vaultFile.path, req.params.id)));
    router.post("/:id/replies", route((req) =>
      api.addReply(req.vaultFile.path, req.params.id, req.body)
    ));
  }

  disconnect(): void {
    const api = this.api;
    this.api = null;
    try {
      api?.unregister();
    } catch {
      // The host plugin is gone with Obsidian; nothing to recover.
    }
  }
}
