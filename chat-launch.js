const AI_TARGETS = {
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/'
  },
  deepseek: {
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com/'
  },
  kimi: {
    label: 'Kimi',
    url: 'https://kimi.moonshot.cn/'
  }
}

const titleElement = document.getElementById('title')
const messageElement = document.getElementById('message')
const errorElement = document.getElementById('error')
const cardElement = document.querySelector('.card')

const showTimer = window.setTimeout(() => {
  cardElement?.classList.add('show')
}, 350)

void launchChatTarget()

async function launchChatTarget () {
  try {
    const requestId = new URLSearchParams(window.location.search).get('id')
    if (!requestId) {
      throw new Error('缺少跳转任务参数')
    }

    const stored = await chrome.storage.session.get(requestId)
    const payload = stored[requestId]
    if (!payload?.croppedDataUrl) {
      throw new Error('截图数据已失效，请重新截图')
    }

    const target = AI_TARGETS[payload.target]
    if (!target) {
      throw new Error('当前目标不是受支持的聊天站点')
    }

    document.title = `正在打开 ${target.label}`
    titleElement.textContent = `正在打开 ${target.label}`
    messageElement.textContent = `正在复制截图并跳转到 ${target.label} 新聊天…`

    await copyImageToClipboard(payload.croppedDataUrl)

    messageElement.textContent = `截图已复制，正在打开 ${target.label} 并尝试自动上传附件…`
    const response = await chrome.runtime.sendMessage({
      type: 'LENS_CHAT_OPEN_TARGET',
      target: payload.target,
      requestId
    })

    if (!response?.ok) {
      throw new Error(response?.message || '打开聊天页失败')
    }
  } catch (error) {
    showError(error.message || '打开聊天页失败')
  }
}

async function copyImageToClipboard (dataUrl) {
  const blob = await fetch(dataUrl).then(async (response) => response.blob())
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type || 'image/png']: blob
    })
  ])
}

function showError (message) {
  window.clearTimeout(showTimer)
  cardElement?.classList.add('show')
  messageElement.textContent = '无法自动复制截图并跳转'
  errorElement.hidden = false
  errorElement.textContent = message
}
