# 项目语义地图

思源插件「Zotero 工具栏」：在每个编辑器上方叠一个独立的批注图层，提供画笔、荧光笔、形状、便笺和橡皮。项目基于 Pencil Annotation fork 而来，形状、便笺、拖入链接是本项目新增的部分。

## 分层与依赖方向

```
src/index.ts（插件入口，接思源 API）
  └─ src/overlay/（每个编辑器一个覆盖层：输入、渲染、界面）
       └─ src/engine/（纯 TS 数据与几何，不依赖 DOM 和思源）
```

上层可以依赖下层，下层不能反过来依赖上层。思源 API（`openTab`、`fetchSyncPost`、`Plugin` 存储）只在 [[src/index.ts|插件入口]] 和 [[src/plugin/api.ts|存储读写]] 里调用，再通过 `OverlayDeps` 注入覆盖层，所以覆盖层可以在 [[test/harness.ts|离线测试台]] 里脱离思源运行。

## 主要入口

- **插件入口** [[src/index.ts|index.ts]]：负责生命周期，监听编辑器加载和销毁事件并挂载覆盖层；维护当前工具的配置和会话；做防抖保存和同步合并；提供设置面板，以及注入给覆盖层的思源能力（打开块、按 ID 查标题）。
- **覆盖层** [[src/overlay/overlay.ts|DocOverlay]]：每个编辑器一份，处理指针输入（画笔、形状、橡皮、选择、手势）、Canvas 渲染、块锚定，以及便笺的增删改和拖入。
- **便笺界面** [[src/overlay/notes.ts|NoteLayer]]：负责便笺图标、拖动和弹窗（查看、编辑、改色、删除、链接）。只管 DOM，数据变更通过回调交给 DocOverlay 写入 store。
- **工具栏** [[src/overlay/toolbar.ts|Palette]]：Zotero 式的竖排工具栏和笔形入口按钮。工具栏只放图标，颜色、粗细、形状种类放在颜色点打开的二级面板里，导出、清空、设置放在「⋯」里，最底部的 ≡ 是拖动手柄。

## 数据与核心逻辑

- [[src/engine/types.ts|数据模型]]：`Stroke`、`Note` 和存储载荷 `PencilPayload` 及其序列化。便笺字段 `notes` 是可选的，旧载荷没有这个字段也能读取。
- [[src/engine/store.ts|DocStore]]：单篇文档的内存状态、撤销栈、序列化和同步合并。便笺的新增和删除与笔迹共用 `add`/`remove` 操作；移动、编辑、改色记成 `note` 操作，保存修改前后的状态快照。
- [[src/engine/primitives.ts|形状几何]]：把形状生成为压感均匀的稀疏折线。形状就是一条普通笔迹，选择、橡皮、导出和同步都不需要专门处理。
- [[src/engine/noteText.ts|便笺文本]]：从纯文本中识别块引用、`siyuan://` 链接、Markdown 链接和网址。
- [[src/engine/shapes.ts|手绘吸附]]（原项目）：画笔画完停顿时，把手绘线条识别成规则图形。

## 关键流程

**块锚定**：笔迹和便笺的坐标保存为相对所在块左上角的偏移（`anchor.blockId`）。每次重绘时，`DocOverlay.buildOffsets` 读取块的当前位置再加上偏移，所以正文重排后批注会跟着块走。拖动结束后会重新锚定到落点下的块。触发重绘的来源有三个：正文区域的 `ResizeObserver`、DOM 变动和滚动事件。

**图层与输入**：图层的 DOM 结构从下到上依次是笔迹 Canvas、荧光笔 Canvas、实时 Canvas、捕获层和便笺层。捕获层只在批注模式下接收指针，退出后输入穿透到正文（包括 iframe）。便笺层的图标和弹窗始终可以交互，并会阻止事件冒泡到思源编辑器。

**拖入生成便笺**：拖放监听挂在图层根节点上，只在批注模式下处理。数据来源有两种：文档树的 `application/siyuan-file`（文档 ID），以及块标拖动时把 ID 编码在 MIME 类型名里的 `application/siyuan-gutter…`。标题通过 SQL 查询得到，再生成 `((id '标题'))` 形式的便笺。

**块引用预览**：便笺里的引用链接带 `data-type="block-ref"` 和 `data-id`，悬停预览交给思源的全局浮窗逻辑处理，所以会遵循用户的悬浮窗设置。点击跳转由插件调用 `openTab` 完成。

**持久化**：数据变更后防抖 1.2 秒，写入 `data/storage/petal/siyuan-zotero-toolbar/{docId}.json`。收到同步事件时，按 ID 把远端数据并入当前打开的文档（见 `onDataChanged`）。

## 测试

- 单元测试在 [[test/unit/primitives.test.ts|形状几何]]、[[test/unit/noteText.test.ts|便笺文本]]、[[test/unit/store-notes.test.ts|便笺 store]]，运行 `npm test`（vitest）。
- 端到端测试是 [[scripts/e2e/annotate.mjs|annotate.mjs]]：部署插件到本机工作空间，用 Chrome 打开思源网页端，在一篇含 iframe 动画的文档上验证形状、便笺、链接、拖入、持久化、重排对齐，以及与动画共存。公共工具在 [[scripts/e2e/lib.mjs|lib.mjs]]。这个测试会写入并清理真实工作空间里那篇文档的批注文件。
- [[test/harness.html|离线测试台]]（原项目）：模拟编辑器 DOM，用 `npm run harness` 打开。
