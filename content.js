(() => {
  if (window.__lensCaptureLoaded__) return
  window.__lensCaptureLoaded__ = true

  let overlayRoot = null
  let overlay = null
  let selectionBox = null
  let hint = null
  let toast = null
  let screenshotDataUrl = ''
  let selectionHintText = '拖拽框选区域，松手后自动处理，按 Esc 取消'
  let dragState = null
  let toastTimer = 0
  let lastContextImage = null

  document.addEventListener('contextmenu', handleContextMenu, true)

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'LENS_CAPTURE_PING') {
      sendResponse({ ok: true })
      return false
    }

    if (message?.type === 'LENS_CAPTURE_GET_LAST_CONTEXT_IMAGE') {
      sendResponse({ ok: true, image: getLastContextImage() })
      return false
    }

    if (message?.type === 'LENS_CAPTURE_START_SELECTION') {
      screenshotDataUrl = message.screenshotDataUrl || ''
      selectionHintText = message.selectionHintText || selectionHintText
      mountOverlay()
      setHint(selectionHintText)
      return false
    }

    if (message?.type === 'LENS_CAPTURE_STATUS') {
      showToast(message.message || '')
      return false
    }

    if (message?.type === 'LENS_CAPTURE_ERROR') {
      showToast(message.message || '操作失败')
      return false
    }

    return false
  })

  function mountOverlay () {
    destroyOverlay()

    overlayRoot = document.createElement('div')
    overlayRoot.id = 'lens-capture-root'

    overlay = document.createElement('div')
    overlay.className = 'lens-capture-overlay'

    selectionBox = document.createElement('div')
    selectionBox.className = 'lens-capture-box'

    hint = document.createElement('div')
    hint.className = 'lens-capture-hint'

    toast = document.createElement('div')
    toast.className = 'lens-capture-toast'

    overlay.append(selectionBox, hint, toast)
    overlayRoot.append(overlay)
    document.documentElement.append(overlayRoot)

    overlay.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', handleMouseUp, true)
    window.addEventListener('keydown', handleKeyDown, true)
  }

  function destroyOverlay () {
    if (overlay) {
      overlay.removeEventListener('mousedown', handleMouseDown, true)
    }
    window.removeEventListener('mousemove', handleMouseMove, true)
    window.removeEventListener('mouseup', handleMouseUp, true)
    window.removeEventListener('keydown', handleKeyDown, true)

    dragState = null
    overlayRoot?.remove()
    overlayRoot = null
    overlay = null
    selectionBox = null
    hint = null
    toast = null
  }

  function handleMouseDown (event) {
    if (event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()

    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY
    }
    renderSelection()
  }

  function handleContextMenu (event) {
    const target = event.target
    const image = target instanceof Element ? target.closest('img') : null

    if (!image) {
      lastContextImage = null
      return
    }

    const rect = image.getBoundingClientRect()
    lastContextImage = {
      srcUrl: image.currentSrc || image.src || '',
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height),
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    }
  }

  function getLastContextImage () {
    if (!lastContextImage) return null
    if (lastContextImage.width < 8 || lastContextImage.height < 8) return null
    return lastContextImage
  }

  function handleMouseMove (event) {
    if (!dragState) return

    event.preventDefault()
    event.stopPropagation()

    dragState.currentX = event.clientX
    dragState.currentY = event.clientY
    renderSelection()
  }

  async function handleMouseUp (event) {
    if (!dragState) return

    event.preventDefault()
    event.stopPropagation()

    dragState.currentX = event.clientX
    dragState.currentY = event.clientY
    const rect = getNormalizedRect(dragState)
    dragState = null

    if (rect.width < 24 || rect.height < 24) {
      selectionBox.style.display = 'none'
      showToast('选区太小，请重新拖拽')
      return
    }

    setHint('正在裁剪截图…')

    try {
      const croppedDataUrl = await cropSelection(rect)
      destroyOverlay()
      await chrome.runtime.sendMessage({
        type: 'LENS_CAPTURE_REGION_READY',
        croppedDataUrl
      })
    } catch (error) {
      setHint(selectionHintText)
      showToast(error.message || '截图裁剪失败')
    }
  }

  function handleKeyDown (event) {
    if (event.key !== 'Escape') return

    event.preventDefault()
    event.stopPropagation()
    destroyOverlay()
    showToast('已取消截图搜图')
  }

  function renderSelection () {
    if (!selectionBox || !dragState) return

    const rect = getNormalizedRect(dragState)
    selectionBox.style.display = 'block'
    selectionBox.style.left = `${rect.left}px`
    selectionBox.style.top = `${rect.top}px`
    selectionBox.style.width = `${rect.width}px`
    selectionBox.style.height = `${rect.height}px`
  }

  function getNormalizedRect ({ startX, startY, currentX, currentY }) {
    const left = Math.max(0, Math.min(startX, currentX))
    const top = Math.max(0, Math.min(startY, currentY))
    const right = Math.min(window.innerWidth, Math.max(startX, currentX))
    const bottom = Math.min(window.innerHeight, Math.max(startY, currentY))

    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    }
  }

  async function cropSelection (rect) {
    if (!screenshotDataUrl) {
      throw new Error('截图数据不存在')
    }

    const image = await loadImage(screenshotDataUrl)
    const scaleX = image.naturalWidth / window.innerWidth
    const scaleY = image.naturalHeight / window.innerHeight
    const sx = Math.round(rect.left * scaleX)
    const sy = Math.round(rect.top * scaleY)
    const sw = Math.max(1, Math.round(rect.width * scaleX))
    const sh = Math.max(1, Math.round(rect.height * scaleY))

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh

    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      throw new Error('浏览器不支持截图裁剪')
    }

    context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
    return canvas.toDataURL('image/png')
  }

  function loadImage (src) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('截图加载失败'))
      image.src = src
    })
  }

  function setHint (message) {
    if (hint) {
      hint.textContent = message
    }
  }

  function showToast (message) {
    if (!message) return

    if (!toast) {
      const tempToast = document.createElement('div')
      tempToast.textContent = message
      Object.assign(tempToast.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        padding: '12px 16px',
        borderRadius: '999px',
        color: '#fff',
        background: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(12px)',
        font: '500 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        letterSpacing: '0.01em',
        maxWidth: 'min(90vw, 680px)',
        textAlign: 'center',
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.3)',
        zIndex: '2147483647'
      })
      document.documentElement.append(tempToast)
      window.setTimeout(() => tempToast.remove(), 2200)
      return
    }

    toast.textContent = message
    toast.classList.add('show')
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toast?.classList.remove('show')
    }, 2200)
  }
})()
