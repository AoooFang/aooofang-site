const {
  getManifest,
  sendJson
} = require("../_lib/github");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "只支持 GET" });
  }

  try {
    const collectionKey = String(req.query.collectionKey || "").trim();
    const manifestInfo = await getManifest();
    const items = collectionKey
      ? (manifestInfo.data.collections[collectionKey] || {})
      : manifestInfo.data.collections;

    return sendJson(res, 200, {
      ok: true,
      items
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error && error.message ? error.message : "读取线上作品失败"
    });
  }
};
