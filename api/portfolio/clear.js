const {
  getManifest,
  parseRequestBody,
  saveManifest,
  sendJson,
  verifyPassword
} = require("../_lib/github");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "只支持 POST" });
  }

  try {
    const body = parseRequestBody(req);
    const collectionKey = String(body.collectionKey || "").trim();
    const password = String(body.password || "");
    const all = Boolean(body.all);
    const numbers = Array.isArray(body.numbers) ? body.numbers.map(value => String(value || "").trim().padStart(2, "0")) : [];

    if (!verifyPassword(password)) {
      return sendJson(res, 401, { error: "管理密码错误" });
    }
    if (!collectionKey) {
      return sendJson(res, 400, { error: "缺少 collectionKey" });
    }

    const manifestInfo = await getManifest();
    const nextItems = Object.assign({}, manifestInfo.data.collections[collectionKey] || {});

    if (all) {
      manifestInfo.data.collections[collectionKey] = {};
    } else {
      numbers.forEach(number => {
        if (number) delete nextItems[number];
      });
      manifestInfo.data.collections[collectionKey] = nextItems;
    }

    await saveManifest(manifestInfo, `clear portfolio images ${collectionKey}`);

    return sendJson(res, 200, {
      ok: true,
      items: manifestInfo.data.collections[collectionKey] || {}
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error && error.message ? error.message : "清除失败"
    });
  }
};
