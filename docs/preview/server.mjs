// Tiny static-file server for screenshotting Passman page mockups.
// Serves the worktree root so relative links into packages/web/src/styles.css resolve.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

const server = http.createServer(async (req, res) => {
  try {
    let url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (url === "/") url = "/docs/preview/index.html";
    const filePath = normalize(join(ROOT, url));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`not found: ${req.url}\n${e instanceof Error ? e.message : ""}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`previews http://127.0.0.1:${PORT}/`);
});
