# 截图直达

![插件图标](icons/icon128.png)

截图后立即识图，或一键直达 ChatGPT、DeepSeek、Kimi、Google Lens、Bing、百度识图、Yandex 等常用 AI 与识图页面。

## 功能介绍

- 一键截取当前标签页内容
- 截图后快速跳转到常用识图服务
- 支持直达 ChatGPT、DeepSeek、Kimi 等 AI 页面
- 支持右键菜单和快捷键触发
- 基于 Chrome Extension Manifest V3

## 使用方式

1. 打开 Chrome 或其他兼容 Chromium 的浏览器扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 载入当前目录

默认快捷键为 `Ctrl+Shift+Y`。

## 项目结构

- `manifest.json`: 扩展清单
- `worker-main.js`: 后台 service worker
- `content.js`: 页面内容脚本
- `popup.html` / `popup.js`: 插件弹窗
- `upload.html` / `upload.js`: 上传与中转页
- `chat-launch.html` / `chat-launch.js`: AI 页面跳转入口

## 权限说明

插件会使用以下能力：

- `activeTab`: 获取当前标签页截图
- `contextMenus`: 提供右键菜单入口
- `clipboardWrite`: 便于复制截图或中间结果
- `storage`: 保存用户偏好设置
- `tabs` / `scripting`: 打开目标页面并注入所需脚本

## 支持目标

- ChatGPT
- DeepSeek
- Kimi
- Google Lens
- Bing Visual Search
- 百度识图
- Yandex Images
