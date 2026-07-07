const shortcutElement = document.getElementById('shortcut')
const messageElement = document.getElementById('message')
const startButton = document.getElementById('startCapture')
const shortcutsButton = document.getElementById('openShortcuts')
const engineSelect = document.getElementById('engineSelect')

const DEFAULT_TARGET = 'google'

void init()

async function init () {
  await loadDefaultEngine()
  await loadShortcut()

  engineSelect.addEventListener('change', async () => {
    try {
      await chrome.storage.local.set({ defaultTarget: engineSelect.value })
      setMessage('默认目标已保存')
    } catch {
      setMessage('保存默认目标失败')
    }
  })

  startButton.addEventListener('click', async () => {
    setMessage('')
    startButton.disabled = true

    try {
      const response = await chrome.runtime.sendMessage({ type: 'LENS_CAPTURE_START_FROM_POPUP' })
      if (!response?.ok) {
        throw new Error(response?.message || '截图失败')
      }
      window.close()
    } catch (error) {
      setMessage(error.message || '截图失败')
      startButton.disabled = false
    }
  })

  shortcutsButton.addEventListener('click', async () => {
    setMessage('')

    try {
      const response = await chrome.runtime.sendMessage({ type: 'LENS_CAPTURE_OPEN_SHORTCUTS' })
      if (!response?.ok) {
        throw new Error(response?.message || '打开快捷键设置失败')
      }
      window.close()
    } catch (error) {
      setMessage(error.message || '打开快捷键设置失败')
    }
  })
}

async function loadDefaultEngine () {
  try {
    const stored = await chrome.storage.local.get(['defaultTarget', 'defaultEngine'])
    engineSelect.value = stored.defaultTarget || stored.defaultEngine || DEFAULT_TARGET
  } catch {
    engineSelect.value = DEFAULT_TARGET
  }
}

async function loadShortcut () {
  try {
    const commands = await chrome.commands.getAll()
    const captureCommand = commands.find((item) => item.name === 'capture-search')
    shortcutElement.textContent = captureCommand?.shortcut || '未设置'
  } catch {
    shortcutElement.textContent = '未设置'
  }
}

function setMessage (message) {
  messageElement.textContent = message
}
