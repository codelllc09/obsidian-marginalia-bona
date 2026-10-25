import { describe, expect, it } from "vitest";
import {
  clearDiagnostics,
  diagnosticsReport,
  logEvent,
  recentEvents,
  reportError,
  setSnapshotProvider
} from "../src/diagnostics";

describe("diagnostics", () => {
  it("records events newest last and keeps the report greppable", () => {
    clearDiagnostics();
    setSnapshotProvider(() => ({ activeMode: "preview", cards: 0 }));
    logEvent("info", "reading", "no-gutter", { available: 0 });
    reportError("reading-margins", new Error("boom"), { source: "Note.md" });

    const events = recentEvents();
    expect(events.map((event) => event.level)).toEqual(["info", "error"]);

    const report = diagnosticsReport("9.9.9");
    expect(report).toContain("plugin: 9.9.9");
    expect(report).toContain("activeMode: preview");
    expect(report).toContain("no-gutter");
    expect(report).toContain("Error: boom");
    expect(report).toContain("Note.md");
  });

  it("keeps a bounded buffer", () => {
    clearDiagnostics();
    for (let index = 0; index < 400; index += 1) {
      logEvent("info", "test", `event ${index}`);
    }
    const events = recentEvents(1000);
    expect(events.length).toBeLessThanOrEqual(240);
    expect(events[events.length - 1]?.message).toBe("event 399");
  });

  it("survives a snapshot provider that throws", () => {
    clearDiagnostics();
    setSnapshotProvider(() => {
      throw new Error("snapshot failed");
    });
    expect(diagnosticsReport("1.0.0")).toContain("snapshot: failed");
  });
});
