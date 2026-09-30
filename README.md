# Timetipper

一个面向 Windows 的悬浮专注小球。常态只占 88 × 88 像素，显示剩余专注时间；点击展开窄面板，拖动小球或展开面板的标题栏可换位置，右键直达设置。可直接下载 [Timetipper.exe](Timetipper.exe) 运行。

## 功能

- **待办**：快速添加、完成和删除，可设到期时间。到点后即使正在专注，也会立即展开提醒，可完成、知道了或延后 10 分钟。
- **专注**：自定义 1–240 分钟；开始后回到小球，结束后弹出喝水、起身等每日习惯提示。支持暂停、继续和重置。
- **便签**：可新建多张便签，自动保存；旧版的单张便签会自动保留在第一张中。
- **文件入口**：选择待办后，可从资源管理器拖入文件，也可浏览添加。只关联原文件路径，不复制文件；移除入口不会删除原文件。
- **名言**：可使用本地 `.md` 文件或在线直链，每个非空行是一句，15 秒轮换。本地文件每 5 秒重新读取，在线文件每 5 分钟重新读取。
- **开机自启动**：设置页可选，默认关闭。

数据保存在本机 WebView 的应用存储中，不需要账号。应用运行时才能主动提醒；退出程序会停止计时和提醒。

## 开发与构建

需要 Node.js、Rust、Windows C++ Build Tools 和 WebView2 Runtime。

```powershell
npm install
npm run tauri -- dev
npm run tauri -- build --no-bundle
```

便携版可执行文件生成在 `src-tauri\target\release\timetipper.exe`。

## 开源基础与许可

此项目以 [Focus Flow](https://github.com/Lexiang-Xiong/Focus-Flow) 的 Tauri 悬浮窗口项目为基础重构，保留其原生窗口构建结构和图标资源，移除了复杂任务树、统计和 AI 模块。上游提交：`7c5dc2682c223fe67111b5fc31f1db86203a348d`。上游项目声明采用 MIT 许可；见 [ATTRIBUTION.md](ATTRIBUTION.md)。
