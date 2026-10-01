import { describe, expect, it } from "bun:test";
import { buildBrowserPolicy } from "./browser-policy";
import { Policy, SiteEntry } from "./policy";
import { isIPv4, validateSitePattern } from "./site-pattern";

const valid = (pattern: string) => {
  const result = validateSitePattern(pattern);
  return result.ok ? result.value : null;
};

describe("validateSitePattern", () => {
  it("accepts hosts, schemes, exact hosts, ports and paths", () => {
    expect(valid("khanacademy.org")).toBe("khanacademy.org");
    expect(valid("HTTPS://Example.ORG/Docs")).toBe("https://example.org/Docs");
    expect(valid(".exact.example.org")).toBe(".exact.example.org");
    expect(valid("intranet.local:8080/path")).toBe("intranet.local:8080/path");
    expect(valid("192.168.1.20")).toBe("192.168.1.20");
  });

  it("rejects wildcards, empty and too-broad patterns", () => {
    for (const bad of ["*", "", "   ", "*.example.org", "example.*", "com", ".com", "localhost"]) {
      expect(valid(bad)).toBeNull();
    }
  });

  it("rejects dangerous schemes", () => {
    for (const bad of ["javascript:alert(1)", "file:///C:/", "data:text/html,hi", "ftp://example.org"]) {
      expect(valid(bad)).toBeNull();
    }
  });

  it("rejects bad ports and hosts", () => {
    for (const bad of ["example.org:0", "example.org:99999", "exa_mple.org", "-bad.org", "1.2.3.999"]) {
      expect(valid(bad)).toBeNull();
    }
  });
});

describe("isIPv4", () => {
  it("checks four numbers 0-255 without leading zeros", () => {
    expect(isIPv4("10.0.0.1")).toBe(true);
    expect(isIPv4("256.1.1.1")).toBe(false);
    expect(isIPv4("01.1.1.1")).toBe(false);
    expect(isIPv4("1.1.1")).toBe(false);
  });
});

describe("Policy schema and buildBrowserPolicy", () => {
  it("normalizes site patterns while parsing", () => {
    const site = SiteEntry.parse({ id: "ex", name: "Example", pattern: "HTTPS://EXAMPLE.org" });
    expect(site.pattern).toBe("https://example.org");
  });

  it("rejects duplicate ids", () => {
    const sites = [
      { id: "a", name: "A", pattern: "a.org" },
      { id: "a", name: "B", pattern: "b.org" },
    ];
    expect(Policy.safeParse({ version: 1, apps: [], sites }).success).toBe(false);
  });

  it("blocks everything and allows only the listed sites", () => {
    const policy = Policy.parse({
      version: 1,
      apps: [],
      sites: [
        { id: "a", name: "A", pattern: "a.org" },
        { id: "b", name: "B", pattern: "a.org" },
      ],
    });
    const edge = buildBrowserPolicy(policy.sites);
    expect(edge.lists.URLBlocklist).toEqual(["*"]);
    expect(edge.lists.URLAllowlist).toEqual(["a.org"]);
    expect(edge.dwords.InPrivateModeAvailability).toBe(1);
    expect(edge.dwords.DeveloperToolsAvailability).toBe(2);
  });
});
