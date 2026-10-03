import { describe, expect, it } from "bun:test";
import { findIconUrls, isAllowedIconUrl } from "./icon-links";

describe("findIconUrls", () => {
  it("prefers apple-touch-icon and resolves relative links", () => {
    const html = `<head>
      <link rel="icon" href="/favicon-32.png">
      <link rel='apple-touch-icon' sizes="180x180" href="/static/touch.png">
      <link rel="stylesheet" href="/x.css">
    </head>`;
    expect(findIconUrls(html, "https://www.example.org/start")).toEqual([
      "https://www.example.org/static/touch.png",
      "https://www.example.org/favicon-32.png",
    ]);
  });

  it("handles 'shortcut icon', protocol-relative links and unquoted values", () => {
    const html = `<link href=//cdn.example.net/fav.ico rel="shortcut icon">`;
    expect(findIconUrls(html, "https://example.org/")).toEqual(["https://cdn.example.net/fav.ico"]);
  });

  it("skips svg, data: and non-http links", () => {
    const html = `<link rel="icon" href="/logo.svg"><link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="javascript:alert(1)">`;
    expect(findIconUrls(html, "https://example.org/")).toEqual([]);
  });

  it("returns nothing for pages without icon links", () => {
    expect(findIconUrls("<html><body>hi</body></html>", "https://example.org/")).toEqual([]);
  });
});

describe("isAllowedIconUrl", () => {
  it("allows public hosts and the site's own host", () => {
    expect(isAllowedIconUrl("https://cdn.example.net/i.png", "example.org")).toBe(true);
    expect(isAllowedIconUrl("https://8.8.8.8/i.png", "example.org")).toBe(true);
    expect(isAllowedIconUrl("http://intranet.local/i.png", "intranet.local")).toBe(true);
  });

  it("refuses local-network and odd addresses", () => {
    for (const url of [
      "http://192.168.1.1/x.png",
      "http://10.0.0.5/x.png",
      "http://172.20.1.1/x.png",
      "http://127.0.0.1:47831/x",
      "http://169.254.169.254/latest",
      "http://localhost/x.png",
      "http://router/x.png",
      "http://printer.local/x.png",
      "http://[::1]/x.png",
      "file:///C:/x.png",
    ]) {
      expect(isAllowedIconUrl(url, "example.org")).toBe(false);
    }
  });
});
