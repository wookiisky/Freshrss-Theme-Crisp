# Crisp for FreshRSS

[English](README.md) | [简体中文](README.zh-CN.md)

紧凑、扁平的 FreshRSS 主题，提供 **Crisp Light** 和 **Crisp Dark** 两套固定配色。

## 截图

以下截图使用示例订阅，展示当前样式：首篇文章为当前选中项，第二篇处于悬浮状态，第三篇和第五篇为已读，其余为未读。

### Crisp Light

暖白底色、暖灰文字与橙色强调色。截图使用示例订阅内容。

![Crisp Light 浅色主题截图](Crisp/thumbs/original.png)

### Crisp Dark

墨灰底色、柔和浅色文字与青绿色强调色。截图使用示例订阅内容。

![Crisp Dark 深色主题截图](Crisp-Dark/thumbs/original.png)

## 设计

Crisp 以 FreshRSS 自带的 Flat design 为起点，通过底色、细分隔线与小圆角区分界面层级。
两套主题共用组件样式与布局，分别定义配色，保持阅读和操作体验一致。

- **紧凑列表**：减少订阅列表和文章列表的上下留白，适当增大文字，正文保留舒适行距。
- **合并顶栏**：搜索框与“标记已读”等操作排列在同一栏，窄屏或浏览器放大后自动换行。2px 分隔线清楚划分顶栏与阅读区。
- **简化日期分组**：按接收、发布或修改时间排序时，隐藏日期分组标题和跳转链接，保留文章时间与来源、分类分组。
- **明显的悬浮反馈**：浅色主题使用更深的暖灰底色，深色主题使用更亮的蓝灰底色，覆盖按钮、导航、菜单和文章标题行。
- **选中状态**：导航与当前文章使用选中底色和侧边标记，悬浮时仍保留选中提示。按钮选中仅改变边框颜色，文字、图标和底色保持普通状态的样式；悬浮、按压和键盘焦点仍有独立反馈。
- **阅读状态**：已读与未读文章使用不同底色，保持相同字重。当前文章即使已收藏，仍保留当前位置的强调边线；星标与已读、未读图标各自表达状态。通知等提示继续使用较柔和的背景。
- **控件易辨识**：按钮和输入框使用比分隔线更清楚的边框，按压反馈即时出现；禁用控件保留已有选中标记，同时停止悬停反馈。颜色过渡遵循减少动态效果设置。
- **固定配色**：在 FreshRSS 中选择浅色或深色主题，不随系统颜色偏好变化。
- **支持 RTL**：随主题提供从右向左书写语言所需的样式文件。

## 安装

需要已有的 FreshRSS 安装。本仓库仅包含主题，基础样式与图标由 FreshRSS 提供。

1. 下载本仓库，或使用下面的命令克隆。
2. 将仓库中的 **`Crisp` 和 `Crisp-Dark` 两个目录**复制到 FreshRSS 的 `p/themes/` 目录。
3. 在 FreshRSS 的显示设置中选择 **Crisp Light** 或 **Crisp Dark**。

```sh
git clone https://github.com/wookiisky/Freshrss-Theme-Crisp.git
cp -R Freshrss-Theme-Crisp/Crisp Freshrss-Theme-Crisp/Crisp-Dark /path/to/FreshRSS/p/themes/
```

请将 `/path/to/FreshRSS` 替换为实际安装路径。两个主题目录必须保持原名、位于同一级；
深色主题会从 `Crisp` 目录加载共享的 CSS 和 JavaScript，因此需要一起安装。

## 打包

在仓库根目录运行，需要已安装 Node.js、npm、POSIX shell 和 `zip`（macOS 或 Linux）：

```sh
npm run build
```

命令从当前工作区生成 `dist/freshrss-theme-crisp.zip`，包含尚未提交的修改。压缩包根目录包含 `Crisp/`、`Crisp-Dark/`、中英文 README 和许可证。解压后，将两个主题目录一起复制到 FreshRSS 的 `p/themes/` 目录。

打包包含现有 RTL 样式和缩略图，不重新生成 CSS；开发文件和系统杂文件不会进入压缩包。每次构建都会重新生成并替换旧包，因此已删除的源文件不会残留。打包无需安装 npm 依赖或 FreshRSS。

运行 `npm run test:package` 可检查压缩包内容、重复打包和失败处理；这些测试还需要 `unzip`。

## 文件与测试

- `Crisp/light.css`：浅色配色。
- `Crisp-Dark/dark.css`：深色配色。
- `Crisp/crisp.css` 与 `Crisp/layout.css`：共享组件样式和响应式布局。
- `Crisp/crisp.js`：移动原有工具栏并识别日期排序，保留现有控件与事件处理。
- `*.rtl.css`：生成的 RTL 样式，维护时应从对应 CSS 重新生成。

在仓库根目录使用 Node.js 运行交互与配色测试：

```sh
node --test tests/frontend/*.test.mjs
```

浏览器状态测试另外需要开发依赖、已安装的 Google Chrome 和一份 FreshRSS 源码：

```sh
npm ci
FRESHRSS_ROOT=/path/to/FreshRSS npm run test:browser
```

测试使用 FreshRSS 的实际基础 CSS、图标及代表性的组件结构，覆盖明暗主题和 LTR／RTL 下的选中、未读与收藏组合、禁用、按压、键盘焦点和减少动态效果。缺少 FreshRSS 文件或 Chrome 时会明确失败，不会跳过检查。可通过 `CRISP_BROWSER_CHANNEL` 选择其他已安装的 Playwright 浏览器通道。安装和使用主题不需要这些开发依赖。

## 来源与许可

设计参考 [FreshRSS](https://github.com/FreshRSS/FreshRSS) 的 Flat design 主题。
本仓库保留 FreshRSS 的 GNU AGPL v3 许可证，详见 [LICENSE.txt](LICENSE.txt)。
