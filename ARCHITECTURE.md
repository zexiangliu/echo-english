# 代码结构与维护约定

插件使用普通 JavaScript 和 Chrome MV3，无构建步骤、无运行时 npm 依赖。`manifest.json` 决定内容脚本加载顺序；浏览器通过 `Echo…` 全局对象连接模块，Node 测试使用同一份文件的 CommonJS 导出。

## 模块职责

| 文件 | 职责 |
| --- | --- |
| `extension/models.js` | 独立模型管理弹窗、安装状态刷新与权重删除确认 |
| `karaoke/models.py` | 固定模型注册、校验、续传、隔离依赖安装与取消；不加载 Torch |
| `karaoke/bandit_compat.py` | Intel Mac 旧版 Torch 的局部 eager 构造适配；不修改全局 Torch |
| `karaoke/bandit.py` | BandIt 子进程、共用模型加载与流式窗口拼接 |
| `extension/content.js` | 连接页面、媒体和存储；管理当前视频、练习流程和界面事件 |
| `extension/assembly.js` | 独立拼接弹窗；拆分重叠区间，管理手动版本选择、试听、取消、Blob URL 生命周期与选择持久化回调 |
| `extension/selection.js` | 纯练习领域规则：三种范围校验、字幕身份与录音版本编号、标签、旧范围设置的兼容读取；不读写 DOM、不控制媒体 |
| `extension/recording.js` | 单次录音会话：申请麦克风、准备增益和监听、创建编码器、收集音频、缓冲暂停与恢复、实时音量，以及取消和资源释放；通过回调提交结果 |
| `extension/microphone.js` | 输入设备枚举与采集、固定增益及耳返分支、编码配置、PCM 能力检测、采集参数与详情格式化 |
| `extension/panel-view.js` | Shadow DOM 的静态 HTML/CSS；不读取存储、不控制媒体 |
| `extension/transport.js` | 底部进度滑块、时间显示、跳转事件及其动画帧清理；通过回调读取媒体时钟 |
| `extension/playback.js` | 当前媒体操作的终点检测、超时、可取消等待；替换任务时清理旧调度 |
| `extension/playback-controls.js` | 共用暂停／继续、调速及原曲音量控件的操作归属、等待状态和失效回调隔离；程序触发的恢复等待当前操作结束，不读写练习存储 |
| `extension/reference-playback.js` | 原曲／原声试听的范围、跳转、循环、终点与超时；不处理字幕选择、页面或持久化 |
| `extension/practice.js` | 循环、自动跟读、录音连播顺序、字幕跟随等流程和纯函数 |
| `extension/karaoke.js` | 伴奏覆盖范围、服务状态格式化、耳机监听、演唱回放伴奏同步与 Web Audio 音量 |
| `extension/audio-export.js` | 分段取舍、时间轴对齐、人声与伴奏混合、WAV 导出 |
| `extension/storage.js` | IndexedDB 迁移、练习会话、录音版本与伴奏缓存；跨视频音频体积统计、分类型清理 |
| `extension/library.js` | 独立练习库弹窗：最近视频、搜索、缓存用量、清理确认及关闭生命周期 |
| `extension/caption-tracks.js` | 字幕轨道元数据、页面同源请求、JSON3 时间轴解析和当前轨道查询客户端 |
| `extension/caption-current.js` | MAIN 环境只读桥接，仅返回当前视频选中字幕的语言和轨道标识；不改变播放器 |
| `extension/subtitles.js`、`transcript.js` | 字幕文件解析、YouTube 文字记录读取 |
| `extension/languages.js`、`dictionary.js` | 语言显示策略、英语词典数据整理 |
| `extension/live-meter.js` | 麦克风实时 RMS／峰值、音量变化图、过载提示和分析节点清理 |
| `extension/audio-analysis.js` | 本机波形与低音量停顿分析 |
| `extension/panel-size.js` | 面板尺寸、标题拖动、位置与本机尺寸偏好 |
| `extension/background.js`、`karaoke-relay.js` | 词典与本机伴奏服务请求、跨上下文通信 |
| `karaoke/server.py` | 本机音频下载、去原唱、任务取消与缓存恢复 |

`content.js` 的 `currentPage` 决定主操作区是否展示；配音和唱歌共用一套练习主按钮，位于滚动区之外，录制和播放时由进度与停止操作接替。语言设置归字幕页，下载详情归所选录音。

`content.js` 仍负责协调跨模块的用户操作。新增独立能力时优先扩展对应模块；只有需要当前视频、选中台词或界面状态的连接代码才放在入口中。

## 媒体流程约定

- `generation` 区分用户操作，`videoId` 区分 YouTube 页面。异步返回后先检查所属操作和视频，再更新界面。操作在第一次 await 前建立 generation；`guarded()` 在同步调用后捕获实际归属，不再猜测递增次数。
- `selection.js` 的 `resolve()` 是范围、录音编号和标签的唯一计算入口；配音和唱歌都支持整体 / 段落 / 片段。入口的 `selectedRange()` 只负责读取表单、校验视频上下文并调用领域模块，读取时不再修改表单。自动练习的循环次数、停顿和下一句选项按视频保存，整首及段落禁用逐句推进。
- 每次只运行一个练习媒体操作。停止时通过 `cancelPlayback()` 隐藏进度、取消终点检测和超时、解除等待、暂停音频和伴奏监听；媒体事件监听器由创建它的流程移除。
- `playback.seek()` 统一管理定位事件和超时，停止或替换操作时立即解除监听并结束等待。`playback.watchEnd()` 与 `playback.timeout()` 各自只保留一个任务。跳转后重新设定超时；回放跳回视频终点之前时重新启动终点检测。
- 原曲播放由 `reference-playback.js` 独占媒体范围和计时，改速、拖动和点歌词跳转复用同一套终点与剩余时间检测；超时作为错误结束，避免卡住的视频被循环选项无限重试。
- 暂停／继续和调速统一由 `playback-controls.js` 管理，控件不能自行改变录音状态。旧播放的延迟结果不得改变新播放的按钮或错误提示；暂停时同时冻结播放超时。不同媒体类型只提供暂停、恢复和可选调速回调。
- 淡出默认属于该录音版本的人声；仅当淡出点正好是本次导出终点时才同时淡出伴奏。整首合成中未录人声的尾奏继续保留伴奏，前一段的淡出不影响后面的录音版本。
- 进度显示使用单独的动画帧，不与终点检测共用帧编号。`transport.hide()` 会解除跳转事件并使旧回调失效。
- 片段前置播放可关闭、选择前 N 秒或上一句，按视频存 session；听原声 / 循环 / 自动练习应用前置范围，对比和录音回放保持原范围。录音前置播放使用原声，到起点暂停并精确定位，再启动录音和片段播放；前置阶段停止不保存空录音，所有资源归当前 generation。
- 原声和伴奏试听跟随视频时钟；录音回放跟随录音文件时钟。缓冲恢复时让视频追随录音，避免跳过录音开头。
- 段落录唱通过起句 / 止句选择至少两句连续字幕，边界取首句起点和所选句的最大终点，范围与选句索引按视频保存。所有片段媒体流程复用此范围；段落自动练习不逐句推进。单句浏览不改变段落边界。整首合成默认复用时间轴 plan；拼接弹窗按全部可用 1× 版本的边界拆分非重叠时段，用户可选版本或排除人声。显式 selectionPlan 校验范围、来源覆盖和非重叠条件，render 不再将手选旧版本重新归并成最新。行试听按 origin 裁出时段，整首试听及下载保持同一选择和回听音量快照；未选位置保留空白。
- 唱歌模式只显示主录唱入口，歌词点选及上下句选择通过 `select(..., true)` 切换当前片段；循环和自动练习独立折叠。录音参考音由练习设置决定，关闭时主按钮可清唱，所有唱歌模式录音都标记为 `kind: song`。
- 回声消除和自动增益按配音 / 唱歌分别保存用户选择，默认配音开启、唱歌关闭；唱歌始终关闭降噪。自动增益关闭时可应用 0–24 dB 固定输入增益，开启时旁路手动增益，保留其数值。所有录音入口使用同一策略，与是否监听伴奏无关。
- 前置播放开始即进入录音布局并显示实时音量，正式录音复用同一分析实例；没有前置播放时在录音启动后旁路创建分析，不等待分析用 AudioContext；音量分析节点始终不连接扬声器。MediaRecorder 和音量分析接收同一录音输入：0 dB 时为原始麦克风流，正增益时为放大后的 MediaStreamDestination 流。增益图在录音启动前准备好，停止后与原始麦克风一起释放，保存录音增益元数据。缓冲跟随录音暂停，停止、错误、导航和自然结束时释放分析节点、AudioContext 和动画帧。
- 输入设备 ID 保存在本地麦克风偏好，所有录音与自动练习的授权预检共用 `microphoneConstraints()` 和 `requestStream()`，指定设备使用 exact 约束，丢失时不静默回退。设备枚举不自动请求权限；显式检测仅短暂打开系统默认麦克风并立即释放，监听 devicechange 更新列表。
- 可选耳返默认关闭，低延迟采集请求只在开启时加入。`microphone.createInput()` 将耳返与固定增益放在同一个交互式 AudioContext；0 dB 保留原始录音流，正增益使用原有编码分支，单独的耳返 GainNode 只接扬声器。录音会话在 start / pause / resume / stop 中控制耳返，编码器停止回调前即静音；耳返音量不进入编码分支。实时音量分析仍有独立的旁路上下文，不阻塞录音启动。
- 耳返默认采用更低延迟模式，仅在耳返开启时请求 `latencyHint: 0`；保留标准兼容模式 `latencyHint: 'interactive'`。有合法已存模式时保持原选择，不强制改变采样率或麦克风处理偏好。输入 `getSettings().latency`、`baseLatency` 和 `outputLatency` 分开显示、保存在录音元数据；缺失或非法值为 null，不生成误导性的总往返延迟。停止时在释放上下文前读取最新估计。
- 所有模式均只录麦克风，伴奏仅监听。完成输入准备及精确定位后，统一先启动录音器再启动视频和伴奏，避免视频启动时间吃掉录音开头；`vocalOffset` 保存预录偏移，用于回放和混合对齐。修改这里需覆盖开头、缓冲、停止和导航场景。
- `recording.js` 中的每个会话只管理自己的麦克风、增益图、编码器、音量分析和伴奏监听；停止后才返回的资源立即释放。单次停止只提交一次结果，资源清理幂等，过期错误不再影响后续会话。视频时钟、播放进度和字幕由入口协调，存储不放进录音模块。
- 开始申请权限前生成不可变的范围和录音身份快照。主录音与自动练习使用同一编号规则，字幕边界微调仍作为该句的新版本。`saveRecording()` 始终保存到开始录制时的视频；只有当前会话仍拥有界面时才发布结果。切页时解除旧会话的界面归属，因此 A → B → A 后的旧停止回调也不能覆盖新录音。历史查询同时检查请求序号。
- 独立人声演唱回放通过 `EchoKaraoke.followRecording()` 将伴奏绑定到录音时钟，扣除 `vocalOffset` 后定位，不修改人声播放位置。同步器负责伴奏漂移校正、缓冲、开关和清理；旧版混合录音不进入此流程。
- 回听音量使用独立的 `replayVocalVolume`、`replayBackingVolume`，与录唱监听的 `backingVolume` 分开，按视频写入 session。`createAudioOutput()` 用 Web Audio 增益控制人声，停止和结束时幂等释放；不支持时回退到 HTML 音量并显示 100% 上限。
- 下载混合与分段合成使用回听的独立人声、伴奏增益，在本机浏览器执行。旧版混合录音不能当作独立人声再次叠加伴奏。

## 字幕轨道

`captionClient` 在 YouTube 页的内容脚本中发起同源请求，只接受当前 `/watch?v=…` 视频的 `list/read`，固定访问 YouTube player 及其返回的同视频 timedtext URL；不接受调用者传入 URL，不携带账号凭据，不读取 Cookie。扩展后台不参与字幕请求，避免扩展 Origin 被 YouTube 拒绝。请求归属规则见 [Chrome 同源请求文档](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)。元数据缓存 5 分钟，上限 24 个视频，轨道读取保留简繁体标识；`fmt` 使用替换而不是追加，避免已有 `srv3` 覆盖 `json3`。

签名字幕地址返回 403 时刷新元数据并按原轨道重试一次，不对 429 自动重试。错误提示包含请求阶段与 HTTP 状态。

MAIN 只读桥接使用单次请求标识与当前视频校验，仅传回字幕身份；无网络或扩展特权。读取结果仍按 `generation` 和视频归属校验。字幕选择与已加载来源分开保存；失败、停止时不覆盖旧歌词；切换来源不删除录音。接口是 YouTube 非公开实现，需要持续维护；Android 客户端配置参考 youtube-transcript-api 上游。

## 验证

```bash
npm ci
npm test
python3 -m unittest discover -s karaoke -p test_server.py
```

`tests/session-ui.test.cjs` 用实际界面事件、模拟媒体和 IndexedDB 验证跨模块流程。`tests/playback.test.cjs` 和 `tests/transport.test.cjs` 使用可控时钟验证停止、替换调度、拖动进度及旧异步回调；同时检查浏览器按 manifest 顺序加载模块。

自动测试不访问真实麦克风或 YouTube。改动媒体启动、缓冲和音频同步后，仍需在已加载扩展的 Chrome 中实测。更新脚本列表后要重新加载扩展并刷新视频页；单独刷新页面不能替换旧的扩展注册信息。

`tests/extension-wiring.test.cjs` 实际按 manifest 顺序执行模块，检查入口依赖、重复加载和主界面控件 ID。`tests/playback-controls.test.cjs` 单独覆盖异步暂停／继续、重复点击和旧播放失败；跨模块录音／回放行为继续由 `session-ui` 测试验证。


## 练习库与面板位置

练习库使用原生 dialog，录音／播放忙碌时禁用入口；Escape 先取消清理确认，再关闭弹窗。导航、扩展开关或关闭面板会退出弹窗，避免页面残留模态锁定。清理成功后重新查询当前视频的录音和伴奏，清除过期撤销引用。

`storage.library()` 在同一个只读事务中游标汇总 sessions、recordings、backings，只返回标题、时间、数量、Blob.size 等元数据，不返回音频。`clearMedia()` 仅允许 recordings/backings，支持按视频删除；会话与字幕不删除。无需数据库版本升级。标题与活动模式随 session 保存。

`panel-size.js` 统一管理位置和尺寸；位置存在 `echo-panel-position-v1`，尺寸沿用原 key。移动标题和缩放手柄分别捕获指针；ResizeObserver 和窗口 resize 约束可见位置，保留用户偏好。位置归位与尺寸重置独立。

拼接弹窗使用独立 revision 取消生成，停止 / 关闭 / 页面切换使 active 失效；异步返回后不再播放或下载。预览 URL 在选择改变、重新生成及关闭时撤销；打开时暂停原视频。selection 按视频随 session 保存，缺失录音重新采用可用的默认版本，排除选择继续保留。全局 mode=assembly 阻止主面板启动其他媒体操作。


## 兼容边界与界面状态

新会话保存 `scopes: {speech, sing}`。`selection.restoreScopes()` 集中读取旧的 `speechScope` / `karaokeScope`，旧配音默认为片段，旧唱歌选择继续保留；界面统一使用 `practiceScope`，业务代码不再以唱歌字段处理配音。IndexedDB 仍为 v4，录音、字幕编号格式与旧 Blob 保持可读；`storage.cueKey` 是领域编号函数的兼容导出。历史数据迁移与用户界面分离。

`renderPracticeActions()` 独占主按钮文案，`controls()` 管理显示与禁用，`renderActivity()` 更新活动页标题；伴奏设置不再反向改写主按钮。折叠偏好通过独立 toggle 监听器保存，不包装或覆盖字幕加载、波形分析自己的处理函数。

本轮回归重点：正常录唱与自动练唱的版本一致性、三种范围与旧会话恢复、暂停缓冲、前置取消、权限／增益／监听的迟到结果、编码器初始化失败、跨页面迟到的录音停止、Opus 与原生 PCM 录制，以及监听加载失败后的资源清理。浏览器检查使用隔离页面和合成音源，不替代真实设备和 YouTube 网络环境的实机验证。

## 配音与唱歌共用背景音

配音的「保留背景音」默认关闭，`backingPreferences` 按视频分别记住 speech / sing 的选择。`usesBacking()` 表示当前是否监听，`hasBackingTools()` 决定是否展示准备入口；两种活动调用相同的生成、缓存恢复、取消、试听与录音函数。没有第二套电影录音流程，麦克风处理仍按活动选择原有偏好。

录音始终是独立人声。监听时保存 `backingKey` / `backingModel`，回听和单段混合下载通过 `EchoKaraoke.backingForTake()` 选择相同模型、覆盖录音范围的背景；普通配音没有背景关联时不自动叠加缓存。旧歌曲录音和旧缓存保持兼容；未标注模型的缓存视为 `demucs-htdemucs`，未来模型的缓存 key 与覆盖检查均区分模型。本轮正式服务仍只有 Demucs，后续增加引擎时还需明确扩展服务协议与模型校验。

`audio-export.js` 的纯人声时间轴与混音器不再限制歌曲类型，供配音单段与歌曲导出共用。歌曲整首合成入口先按活动过滤录音，避免把同视频的普通配音拼进演唱。开关关闭或切换活动时，使未完成的缓存恢复请求失效；显式生成仍由 generation 管理取消和过期结果。

## 模型生命周期

`Jobs` 与 `ModelManager` 共用锁，只能有一个安装或分离任务；管理接口在锁内拒绝与音频任务冲突的操作。安装在后台线程运行，HTTP 立即返回，取消复用事件与工作子进程树清理。就绪状态来自权重 SHA-256、固定源码版本与成功构造模型并严格载入权重后的依赖标记，不能由扩展写入。权重原子下载，`.part` 断点续传；额外依赖通过临时目录安装并检查后发布，基础环境保持独立。

Demucs 缓存沿用旧 key，只有非默认模型增加 model 字段参与 key；服务元数据与浏览器音频均保存 model；BandIt 使用 v2 元数据，使旧版服务跳过其结果，避免降级后误读为 Demucs。录音的 backingModel 决定回听、导出所用背景音，不追随用户后来切换的模型。下载、转换、压缩、缓存、取消与 GPU 失败回退共用 Jobs 流程，BandIt 仅替换模型工作命令与输入采样率。

## 背景音音质与传输

`quality` 仅允许 standard / lossless；默认值不参与旧缓存 key，lossless 使用独立 key 和 v3 服务元数据。缓存列表默认仅返回标准音质，无损需显式 quality 查询，防止旧扩展把 FLAC 当成默认缓存。`Jobs.audio_path`、`audio_mime`、`encode_audio` 统一决定扩展名、MIME 与编码，两种分离模型共用。无损分离链路保留浮点中间文件，最终编码 24 位 FLAC。

`EchoKaraoke.qualityOf`、`covers` 与 `backingForTake` 统一匹配录音的 backingQuality。`fetchAudio` 按 1 MiB 请求分块，验证连续位置、固定总长度与 MIME，保存为不可变 Blob 分块后组装，避免在 Chrome 消息中传递整个大文件。后台 relay 只能请求固定音频路径和固定分块上限，服务只读已完成任务的指定字节范围；取消和页面切换通过 active 回调丢弃过期返回。

伴奏生成与试听统一在设置弹窗的 `backing` 分类；`backingOptions` 为模型与音质的次级页面，不再提供独立的主界面调整入口。服务状态、首次安装说明和模型管理直接显示在主伴奏页。次级页面往返保留生成范围，录音缺少伴奏时也打开同一入口。

备份单个视频时，`storage.snapshot()` 通过对象主键或 `videoId` 索引限定读取；不包含伴奏时跳过该存储查询。自定义导出只在所选终点确实等于录音实际终点时应用整体淡出，截在录音中间不会额外引入淡出。

录唱跳过纯伴奏不压缩录音时间轴：`practice.lyricSkip()` 根据歌词时间与范围判断能否跳转；入口先结束并保存当前人声片段，再以独立的范围快照从下一句启动录音。首次开唱前的片段丢弃；保存期间保持操作归属检查，失败或取消不会继续启动麦克风。续录复用 `record()`、伴奏监听、版本存储和合成逻辑，不增加音频格式或时间映射。歌词筛选在开始录音时限定到该范围，实时更新只查询这部分字幕。

伴奏升降调由 `backing-pitch.js` 统一处理，试听、录音监听、回听与导出共用 SoundTouch 封装。录音保存捕获时的调性，原曲参考和清唱也记录所选练习调性；干人声不变调。合成根据实际选中且在导出范围内的版本检查调性一致性，再对整段伴奏处理一次，避免按版本边界硬切。`vocal-effects.js` 的同步／异步 WAV 编码共用同一分块编码器；异步路径与 DSP 共用可释放的 MessageChannel 调度器，分块间检查取消。

`original-audio.js` 为非零调性准备独立原声音轨，并提供与原生视频相同的传输接口；原生 YouTube 视频始终作为时间轴，暂停、缓冲、定位、速度和音量保持同步。0 半音保留原生播放路径。原声任务复用服务 `source=original` 的下载和转换步骤，跳过模型检查与人声分离；缓存与伴奏隔离。扩展只保留最近一份原声，切换视频时释放，重用现有变调和编码模块。无需将 YouTube 视频永久绑定到 Web Audio 图。
