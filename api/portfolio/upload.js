const {
  buildImagePath,
  buildPublicImageUrl,
  getManifest,
  normalizeItemsForPublic,
  parseDataUrl,
  parseRequestBody,
  saveManifest,
  sendJson,
  verifyPassword,
  putFile
} = require("../_lib/github");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "只支持 POST" });
  }

  try {
    const body = parseRequestBody(req);
    const collectionKey = String(body.collectionKey || "").trim();
    const password = String(body.password || "");
    const items = Array.isArray(body.items) ? body.items : [];

    if (!verifyPassword(password)) {
      return sendJson(res, 401, { error: "管理密码错误" });
    }
    if (!collectionKey) {
      return sendJson(res, 400, { error: "缺少 collectionKey" });
    }
    if (!items.length) {
      return sendJson(res, 400, { error: "没有要上传的图片" });
    }

    const manifestInfo = await getManifest();
    const nextItems = Object.assign({}, manifestInfo.data.collections[collectionKey] || {});

    for (const item of items) {
      const number = String(item.number || "").trim().padStart(2, "0");
      const dataUrl = String(item.dataUrl || "");
      if (!number || !dataUrl) continue;

      const parsed = parseDataUrl(dataUrl);
      const imagePath = buildImagePath(collectionKey, number, parsed.extension);
      await putFile(
        imagePath,
        parsed.base64,
        `upload portfolio image ${collectionKey} #${number}`
      );

      nextItems[number] = {
        url: buildPublicImageUrl(req, imagePath),
        path: imagePath,
        updatedAt: new Date().toISOString()
      };
    }

    manifestInfo.data.collections[collectionKey] = nextItems;
    await saveManifest(manifestInfo, `update portfolio manifest ${collectionKey}`);

    return sendJson(res, 200, {
      ok: true,
      items: normalizeItemsForPublic(req, nextItems)
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error && error.message ? error.message : "上传失败"
    });
  }
};
