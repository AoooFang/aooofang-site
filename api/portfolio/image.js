const {
  getBinaryContent
} = require("../_lib/github");

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function guessContentType(path) {
  const lower = String(path || "").toLowerCase();
  const matched = Object.keys(CONTENT_TYPES).find(ext => lower.endsWith(ext));
  return matched ? CONTENT_TYPES[matched] : "application/octet-stream";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "只支持 GET" });
    return;
  }

  try {
    const path = String(req.query.path || "").trim();
    if (!path) {
      res.status(400).json({ error: "缺少 path" });
      return;
    }

    const file = await getBinaryContent(path);
    if (!file) {
      res.status(404).json({ error: "图片不存在" });
      return;
    }

    res.setHeader("Content-Type", guessContentType(path));
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).end(file.buffer);
  } catch (error) {
    res.status(500).json({
      error: error && error.message ? error.message : "读取图片失败"
    });
  }
};
