const CONTENT_SCRIPT_FILES = ['content.js']
const CONTENT_STYLE_FILES = ['content.css']
const DEFAULT_TARGET = 'google'
const CONTEXT_MENU_SEARCH_IMAGE = 'lens-search-image'
const TARGET_PAGE_URLS = {
  baidu: 'https://graph.baidu.com/pcpage/index?tpl_from=pc',
  bing: 'https://www.bing.com/visualsearch',
  chatgpt: 'https://chatgpt.com/',
  deepseek: 'https://chat.deepseek.com/',
  google: null,
  kimi: 'https://www.kimi.com/?chat_enter_method=new_chat',
  yandex: 'https://yandex.com/images/'
}

chrome.runtime.onInstalled.addListener(() => {
  void createContextMenus()
})

chrome.runtime.onStartup.addListener(() => {
  void createContextMenus()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_SEARCH_IMAGE) return

  void handleImageContextSearch(info, tab)
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-search') return

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  await startCaptureFlow(tab)
})

async function createContextMenus () {
  await chrome.contextMenus.removeAll()
  await chrome.contextMenus.create({
    id: CONTEXT_MENU_SEARCH_IMAGE,
    title: '截图直达-识别这张图片',
    contexts: ['image']
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LENS_CAPTURE_PING') {
    sendResponse({ ok: true })
    return false
  }

  if (message?.type === 'LENS_CAPTURE_START_FROM_POPUP') {
    void startCaptureFromPopup()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '截图失败' }))
    return true
  }

  if (message?.type === 'LENS_CAPTURE_OPEN_SHORTCUTS') {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '打开快捷键设置失败' }))
    return true
  }

  if (message?.type === 'LENS_CHAT_OPEN_TARGET') {
    void openAiChatTarget(sender.tab?.id, message.target, message.requestId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '打开聊天页失败' }))
    return true
  }

  if (message?.type === 'LENS_CAPTURE_REGION_READY') {
    void handleCroppedImage(message.croppedDataUrl, sender.tab)
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        await notifyTab(sender.tab?.id, 'LENS_CAPTURE_ERROR', error.message || '搜图失败')
        sendResponse({ ok: false, message: error.message || '搜图失败' })
      })
    return true
  }

  return false
})

async function startCaptureFromPopup () {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  await startCaptureFlow(tab)
}

async function startCaptureFlow (tab) {
  try {
    assertSupportedTab(tab)
    await ensureContentScript(tab.id)
    await notifyTab(tab.id, '正在截图…')
    const target = await getDefaultTarget()

    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    })

    await chrome.tabs.sendMessage(tab.id, {
      type: 'LENS_CAPTURE_START_SELECTION',
      screenshotDataUrl,
      selectionHintText: getSelectionHintText(target)
    })
  } catch (error) {
    await notifyTab(tab?.id, error.message || '截图失败', 'LENS_CAPTURE_ERROR')
  }
}

async function handleImageContextSearch (info, tab) {
  try {
    assertSupportedTab(tab)
    await ensureContentScript(tab.id)

    const imageUrl = info.srcUrl
    if (!imageUrl) {
      throw new Error('未获取到图片地址')
    }

    const target = await getDefaultTarget()
    await notifyTab(tab.id, `正在识别图片并打开${getTargetLabel(target)}…`)

    if (await openDirectImageSearchByUrl(target, imageUrl, tab)) {
      await notifyTab(tab.id, `已在新标签页打开${getTargetLabel(target)}`)
      return
    }

    const dataUrl = await getImageDataUrlForContext(tab, imageUrl)
    await openTargetWithImageData(dataUrl, tab, target)
    await notifyTab(tab.id, `已在新标签页打开${getTargetLabel(target)}`)
  } catch (error) {
    await notifyTab(tab?.id, error.message || '识图失败', 'LENS_CAPTURE_ERROR')
  }
}

function assertSupportedTab (tab) {
  if (!tab?.id || typeof tab.windowId !== 'number') {
    throw new Error('未找到可用的当前标签页')
  }

  const url = tab.url || ''
  if (/^(chrome|edge|about|chrome-extension):/i.test(url)) {
    throw new Error('当前页面不支持浏览器扩展截图，请切换到普通网页后重试')
  }
}

async function ensureContentScript (tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'LENS_CAPTURE_PING' })
    return
  } catch {
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: CONTENT_STYLE_FILES
  })

  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  })
}

async function handleCroppedImage (croppedDataUrl, tab) {
  if (!croppedDataUrl) {
    throw new Error('未获取到截图结果')
  }

  const target = await getDefaultTarget()
  await notifyTab(tab?.id, `正在打开${getTargetLabel(target)}…`)
  await openTargetWithImageData(croppedDataUrl, tab, target)
  await notifyTab(tab?.id, `已在新标签页打开${getTargetLabel(target)}`)
}

async function openTargetWithImageData (imageDataUrl, tab, target) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  await chrome.storage.session.set({
    [requestId]: {
      croppedDataUrl: imageDataUrl,
      createdAt: Date.now(),
      target
    }
  })

  const isGoogleUpload = target === 'google'
  const isAiTarget = isAiChatTarget(target)
  const createOptions = {
    url: isGoogleUpload
      ? chrome.runtime.getURL(`upload.html?id=${encodeURIComponent(requestId)}`)
      : isAiTarget
        ? chrome.runtime.getURL(`chat-launch.html?id=${encodeURIComponent(requestId)}`)
        : TARGET_PAGE_URLS[target],
    active: true
  }

  if (typeof tab?.index === 'number') {
    createOptions.index = tab.index + 1
  }

  const createdTab = await chrome.tabs.create(createOptions)

  if (!isGoogleUpload && !isAiTarget) {
    await automateSearchUpload(createdTab.id, target, imageDataUrl)
    await chrome.storage.session.remove(requestId)
  }
}

async function openDirectImageSearchByUrl (target, imageUrl, tab) {
  const directSearchUrl = getDirectImageSearchUrl(target, imageUrl)
  if (!directSearchUrl) return false

  const createOptions = {
    url: directSearchUrl,
    active: true
  }

  if (typeof tab?.index === 'number') {
    createOptions.index = tab.index + 1
  }

  await chrome.tabs.create(createOptions)
  return true
}

function getDirectImageSearchUrl (target, imageUrl) {
  if (!imageUrl) return ''

  switch (target) {
    case 'google':
      return `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}`
    case 'yandex':
      return `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(imageUrl)}`
    default:
      return ''
  }
}

async function getImageDataUrlFromPage (tabId, imageUrl) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractImageDataUrl,
    args: [imageUrl]
  })

  if (result?.ok && result.dataUrl) {
    return result.dataUrl
  }

  throw new Error(result?.message || '当前图片站点限制直接读取，建议改用截图识图')
}

async function getImageDataUrlForContext (tab, imageUrl) {
  const croppedFromViewport = await tryGetContextImageCrop(tab)
  if (croppedFromViewport) {
    return croppedFromViewport
  }

  return await getImageDataUrlFromPage(tab.id, imageUrl)
}

async function tryGetContextImageCrop (tab) {
  if (!tab?.id || typeof tab.windowId !== 'number') {
    return ''
  }

  try {
    const contextImage = await getLastContextImageFromTab(tab.id)
    if (!contextImage) return ''

    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    })

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: cropContextImageFromScreenshot,
      args: [screenshotDataUrl, contextImage]
    })

    if (result?.ok && result.dataUrl) {
      return result.dataUrl
    }
  } catch {
  }

  return ''
}

async function getLastContextImageFromTab (tabId) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'LENS_CAPTURE_GET_LAST_CONTEXT_IMAGE'
  })

  return response?.ok ? response.image : null
}

async function cropContextImageFromScreenshot (screenshotDataUrl, rect) {
  try {
    if (!screenshotDataUrl || !rect?.width || !rect?.height || !rect?.windowWidth || !rect?.windowHeight) {
      return { ok: false }
    }

    const image = await loadImageForCrop(screenshotDataUrl)
    const scaleX = image.naturalWidth / rect.windowWidth
    const scaleY = image.naturalHeight / rect.windowHeight
    const sx = Math.max(0, Math.round(rect.left * scaleX))
    const sy = Math.max(0, Math.round(rect.top * scaleY))
    const sw = Math.max(1, Math.round(rect.width * scaleX))
    const sh = Math.max(1, Math.round(rect.height * scaleY))

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh

    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      return { ok: false }
    }

    context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
    return { ok: true, dataUrl: canvas.toDataURL('image/png') }
  } catch {
    return { ok: false }
  }

  function loadImageForCrop (src) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('截图加载失败'))
      image.src = src
    })
  }
}

async function extractImageDataUrl (imageUrl) {
  const candidates = Array.from(document.images)
    .filter((image) => image.currentSrc === imageUrl || image.src === imageUrl)

  for (const image of candidates) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      const context = canvas.getContext('2d')
      if (!context) continue
      context.drawImage(image, 0, 0)
      return { ok: true, dataUrl: canvas.toDataURL('image/png') }
    } catch {
    }
  }

  try {
    const response = await fetch(imageUrl, { credentials: 'include' })
    if (!response.ok) {
      throw new Error(`图片读取失败：${response.status}`)
    }

    const blob = await response.blob()
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.readAsDataURL(blob)
    })

    if (typeof dataUrl === 'string') {
      return { ok: true, dataUrl }
    }
  } catch {
  }

  return { ok: false, message: '当前图片站点限制直接读取，建议改用截图识图' }
}

async function getDefaultTarget () {
  const stored = await chrome.storage.local.get('defaultTarget')
  return isSupportedTarget(stored.defaultTarget) ? stored.defaultTarget : DEFAULT_TARGET
}

function isSupportedTarget (target) {
  return Object.prototype.hasOwnProperty.call(TARGET_PAGE_URLS, target)
}

function getTargetLabel (target) {
  switch (target) {
    case 'baidu':
      return '百度识图'
    case 'bing':
      return 'Bing Visual Search'
    case 'chatgpt':
      return 'ChatGPT'
    case 'deepseek':
      return 'DeepSeek'
    case 'kimi':
      return 'Kimi'
    case 'yandex':
      return 'Yandex Images'
    default:
      return 'Google Lens'
  }
}

function getSelectionHintText (target) {
  if (isAiChatTarget(target)) {
    return `拖拽框选区域，松手后自动打开 ${getTargetLabel(target)} 并复制截图，按 Esc 取消`
  }

  return `拖拽框选区域，松手后自动使用 ${getTargetLabel(target)} 搜图，按 Esc 取消`
}

function isAiChatTarget (target) {
  return target === 'chatgpt' || target === 'deepseek' || target === 'kimi'
}

async function automateSearchUpload (tabId, target, dataUrl) {
  if (!tabId) {
    throw new Error('未能创建搜图标签页')
  }

  await waitForTabComplete(tabId)
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: injectImageIntoSearchPage,
    args: [target, dataUrl]
  })

  if (!result?.ok) {
    throw new Error(result?.message || `${getTargetLabel(target)} 自动上传失败`)
  }
}

async function openAiChatTarget (tabId, target, requestId) {
  if (!tabId) {
    throw new Error('未找到可用的聊天标签页')
  }

  const targetUrl = TARGET_PAGE_URLS[target]
  if (!targetUrl || !isAiChatTarget(target)) {
    throw new Error('当前目标不是受支持的聊天站点')
  }

  const stored = requestId ? await chrome.storage.session.get(requestId) : {}
  const payload = requestId ? stored[requestId] : null
  if (!payload?.croppedDataUrl) {
    throw new Error('截图数据已失效，请重新截图')
  }

  await chrome.tabs.update(tabId, { url: targetUrl })
  await waitForTabComplete(tabId)
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: attachImageToAiChat,
    args: [target, payload.croppedDataUrl]
  })

  await chrome.storage.session.remove(requestId)

  if (result?.ok) return

  throw new Error(result?.message || '自动上传附件失败，请手动 Ctrl+V')
}

function waitForTabComplete (tabId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated)
      reject(new Error('页面加载超时，请重试'))
    }, 20000)

    function handleUpdated (updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return

      clearTimeout(timeoutId)
      chrome.tabs.onUpdated.removeListener(handleUpdated)
      resolve()
    }

    chrome.tabs.onUpdated.addListener(handleUpdated)
  })
}

async function notifyTab (tabId, message, type = 'LENS_CAPTURE_STATUS') {
  if (!tabId) return

  try {
    await chrome.tabs.sendMessage(tabId, { type, message })
  } catch {
  }
}

async function injectImageIntoSearchPage (target, dataUrl) {
  const configMap = {
    baidu: { inputSelector: 'input[type="file"].general-upload-file, input[type="file"]', timeout: 15000 },
    bing: { inputSelector: 'input[type="file"]', timeout: 15000 },
    yandex: { inputSelector: 'input[type="file"]', timeout: 15000 }
  }

  const config = configMap[target]
  if (!config) {
    return { ok: false, message: '当前引擎不支持自动上传' }
  }

  try {
    const input = await waitForFileInput(config.inputSelector, config.timeout)
    const blob = await fetch(dataUrl).then(async (response) => response.blob())
    const file = new File([blob], 'capture.png', { type: blob.type || 'image/png' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error.message || '自动上传失败' }
  }

  function waitForFileInput (selector, timeout) {
    return new Promise((resolve, reject) => {
      const immediate = document.querySelector(selector)
      if (immediate) {
        resolve(immediate)
        return
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector)
        if (!element) return
        observer.disconnect()
        clearTimeout(timerId)
        resolve(element)
      })

      observer.observe(document.documentElement, { childList: true, subtree: true })

      const timerId = setTimeout(() => {
        observer.disconnect()
        reject(new Error('页面没有可用的图片上传入口，可能需要先完成人机验证'))
      }, timeout)
    })
  }
}

async function attachImageToAiChat (target, dataUrl) {
  const inputSelectorsMap = {
    chatgpt: ['input[type="file"]', 'input[accept*="image"]', 'input[accept*="png"]', 'input[accept*="jpeg"]'],
    deepseek: ['input[type="file"]', 'input[accept*="image"]', 'input[accept*="png"]', 'input[accept*="jpeg"]'],
    kimi: ['input[type="file"]', 'input[accept*="image"]', 'input[accept*="png"]', 'input[accept*="jpeg"]']
  }

  const triggerSelectorsMap = {
    chatgpt: ['label[for]', 'button[aria-label*="plus" i]', 'button[aria-label*="upload" i]', 'button[aria-label*="attach" i]', 'button[aria-label*="image" i]', 'button[aria-label*="photo" i]', 'button[aria-label*="附件"]', 'button[aria-label*="上传"]', 'button[aria-label*="附"]', 'button[data-testid*="upload"]', 'button[data-testid*="attach"]', 'button[class*="attach"]', 'button[class*="upload"]', '[role="button"][aria-label*="upload" i]', '[role="button"][aria-label*="attach" i]'],
    deepseek: ['button[aria-label*="附"]', 'button[aria-label*="upload" i]', 'button[aria-label*="image" i]', 'button[data-testid*="upload"]', 'button[data-testid*="attach"]'],
    kimi: ['.chat-input img', '.chat-input svg', '.chat-input [role="button"]', '.chat-input button', 'button[aria-label*="附"]', 'button[aria-label*="upload" i]', 'button[aria-label*="image" i]', 'button[data-testid*="upload"]', 'button[data-testid*="attach"]', '[class*="upload"]', '[class*="attach"]']
  }

  const composerSelectorsMap = {
    chatgpt: ['div[contenteditable="true"][role="textbox"]', 'textarea', 'div.ProseMirror[contenteditable="true"]'],
    deepseek: ['textarea', 'div[contenteditable="true"][role="textbox"]', 'div.ProseMirror[contenteditable="true"]'],
    kimi: ['div[contenteditable="true"]', 'textarea', 'div[contenteditable="true"][role="textbox"]', 'div.ProseMirror[contenteditable="true"]']
  }

  const inputSelectors = inputSelectorsMap[target] || inputSelectorsMap.chatgpt
  const triggerSelectors = triggerSelectorsMap[target] || []
  const composerSelectors = composerSelectorsMap[target] || composerSelectorsMap.chatgpt
  const deadline = Date.now() + 15000
  const blob = await fetch(dataUrl).then(async (response) => response.blob())
  const file = new File([blob], 'capture.png', { type: blob.type || 'image/png' })

  clickPossibleTriggers(triggerSelectors)

  while (Date.now() <= deadline) {
    const blockedMessage = detectTargetBlocking(target)
    if (blockedMessage) {
      focusComposer(composerSelectors)
      return { ok: false, message: blockedMessage }
    }

    const input = findMatchingInput(inputSelectors)
    if (input) {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      focusComposer(composerSelectors)
      return { ok: true }
    }

    const composer = findComposer(composerSelectors)
    if (composer && tryPasteOrDrop(composer, file)) {
      focusComposer(composerSelectors)
      return { ok: true }
    }

    clickPossibleTriggers(triggerSelectors)
    await new Promise(resolve => window.setTimeout(resolve, 300))
  }

  focusComposer(composerSelectors)
  return { ok: false, message: '未找到可用的图片上传入口，请手动 Ctrl+V' }

  function clickPossibleTriggers (selectors) {
    if (target === 'kimi') {
      if (clickKimiUploadEntry()) {
        return
      }
    }

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector)
      for (const element of elements) {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue
        if (typeof element.click === 'function') {
          element.click()
        }
        if (element.parentElement && typeof element.parentElement.click === 'function') {
          element.parentElement.click()
        }
      }
    }
    clickHeuristicTriggers()
  }

  function findMatchingInput (selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (element instanceof HTMLInputElement) {
        return element
      }
    }
    return null
  }

  function focusComposer (selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (!element) continue
      element.focus()
      if (typeof element.click === 'function') {
        element.click()
      }
      return true
    }
    return false
  }

  function findComposer (selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (element instanceof HTMLElement) {
        return element
      }
    }
    return null
  }

  function tryPasteOrDrop (element, file) {
    try {
      const transfer = new DataTransfer()
      transfer.items.add(file)

      if (target === 'kimi') {
        if (typeof ClipboardEvent === 'function') {
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer
          })
          element.dispatchEvent(pasteEvent)
          return true
        }
        return false
      }

      if (typeof ClipboardEvent === 'function') {
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer
        })
        element.dispatchEvent(pasteEvent)
      }
      if (typeof DragEvent === 'function') {
        const dragEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        })
        element.dispatchEvent(dragEvent)
      }
      return true
    } catch {
      return false
    }
  }

  function clickHeuristicTriggers () {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], label, img, svg, div'))
      .filter((element) => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false
        const text = (element.getAttribute?.('aria-label') || element.getAttribute?.('title') || element.textContent || '').trim().toLowerCase()
        const cls = String(element.getAttribute?.('class') || '').toLowerCase()
        return text.includes('上传') || text.includes('附件') || text.includes('图片') || text.includes('image') || text.includes('upload') || text.includes('attach') || cls.includes('upload') || cls.includes('attach') || cls.includes('plus')
      })
      .slice(0, 20)

    for (const element of candidates) {
      if (typeof element.click === 'function') {
        element.click()
      }
    }
  }

  function clickKimiUploadEntry () {
    const uploadEntry = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
      .find((element) => {
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
        return text === '文件和图片' || text.includes('文件和图片')
      })

    if (uploadEntry && typeof uploadEntry.click === 'function') {
      uploadEntry.click()
      return true
    }

    return false
  }

  function detectTargetBlocking (currentTarget) {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')

    if (currentTarget === 'kimi' && /登录后.*支持上传文件|支持上传文件/.test(text)) {
      return 'Kimi 当前账号未登录，页面限制“登录后支持上传文件”'
    }

    if (currentTarget === 'chatgpt' && /登录或注册|开始使用 ?\| ?ChatGPT/.test(text)) {
      return 'ChatGPT 当前未登录，无法自动上传附件'
    }

    return ''
  }
}
