const GOOGLE_SEARCH_UPLOAD_URL = 'https://www.google.com/searchbyimage/upload?hl=zh-CN'
const ENGINE_LABELS = {
  baidu: '百度识图',
  bing: 'Bing Visual Search',
  google: 'Google Lens',
  yandex: 'Yandex Images'
}

const titleElement = document.getElementById('title')
const messageElement = document.getElementById('message')
const errorElement = document.getElementById('error')

void submitToSearchEngine()

async function submitToSearchEngine () {
  try {
    const requestId = new URLSearchParams(window.location.search).get('id')
    if (!requestId) {
      throw new Error('缺少上传任务参数')
    }

    const stored = await chrome.storage.session.get(requestId)
    const payload = stored[requestId]
    if (!payload?.croppedDataUrl) {
      throw new Error('截图数据已失效，请重新截图')
    }

    const engine = payload.target === 'google' ? 'google' : 'google'
    const title = `正在打开 ${getEngineLabel(engine)}`
    document.title = title
    if (titleElement) {
      titleElement.textContent = title
    }

    messageElement.textContent = `正在提交图片到 ${getEngineLabel(engine)}…`
    const blob = await dataUrlToBlob(payload.croppedDataUrl)
    await chrome.storage.session.remove(requestId)

    const form = document.createElement('form')
    form.method = 'POST'
    form.action = GOOGLE_SEARCH_UPLOAD_URL
    form.enctype = 'multipart/form-data'

    appendFileField(form, 'encoded_image', blob, 'capture.png')
    appendHiddenField(form, 'image_content', '')
    appendHiddenField(form, 'filename', 'capture.png')
    appendHiddenField(form, 'hl', 'zh-CN')
    appendHiddenField(form, 're', 'df')

    document.body.append(form)
    form.submit()
  } catch (error) {
    showError(error.message || '打开搜图引擎失败')
  }
}

function getEngineLabel (engine) {
  return ENGINE_LABELS[engine] || ENGINE_LABELS.google
}

function appendHiddenField (form, name, value) {
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = name
  input.value = value
  form.append(input)
}

function appendFileField (form, name, blob, fileName) {
  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(new File([blob], fileName, { type: blob.type || 'image/png' }))

  const input = document.createElement('input')
  input.type = 'file'
  input.name = name
  input.files = dataTransfer.files
  input.hidden = true
  form.append(input)
}

async function dataUrlToBlob (dataUrl) {
  const response = await fetch(dataUrl)
  return response.blob()
}

function showError (message) {
  messageElement.textContent = '无法自动跳转到当前目标'
  errorElement.hidden = false
  errorElement.textContent = message
}
