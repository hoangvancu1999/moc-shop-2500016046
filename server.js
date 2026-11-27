const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8123;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const ROUTE_MAP = {
  "/": "index.html",
  "/game-cung": "game-cung.html",
  "/game-cung/": "game-cung.html",
  "/admin": "admin.html",
  "/admin/": "admin.html"
};

http
  .createServer((req, res) => {
    const cleanUrl = decodeURIComponent((req.url || "/").split("?")[0]);
    const mappedFile = ROUTE_MAP[cleanUrl] || cleanUrl.replace(/^\/+/, "");
    const filePath = path.join(process.cwd(), mappedFile);

    // Chặn truy cập ra ngoài thư mục gốc hoặc các file cấu hình ẩn
    if (!filePath.startsWith(process.cwd()) || path.basename(filePath).startsWith(".")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
    }
  })
  .listen(PORT, () => {
    console.log(`HcuGaming server running at http://localhost:${PORT}`);
  });
