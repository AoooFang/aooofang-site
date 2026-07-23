(function () {
  const API_ENDPOINTS = {
    list: "/api/portfolio/list",
    upload: "/api/portfolio/upload",
    clear: "/api/portfolio/clear"
  };

  const ADMIN_PASSWORD_SESSION_KEY = "aooofang_portfolio_upload_admin_password_remote";
  const originalGetStoredUploadedImage = typeof getStoredUploadedImage === "function" ? getStoredUploadedImage : null;
  const originalRenderAigcCollection = typeof renderAigcCollection === "function" ? renderAigcCollection : null;
  const remoteUploadsCache = window.__aooofangRemoteUploadsCache || (window.__aooofangRemoteUploadsCache = Object.create(null));
  const remoteLoadState = window.__aooofangRemoteUploadsLoadState || (window.__aooofangRemoteUploadsLoadState = Object.create(null));

  function getElement(id) {
    return document.getElementById(id);
  }

  function getRemoteBucket(collectionKey = currentAigcCollectionKey) {
    return remoteUploadsCache[collectionKey] || {};
  }

  function hasLoadedRemoteBucket(collectionKey = currentAigcCollectionKey) {
    return Boolean(remoteLoadState[collectionKey]);
  }

  function setRemoteBucket(collectionKey, items) {
    remoteUploadsCache[collectionKey] = Object.assign({}, items || {});
    remoteLoadState[collectionKey] = true;
  }

  function setUploadNoteText() {
    const note = document.querySelector(".aigc-upload-note");
    if (note) {
      note.textContent = "图片会发布到线上共享存储；别人打开网站也能看到。若你之前在这个浏览器里已经传过图，请点击“同步本机到线上”。";
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
      const suffix = force ? `&t=${Date.now()}` : "";
      const data = await requestJson(`${API_ENDPOINTS.list}?collectionKey=${encodeURIComponent(collectionKey)}${suffix}`, {
        cache: "no-store"
      });
      setRemoteBucket(collectionKey, data.items || {});
      return getRemoteBucket(collectionKey);
    } catch (error) {
      remoteLoadState[collectionKey] = false;
      console.error("[portfolio] load remote uploads failed:", error);
      return getRemoteBucket(collectionKey);
    }
  }

  function getLegacyStorageKey(number) {
    if (typeof AIGC_UPLOAD_STORAGE_PREFIX !== "string") return "";
    return `${AIGC_UPLOAD_STORAGE_PREFIX}${currentAigcCollectionKey}:${number}`;
  }

  function getLegacyLocalImage(number) {
    try {
      if (originalGetStoredUploadedImage) {
        const fromOriginal = originalGetStoredUploadedImage(number);
        if (fromOriginal) return fromOriginal;
      }
    } catch (error) {}

    try {
      const key = getLegacyStorageKey(number);
      return key ? (localStorage.getItem(key) || "") : "";
    } catch (error) {
      return "";
    }
  }

  function removeLegacyLocalImage(number) {
    try {
      const key = getLegacyStorageKey(number);
      if (key) localStorage.removeItem(key);
    } catch (error) {}
  }

  function clearAllLegacyLocalImages() {
    const items = (currentAigcCollection && currentAigcCollection.items) || [];
    const total = getAigcSlotTotal(items);
    for (let index = 0; index < total; index += 1) {
      removeLegacyLocalImage(String(index + 1).padStart(2, "0"));
    }
  }

  function getStoredUploadedImageRemote(number) {
    const bucket = getRemoteBucket();
    const value = bucket[number];
    if (!value) return "";
    return typeof value === "string" ? value : (value.url || "");
  }

  function getUploadedImageRemote(number) {
    const remoteImage = getStoredUploadedImageRemote(number);
    if (remoteImage) return remoteImage;
    if (hasLoadedRemoteBucket()) return "";
    const legacyLocalImage = getLegacyLocalImage(number);
    if (legacyLocalImage) return legacyLocalImage;
    const staticCandidates = getPortfolioStaticImageCandidates(number);
    return staticCandidates[0] || "";
  }

  function getUploadedImageBackgroundRemote(number, dataUrl = getUploadedImageRemote(number)) {
    const remoteImage = getStoredUploadedImageRemote(number);
    if (remoteImage) return `url("${escapeCssUrl(remoteImage)}")`;
    if (hasLoadedRemoteBucket()) return "";

    const legacyLocalImage = getLegacyLocalImage(number);
    if (legacyLocalImage) return `url("${escapeCssUrl(legacyLocalImage)}")`;

    const staticCandidates = getPortfolioStaticImageCandidates(number);
    if (staticCandidates.length) {
      return staticCandidates.map(candidate => `url("${escapeCssUrl(candidate)}")`).join(", ");
    }

    return dataUrl ? `url("${escapeCssUrl(dataUrl)}")` : "";
  }

  function getAigcUploadAdminPasswordRemote() {
    try {
      return sessionStorage.getItem(ADMIN_PASSWORD_SESSION_KEY) || "";
    } catch (error) {
      return window.__aigcUploadAdminPassword || "";
    }
  }

  function setAigcUploadAdminPasswordRemote(value) {
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

  function requestAigcUploadPasswordRemote() {
    const storedPassword = getAigcUploadAdminPasswordRemote();
    if (storedPassword) {
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

    setAigcUploadAdminPasswordRemote(password);
    setAigcUploadStatus("密码已记录，正在使用线上共享存储。");
    return true;
  }

  async function rerenderCurrentCollection(selectedNumber) {
    if (!originalRenderAigcCollection) return;
    await window.renderAigcCollection(currentAigcCollectionSource, {
      preserveUploadAdmin: true,
      selectedNumber: selectedNumber || currentAigcUploadTargetNumber || "01"
    });
    updateAigcUploadAdminSelection(selectedNumber || currentAigcUploadTargetNumber || "01");
  }

  async function uploadPayloadItems(payloadItems, doneMessage) {
    if (!payloadItems.length) {
      setAigcUploadStatus("当前没有可同步或可上传的图片。");
      return;
    }

    const result = await requestJson(API_ENDPOINTS.upload, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collectionKey: currentAigcCollectionKey,
        password: getAigcUploadAdminPasswordRemote(),
        items: payloadItems
      })
    });

    setRemoteBucket(currentAigcCollectionKey, result.items || {});
    const lastSavedNumber = payloadItems[payloadItems.length - 1]?.number || currentAigcUploadTargetNumber || "01";
    await loadRemoteUploadsForCollection(currentAigcCollectionKey, true);
    await rerenderCurrentCollection(lastSavedNumber);
    setAigcUploadStatus(doneMessage || `已上传 ${payloadItems.length} 张图片，所有访问者现在都能看到。`);
  }

  async function saveUploadFilesRemote(files) {
    if (!requestAigcUploadPasswordRemote()) return;

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
      await uploadPayloadItems(payloadItems, `已上传 ${payloadItems.length} 张图片，所有访问者现在都能看到。`);
    } catch (error) {
      if (error && error.status === 401) {
        setAigcUploadAdminPasswordRemote("");
      }
      setAigcUploadStatus(error && error.message ? error.message : "线上上传失败");
    }
  }

  function collectLegacyLocalPayloadItems() {
    const items = (currentAigcCollection && currentAigcCollection.items) || [];
    const total = getAigcSlotTotal(items);
    const payloadItems = [];

    for (let index = 0; index < total; index += 1) {
      const number = String(index + 1).padStart(2, "0");
      const dataUrl = getLegacyLocalImage(number);
      if (!dataUrl) continue;
      payloadItems.push({
        number,
        dataUrl,
        fileName: `legacy-local-${number}.png`
      });
    }

    return payloadItems;
  }

  async function syncLegacyLocalImagesToRemote() {
    if (!requestAigcUploadPasswordRemote()) return;

    const payloadItems = collectLegacyLocalPayloadItems();
    if (!payloadItems.length) {
      setAigcUploadStatus("当前浏览器里没有检测到可同步的本机图片。请在之前上传过图片的同一个浏览器里操作。");
      return;
    }

    setAigcUploadStatus(`检测到 ${payloadItems.length} 张本机图片，正在同步到线上……`);

    try {
      await uploadPayloadItems(payloadItems, `已将本机中的 ${payloadItems.length} 张图片同步到线上，别人现在也能看到。`);
    } catch (error) {
      if (error && error.status === 401) {
        setAigcUploadAdminPasswordRemote("");
      }
      setAigcUploadStatus(error && error.message ? error.message : "同步到线上失败");
    }
  }

  async function clearCurrentUploadedImageRemote() {
    if (!requestAigcUploadPasswordRemote()) return;
    const number = currentAigcUploadTargetNumber || "01";

    try {
      const result = await requestJson(API_ENDPOINTS.clear, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey: currentAigcCollectionKey,
          password: getAigcUploadAdminPasswordRemote(),
          numbers: [number]
        })
      });
      removeLegacyLocalImage(number);
      setRemoteBucket(currentAigcCollectionKey, result.items || {});
      await loadRemoteUploadsForCollection(currentAigcCollectionKey, true);
      await rerenderCurrentCollection(number);
      setAigcUploadStatus(`已清除第 ${number} 张线上图片。`);
    } catch (error) {
      if (error && error.status === 401) {
        setAigcUploadAdminPasswordRemote("");
      }
      setAigcUploadStatus(error && error.message ? error.message : "清除失败");
    }
  }

  async function clearAllUploadedImagesRemote() {
    if (!requestAigcUploadPasswordRemote()) return;
    const ok = window.confirm("确定清除当前作品窗口内已上传的全部线上图片吗？");
    if (!ok) return;

    try {
      const result = await requestJson(API_ENDPOINTS.clear, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey: currentAigcCollectionKey,
          password: getAigcUploadAdminPasswordRemote(),
          all: true
        })
      });
      clearAllLegacyLocalImages();
      setRemoteBucket(currentAigcCollectionKey, result.items || {});
      await loadRemoteUploadsForCollection(currentAigcCollectionKey, true);
      await rerenderCurrentCollection("01");
      setAigcUploadStatus("已清除当前作品窗口的全部线上图片。");
    } catch (error) {
      if (error && error.status === 401) {
        setAigcUploadAdminPasswordRemote("");
      }
      setAigcUploadStatus(error && error.message ? error.message : "清除失败");
    }
  }

  function countLegacyLocalImages() {
    return collectLegacyLocalPayloadItems().length;
  }

  function updateSyncHint() {
    const remoteCount = Object.keys(getRemoteBucket(currentAigcCollectionKey)).length;
    const legacyCount = countLegacyLocalImages();
    if (legacyCount > 0 && remoteCount === 0) {
      setAigcUploadStatus(`检测到当前浏览器里有 ${legacyCount} 张本机图片尚未发布。点击“同步本机到线上”即可让别人看到。`);
      return;
    }
    if (remoteCount > 0) {
      setAigcUploadStatus(`当前作品集线上已发布 ${remoteCount} 张图片。`);
    }
  }

  function replaceControl(id, binder) {
    const currentNode = getElement(id);
    if (!currentNode) return null;
    const clonedNode = currentNode.cloneNode(true);
    currentNode.parentNode.replaceChild(clonedNode, currentNode);
    binder(clonedNode);
    return clonedNode;
  }

  function bindRemoteUploadControls() {
    const fileInput = replaceControl("aigcUploadFileInput", (node) => {
      node.addEventListener("change", async () => {
        const selectedFiles = node.files;
        await saveUploadFilesRemote(selectedFiles);
        node.value = "";
      });
    });

    replaceControl("aigcUploadCurrentBtn", (node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!requestAigcUploadPasswordRemote()) return;
        aigcPendingUploadMode = "current";
        if (fileInput) {
          fileInput.multiple = false;
          fileInput.click();
        }
      });
    });

    replaceControl("aigcUploadBatchBtn", (node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!requestAigcUploadPasswordRemote()) return;
        aigcPendingUploadMode = "batch";
        if (fileInput) {
          fileInput.multiple = true;
          fileInput.click();
        }
      });
    });

    replaceControl("aigcUploadSyncLocalBtn", (node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        syncLegacyLocalImagesToRemote();
      });
    });

    replaceControl("aigcUploadClearCurrentBtn", (node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearCurrentUploadedImageRemote();
      });
    });

    replaceControl("aigcUploadClearAllBtn", (node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearAllUploadedImagesRemote();
      });
    });
  }

  if (originalRenderAigcCollection) {
    renderAigcCollection = window.renderAigcCollection = async function (source, options = {}) {
      const collection = getCollection(source);
      currentAigcCollectionKey = getAigcCollectionStorageKey(source, collection);
      setUploadNoteText();
      await loadRemoteUploadsForCollection(currentAigcCollectionKey, false);
      const result = await originalRenderAigcCollection.call(this, source, options);
      bindRemoteUploadControls();
      updateSyncHint();
      return result;
    };
  }

  getStoredUploadedImage = window.getStoredUploadedImage = getStoredUploadedImageRemote;
  getUploadedImage = window.getUploadedImage = getUploadedImageRemote;
  getUploadedImageBackground = window.getUploadedImageBackground = getUploadedImageBackgroundRemote;
  requestAigcUploadPassword = window.requestAigcUploadPassword = requestAigcUploadPasswordRemote;
  saveUploadFiles = window.saveUploadFiles = saveUploadFilesRemote;
  clearCurrentUploadedImage = window.clearCurrentUploadedImage = clearCurrentUploadedImageRemote;
  clearAllUploadedImages = window.clearAllUploadedImages = clearAllUploadedImagesRemote;

  document.addEventListener("DOMContentLoaded", function () {
    setUploadNoteText();
    bindRemoteUploadControls();
  });

  setUploadNoteText();
  bindRemoteUploadControls();
})();
