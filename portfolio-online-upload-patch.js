(function () {
  const API_ENDPOINTS = {
    list: "/api/portfolio/list",
    upload: "/api/portfolio/upload",
    clear: "/api/portfolio/clear"
  };

  const ADMIN_PASSWORD_SESSION_KEY = "aooofang_portfolio_upload_admin_password_remote";
  const remoteUploadsCache = window.__aooofangRemoteUploadsCache || (window.__aooofangRemoteUploadsCache = Object.create(null));
  const remoteLoadState = window.__aooofangRemoteUploadsLoadState || (window.__aooofangRemoteUploadsLoadState = Object.create(null));

  function getRemoteBucket(collectionKey = currentAigcCollectionKey) {
    return remoteUploadsCache[collectionKey] || {};
  }

  function setRemoteBucket(collectionKey, items) {
    remoteUploadsCache[collectionKey] = Object.assign({}, items || {});
    remoteLoadState[collectionKey] = true;
  }

  function setUploadNoteText() {
    const note = document.querySelector(".aigc-upload-note");
    if (note) {
      note.textContent = "旧作品图片目前不在项目里；如果你要重新补全整套作品，请先选中 01，再点“批量上传（推荐）”，一次选择多张图片，系统会按编号顺序依次写入并保存到线上共享存储。";
    }
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error ? data.error : "请求失败";
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function loadRemoteUploadsForCollection(collectionKey, force) {
    if (!collectionKey) return {};
    if (!force && remoteLoadState[collectionKey]) return getRemoteBucket(collectionKey);
    try {
      const data = await requestJson(`${API_ENDPOINTS.list}?collectionKey=${encodeURIComponent(collectionKey)}`);
      setRemoteBucket(collectionKey, data.items || {});
      return getRemoteBucket(collectionKey);
    } catch (error) {
      remoteLoadState[collectionKey] = false;
      console.error("[portfolio] load remote uploads failed:", error);
      return getRemoteBucket(collectionKey);
    }
  }

  function getStoredUploadedImage(number) {
    const bucket = getRemoteBucket();
    const value = bucket[number];
    if (!value) return "";
    return typeof value === "string" ? value : (value.url || "");
  }

  function getUploadedImage(number) {
    const remoteImage = getStoredUploadedImage(number);
    if (remoteImage) return remoteImage;
    const staticCandidates = getPortfolioStaticImageCandidates(number);
    return staticCandidates[0] || "";
  }

  function getUploadedImageBackground(number, dataUrl = getUploadedImage(number)) {
    const remoteImage = getStoredUploadedImage(number);
    if (remoteImage) return `url("${escapeCssUrl(remoteImage)}")`;

    const staticCandidates = getPortfolioStaticImageCandidates(number);
    if (staticCandidates.length) {
      return staticCandidates.map(candidate => `url("${escapeCssUrl(candidate)}")`).join(", ");
    }

    return dataUrl ? `url("${escapeCssUrl(dataUrl)}")` : "";
  }

  function getAigcUploadAdminPassword() {
    try {
      return sessionStorage.getItem(ADMIN_PASSWORD_SESSION_KEY) || "";
    } catch (error) {
      return window.__aigcUploadAdminPassword || "";
    }
  }

  function setAigcUploadAdminPassword(value) {
    const text = String(value || "").trim();
    try {
      if (text) {
        sessionStorage.setItem(ADMIN_PASSWORD_SESSION_KEY, text);
      } else {
        sessionStorage.removeItem(ADMIN_PASSWORD_SESSION_KEY);
      }
    } catch (error) {
      window.__aigcUploadAdminPassword = text;
    }
    setAigcUploadAdminVerified(Boolean(text));
  }

  function requestAigcUploadPassword() {
    if (getAigcUploadAdminPassword()) {
      setAigcUploadAdminVerified(true);
      return true;
    }

    const input = window.prompt("请输入作品图片上传管理密码：");
    if (input === null) {
      setAigcUploadStatus("已取消密码验证。");
      return false;
    }

    const password = String(input).trim();
    if (!password) {
      setAigcUploadStatus("未输入密码，无法上传图片。");
      return false;
    }

    setAigcUploadAdminPassword(password);
    setAigcUploadStatus("密码已记录，正在使用线上共享存储。");
    return true;
  }

  async function saveUploadFiles(files) {
    if (!requestAigcUploadPassword()) {
      if (aigcUploadFileInput) aigcUploadFileInput.value = "";
      return;
    }

    const fileList = Array.from(files || []).filter(file => file && file.type && file.type.startsWith("image/"));
    if (!fileList.length) {
      setAigcUploadStatus("没有选择有效的图片文件。");
      return;
    }

    const items = (currentAigcCollection && currentAigcCollection.items) || [];
    const total = getAigcSlotTotal(items);
    const startIndex = Math.max(0, (parseInt(currentAigcUploadTargetNumber, 10) || 1) - 1);
    const targets = aigcPendingUploadMode === "batch"
      ? fileList.map((_, i) => startIndex + i).filter(index => index < total)
      : [startIndex];

    if (!targets.length) {
      setAigcUploadStatus("当前编号后没有可上传的位置。");
      return;
    }

    setAigcUploadStatus("正在上传到线上共享存储……");

    const payloadItems = [];
    for (let i = 0; i < targets.length; i += 1) {
      const number = String(targets[i] + 1).padStart(2, "0");
      const file = fileList[aigcPendingUploadMode === "batch" ? i : 0];
      if (!file) continue;
      const dataUrl = await readUploadImageFile(file);
      payloadItems.push({
        number,
        dataUrl,
        fileName: file.name || `portfolio-${number}`
      });
    }

    try {
      const result = await requestJson(API_ENDPOINTS.upload, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey: currentAigcCollectionKey,
          password: getAigcUploadAdminPassword(),
          items: payloadItems
        })
      });

      setRemoteBucket(currentAigcCollectionKey, result.items || {});
      const lastSavedNumber = payloadItems[payloadItems.length - 1]?.number || currentAigcUploadTargetNumber || "01";
      await loadRemoteUploadsForCollection(currentAigcCollectionKey, true);
      renderAigcCollection(currentAigcCollectionSource, {
        preserveUploadAdmin: true,
        selectedNumber: lastSavedNumber
      });
      updateAigcUploadAdminSelection(lastSavedNumber);
      setAigcUploadStatus(`已上传 ${payloadItems.length} 张图片，所有访问者现在都能看到。`);
    } catch (error) {
      if (error && error.status === 401) {
        setAigcUploadAdminPassword("");
      }
      setAigcUploadStatus(error && error.message ? error.message : "线上上传失败");
    } finally {
      if (aigcUploadFileInput) aigcUploadFileInput.value = "";
    }
  }

  async function clearCurrentUploadedImage() {
    if (!requestAigcUploadPassword()) return;
    const number = currentAigcUploadTargetNumber || "01";

    try {
      const result = await requestJson(API_ENDPOINTS.clear, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey: currentAigcCollectionKey,
          password: getAigcUploadAdminPassword(),
          numbers: [number]
        })
      });
      setRemoteBucket(currentAigcCollectionKey, result.items || {});
      await loadRemoteUploadsForCollection(currentAigcCollectionKey, true);
      renderAigcCollection(currentAigcCollectionSource, {
        preserveUploadAdmin: true,
        selectedNumber: number
      });
      updateAigcUploadAdminSelection(number);
      setAigcUploadStatus(`已清除第 ${number} 张线上图片。`);
    } catch (error) {
      if (error && error.status === 401) {
        setAigcUploadAdminPassword("");
      }
      setAigcUploadStatus(error && error.message ? error.message : "清除失败");
    }
  }

  async function clearAllUploadedImages() {
    if (!requestAigcUploadPassword()) return;
    const ok = window.confirm("确定清除当前作品窗口内已上传的全部线上图片吗？");
    if (!ok) return;

    try {
      const result = await requestJson(API_ENDPOINTS.clear, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey: currentAigcCollectionKey,
          password: getAigcUploadAdminPassword(),
          all: true
        })
      });
      setRemoteBucket(currentAigcCollectionKey, result.items || {});
      await loadRemoteUploadsForCollection(currentAigcCollectionKey, true);
      renderAigcCollection(currentAigcCollectionSource, {
        preserveUploadAdmin: true,
        selectedNumber: "01"
      });
      updateAigcUploadAdminSelection("01");
      setAigcUploadStatus("已清除当前作品窗口的全部线上图片。");
    } catch (error) {
      if (error && error.status === 401) {
        setAigcUploadAdminPassword("");
      }
      setAigcUploadStatus(error && error.message ? error.message : "清除失败");
    }
  }

  const originalRenderAigcCollection = renderAigcCollection;
  renderAigcCollection = async function (source, options = {}) {
    const collection = getCollection(source);
    currentAigcCollectionKey = getAigcCollectionStorageKey(source, collection);
    setUploadNoteText();
    if (aigcUploadStatus) {
      setAigcUploadStatus("正在读取线上作品数据……");
    }
    await loadRemoteUploadsForCollection(currentAigcCollectionKey, false);
    return originalRenderAigcCollection.call(this, source, options);
  };

  document.addEventListener("DOMContentLoaded", setUploadNoteText);
  setUploadNoteText();
})();
