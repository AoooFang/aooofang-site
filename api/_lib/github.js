const GITHUB_API = "https://api.github.com";

function readEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function getConfig() {
  return {
    owner: readEnv("GITHUB_REPO_OWNER"),
    repo: readEnv("GITHUB_REPO_NAME"),
    branch: readEnv("GITHUB_REPO_BRANCH", "main"),
    token: readEnv("GITHUB_TOKEN"),
    adminPassword: readEnv("PORTFOLIO_ADMIN_PASSWORD"),
    basePath: readEnv("PORTFOLIO_DATA_BASE_PATH", "portfolio-data")
  };
}

function ensureConfig() {
  const config = getConfig();
  const missing = ["owner", "repo", "token", "adminPassword"].filter(key => !config[key]);
  if (missing.length) {
    throw new Error(`缺少环境变量：${missing.join(", ")}`);
  }
  return config;
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function githubRequest(path, options = {}) {
  const config = ensureConfig();
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "User-Agent": "aooofang-portfolio-uploader",
      ...(options.headers || {})
    }
  });
  return response;
}

function normalizeManifest(value) {
  const manifest = value && typeof value === "object" ? value : {};
  if (!manifest.collections || typeof manifest.collections !== "object") {
    manifest.collections = {};
  }
  return manifest;
}

async function getContent(path) {
  const config = ensureConfig();
  const response = await githubRequest(`/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(config.branch)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`读取 GitHub 文件失败：${response.status}`);
  }
  const data = await response.json();
  const content = Buffer.from(data.content || "", "base64").toString("utf8");
  return {
    sha: data.sha,
    content,
    raw: data
  };
}

async function putFile(path, contentBase64, message, sha) {
  const config = ensureConfig();
  const response = await githubRequest(`/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: config.branch,
      ...(sha ? { sha } : {})
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`写入 GitHub 文件失败：${response.status} ${text}`);
  }

  return response.json();
}

async function getManifest() {
  const config = ensureConfig();
  const manifestPath = `${config.basePath}/manifest.json`;
  const existing = await getContent(manifestPath);
  if (!existing) {
    return {
      path: manifestPath,
      sha: "",
      data: normalizeManifest({ version: 1, collections: {} })
    };
  }

  return {
    path: manifestPath,
    sha: existing.sha,
    data: normalizeManifest(JSON.parse(existing.content || "{}"))
  };
}

async function saveManifest(manifestInfo, message) {
  const text = JSON.stringify(manifestInfo.data, null, 2);
  const contentBase64 = Buffer.from(text, "utf8").toString("base64");
  return putFile(manifestInfo.path, contentBase64, message, manifestInfo.sha || undefined);
}

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }
  return req.body;
}

function verifyPassword(password) {
  const config = ensureConfig();
  return String(password || "") === String(config.adminPassword || "");
}

function slugifyCollectionKey(collectionKey) {
  return String(collectionKey || "works")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "works";
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("图片数据格式无效");
  }

  const mimeType = match[1];
  const base64 = match[2];
  const extensionMap = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  const extension = extensionMap[mimeType] || "png";

  return {
    mimeType,
    base64,
    extension
  };
}

function buildImagePath(collectionKey, number, extension) {
  const config = ensureConfig();
  const slug = slugifyCollectionKey(collectionKey);
  const safeNumber = String(number || "01").padStart(2, "0");
  const stamp = Date.now();
  return `${config.basePath}/uploads/${slug}/${safeNumber}-${stamp}.${extension}`;
}

function buildRawUrl(path) {
  const config = ensureConfig();
  return `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${path}`;
}

module.exports = {
  buildImagePath,
  buildRawUrl,
  getManifest,
  parseDataUrl,
  parseRequestBody,
  saveManifest,
  sendJson,
  verifyPassword,
  putFile,
  ensureConfig
};
