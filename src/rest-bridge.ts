import type MarginaliaPlugin from "./main";
import { connectLocalRestApi } from "./rest-bridge/types";
import type { RestApiHost } from "./rest-bridge/types";
import { AnnotationsApi } from "./rest-bridge/annotations-api";

const SUBRESOURCE = "annotations";

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
      { plugins: (this.plugin.app as unknown as { plugins?: Record<string, unknown> }).plugins },
      this.plugin.manifest
    );
    // An old host version is quietly unsupported: routes stay unmounted.
    if (connection.kind !== "connected") return;
    this.api = connection.api;
    const api = new AnnotationsApi(this.plugin);
    const router = connection.api.addVaultSubresource(SUBRESOURCE);
    router.get("/", (req) => api.list(req.vaultFile.path, req.query));
    router.post("/", (req) => api.create(req.vaultFile.path, req.body));
    router.get("/:id", (req) => api.get(req.vaultFile.path, req.params.id));
    router.patch("/:id", (req) =>
      api.patch(req.vaultFile.path, req.params.id, req.body)
    );
    router.delete("/:id", (req) => api.remove(req.vaultFile.path, req.params.id));
    router.post("/:id/replies", (req) =>
      api.addReply(req.vaultFile.path, req.params.id, req.body)
    );
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
