# 本机伴奏与电影背景音（试验功能）

配音和唱歌共用同一个本机分离服务，无需第二个插件或服务。Demucs 用于歌曲伴奏，也可提取电影背景音；电影配音还可选择安装 BandIt，模型配置与许可见下方「模型管理」。录音参考音在「练习设置」中选择。

练习页选择「唱歌曲 · 伴奏监听」，点击「准备伴奏」，在展开的「伴奏设置」中生成整首或片段伴奏。扩展把当前视频编号与生成范围（默认整首）交给本机服务；服务用 yt-dlp 提取所选音频，再用 Demucs `htdemucs` 分离原唱与伴奏。伴奏压缩为 192 kbps MP3 后传回浏览器，10 分钟约 14.4 MB，避免长歌曲的 WAV 超出扩展消息大小限制。无需上传伴奏文件，也不使用付费分离 API。

## 安装一次

推荐安装并启动（在项目目录执行）：

```bash
bash start-karaoke.sh
```

首次运行会检查 Python 3.10–3.12、FFmpeg，创建 `.venv`，安装分离依赖，再启动服务。以后运行同一命令会复用环境。缺少 JS 运行时会下载经 SHA-256 校验的项目专用 Node.js 22 到 `.cache/node/`，不覆盖系统 Node。模型仍在首次生成时下载。下载中断或安装失败后可重新运行。

支持 Linux x86_64（系统组件自动安装使用 apt，可能要求 sudo 密码）；macOS Intel / Apple 芯片使用已有 Homebrew 安装缺少的系统组件，双架构安装与分离的持续验证见 [Mac CI](https://github.com/zexiangliu/echo-english/actions/workflows/macos.yml)。其他 Linux 发行版请自行安装缺少的 Python / FFmpeg。Windows 使用下方 PowerShell 入口；服务不是浏览器内自动安装。安装包可能占约 1–2 GB，需联网下载；服务启动后保持终端开启，Ctrl+C 停止。脚本可从任意目录调用其完整路径。

### Windows x64

先准备 x64 Python 3.10–3.12（含 pip 和 Python launcher）、FFmpeg（`ffmpeg` / `ffprobe` 加入 PATH）、Node.js 22+ 或 Deno。重新打开 PowerShell，在项目根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-karaoke.ps1
```

脚本只为本次进程设置执行策略，创建 `.venv\Scripts\python.exe`、安装 CPU 依赖并启动。后续运行复用环境，不需要激活 venv；缺少系统组件时会提示，不自动安装系统组件。代码已适配，尚待 Windows 实机验证。

不要复制其他机器的 `.venv` 或 `.cache/node`。macOS Apple 芯片应使用原生 arm64 Python；Intel Mac 自动选 torch / torchaudio 2.2.2，Apple 芯片用 2.6.0，Linux / Windows 用 2.5.1。详见 [跨平台验证与 agent 交接](../PLATFORM_SUPPORT.md)。

### 手动安装（Linux）

以下命令在仓库根目录运行，适用于 Linux x86_64、Python 3.10–3.12。需要 FFmpeg（含 ffprobe）和 Node.js 22 或 Deno；这些工具须在启动服务的终端 PATH 中。

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchaudio==2.5.1
.venv/bin/python -m pip install -r karaoke/requirements.txt
```

若 Ubuntu 提示缺少 ensurepip，可安装系统的 python3-venv，或者使用系统 pip 管理一个无 pip 的虚拟环境：

```bash
python3 -m venv --without-pip .venv
python3 -m pip --python .venv/bin/python install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchaudio==2.5.1
python3 -m pip --python .venv/bin/python install -r karaoke/requirements.txt
```

Mac 推荐直接使用根目录脚本；手动安装时用本机 Python 创建 venv，再安装 `karaoke/requirements.txt`，平台标记会选择对应的 PyTorch 版本。macOS 15 的两种架构已通过原生 CI 安装与分离验证，音频设备与 Chrome 录音仍需人工试听；Windows 尚待实机验证。Linux / Windows 默认安装 CPU 版依赖；Mac 标准包包含 MPS 支持。

依赖参考：[Demucs](https://github.com/facebookresearch/demucs)、[yt-dlp 安装](https://github.com/yt-dlp/yt-dlp/wiki/Installation)、[YouTube JS runtime](https://github.com/yt-dlp/yt-dlp/wiki/EJS)。

### 可选：NVIDIA GPU 加速

先完成普通安装并按 Ctrl+C 停止服务。有兼容 NVIDIA GPU 和驱动的 Linux x86_64 / Windows x64 用户，可将项目环境升级为 CUDA 12.1 版 PyTorch。以下版本与项目现有依赖匹配，来自 [PyTorch 官方安装表](https://pytorch.org/get-started/previous-versions/#v251)；不需要单独安装 CUDA Toolkit，但需要可用的 NVIDIA 驱动。很新的 GPU 可能不受这组固定版本支持，应先检查启动时的设备检测结果。

Linux：

```bash
.venv/bin/python -m pip install --upgrade --index-url https://download.pytorch.org/whl/cu121 torch==2.5.1 torchaudio==2.5.1
bash start-karaoke.sh
```

Windows PowerShell（代码适配，尚待实机验证）：

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade --index-url https://download.pytorch.org/whl/cu121 torch==2.5.1 torchaudio==2.5.1
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-karaoke.ps1
```

CUDA 环境明显大于 CPU 版，建议至少预留 10 GB 磁盘空间。后续普通启动与依赖更新会保留兼容的 CUDA 安装，不改回 CPU。服务默认 `--device auto`：实际运行一个 CUDA 小运算确认可用后选择 GPU；不支持时使用 CPU。自动模式分离过程中遇到显存不足等 CUDA 运行错误，会释放子进程后仅重试一次 CPU，界面显示回退原因。模型、4 秒分段和缓存身份均保持一致，歌曲与电影背景音共用加速。

终端显示设备名称；扩展的现有服务状态显示「GPU 加速」或「CPU」，生成进度显示实际使用的设备。需要排查时可指定 `bash start-karaoke.sh --device cpu`；`--device cuda` 则要求 GPU 可用，失败时报错，不静默回退。Windows 在上述启动命令末尾加同样参数。Apple 芯片 Mac 自动检测 MPS，详见下方 Apple GPU 说明；Intel Mac 保留 CPU。安装脚本支持系统 Bash 3.2，并检查 Python / venv 与当前终端架构一致，架构不一致时会提示重建环境。

实际处理耗时取决于素材、模型、设备和是否需要首次下载。GPU 可加速分离，但不能保证所有歌曲或电影片段的处理速度；BandIt 的资源需求与设备支持见下方「模型管理」。

### Apple 芯片 Mac：MPS 加速

重新运行一键启动脚本会将 Apple 芯片的 PyTorch / TorchAudio 自动更新到 2.6.0，以修复旧版 MPS 卷积维度限制；无需手动安装 CUDA。默认 `bash start-karaoke.sh` 在原生 arm64 环境探测 MPS，并实际运行一个 GPU 小运算；可用时服务状态显示「GPU 加速」，悬停显示 Apple GPU（MPS）。Intel / Rosetta 环境继续使用 CPU。

```bash
# 自动选择；GPU 算子不支持或内存不足时仅重试一次 CPU
bash start-karaoke.sh
# 严格使用 MPS；不可用或处理失败会报错，不静默回退
bash start-karaoke.sh --device mps
# 兼容性排查，或比较速度
bash start-karaoke.sh --device cpu
```

歌曲伴奏和电影背景音共用这一条 Demucs 路径。Demucs 4.0.1 自带 MPS 处理：部分复数 / 频谱操作仍在 CPU 上执行，因此不能直接套用 NVIDIA 的加速倍数。参见 [官方发布说明](https://github.com/facebookresearch/demucs/blob/main/docs/release.md)。MPS 可用性依赖 Mac、系统及原生 PyTorch 环境；CI 只在实际有可用 MPS 时验证 GPU 推理。原生 Mac CI 已完成显式 MPS 的 20 秒合成音频分离：CPU 79.00 秒、MPS 35.21 秒（约 2.24×，含载入和写出，未发生整项 CPU 回退）。共享 CI 的单次结果不代表所有 Mac / 素材的速度或音质，长片段与 BandIt 尚未验证，复现命令见 [跨平台验证](../PLATFORM_SUPPORT.md#mps-验证范围)。

## 每次使用

在项目根目录运行（与首次安装相同）：

```bash
bash start-karaoke.sh
```

Windows 每次使用与首次相同的 PowerShell 命令。macOS / Linux 已配置好环境时，也可使用 `bash karaoke/start.sh` 直接启动，跳过安装检查。

保持该终端运行；Ctrl+C 停止服务。它只监听 `127.0.0.1:8765`，不会监听局域网接口。更新扩展后在 `chrome://extensions` 重新加载，再刷新 YouTube 页面；扩展新增了这个回环地址的访问权限。

进入唱歌模式会自动检测服务；未连接时展开启动说明。启动服务后点击「重新检测」，连接成功会收起说明。检测本身不会下载模型或生成伴奏。

1. 练习页默认是「说对白 · 配音跟读」，不显示或启用伴奏功能，也不要求运行本机服务。要唱歌时，在顶部主动切换到「唱歌曲 · 伴奏监听」，无需先导入台词。默认范围为「整首歌曲」，最长 10 分钟。长视频可切到「当前练习片段」，设置歌曲起止时间。
2. 点「生成整首伴奏」。首次运行需要联网下载约 80 MB 的模型；按本机短片段测量粗略推算，3 分钟歌曲可能需约 5–8 分钟，尚未做整曲实测。生成期间会显示阶段、已用时间；去原唱阶段提供模型的真实百分比和该阶段预计剩余时间，每约 1.5 秒刷新。提取音频、加载模型和压缩等阶段显示等待动画，不提供虚构的总进度百分比。生成完会等待你操作，不会自动打开麦克风或开始录唱。
3. 若希望自动翻歌词，先读取视频台词或导入带时间轴的字幕。录唱时会跟随视频显示当前句、淡化上下句，并提前预告下一句；生成伴奏本身不会生成歌词。点「试听伴奏」，调整伴奏音量。戴耳机，回到顶部主区，点「开始整首录唱」，自动从视频开头录到结尾。当前字幕句子和配音片段不会被覆盖。
4. 录完可在底部「回听」；再次点录音保留之前的版本，每个范围最多三个版本。「录音」页集中切换版本、下载和分段合成。最近录音和伴奏可在页面刷新后恢复。
5. 如需逐句或多句练习，在主区切换「当前片段」或「段落（多句）」，选定字幕范围；唱歌模式可复用覆盖该范围的伴奏，无需为每句重新生成。切回「说对白 · 配音跟读」会关闭伴奏；配音与唱歌都支持三种范围，各自记住选择。

视频原音轨在录唱时静音，只播放分离的伴奏；麦克风不实时返听。新录音的 WebM 仅包含麦克风人声，伴奏仅用于耳机监听。下载时可选原始人声或人声＋伴奏 WAV；「录音 → 分段合成整首」可将各段按时间轴拼成整首人声或带完整伴奏的成品。合成暂支持 1×、最长 10 分钟，空白段保留人声静音，重叠片段可在合成界面回放、选择版本，导出前确认选段。混合导出需要浏览器中缓存有覆盖范围的伴奏，不要求本机服务在线；缓存丢失时需重新生成伴奏。旧版混合 WebM 仍可原样下载，无法直接变成纯人声。

生成范围与录唱范围分开：整首伴奏可用于它覆盖的任意片段，试听与录音会自动定位到对应时间。仅为片段生成的伴奏不能用于它以外的范围。

伴奏生成后会存入浏览器 IndexedDB，刷新页面会自动读取，不要求伴奏服务在线。进入唱歌模式即可使用已恢复的伴奏。本机服务也会在完成后保存音频与恢复信息，重启服务不再清空已完成伴奏；浏览器没有缓存时，进入唱歌模式会查询本机已有结果并自动取回，不重新运行模型。普通配音模式不会发起这个查询。

浏览器和服务分别保留最近八份伴奏，超出时淘汰较旧缓存；清理网站数据会删除浏览器副本，手动删除服务缓存会删除服务副本。写入失败时会提示，不能把未保存成功的结果视为持久保存。停止、关闭面板或切换视频会请求取消正在执行的分离任务；未完成任务不作为可恢复的伴奏。

## 电影配音

「说对白 · 配音跟读」中默认不启用背景音。选好范围，勾选「保留背景音（电影配音，可选）」，在展开的背景音设置中提取、试听，然后使用原来的录音按钮。后台处理、进度、取消和缓存与唱歌完全共用；相同视频、范围和 Demucs 模型可复用同一份结果。

监听背景音时仍只录麦克风人声；回听和混合 WAV 下载才叠加背景，可分别调节音量，混合下载暂支持 1×。配音保留自己的回声消除、自动增益和手动增益偏好。选项按视频保存，配音与唱歌分别记忆；未开启时不检测服务或查找服务缓存。已录制的带背景配音可在回听区单独关闭背景。

Demucs 原为音乐分离模型，可能残留对白或误删环境音；此功能不是单角色对白替换。最长范围沿用 10 分钟，建议从短片段试听开始。可在模型管理中安装 BandIt 后对比同一片段，按实际效果选择。

## 资源与数据

- 不需要独立显卡，也不需要安装 CUDA。建议整机内存 8 GB 起步、16 GB 更宽裕，磁盘至少预留 5 GB；这是配置建议，未做最低配置测试，长录音与缓存还需另留空间。插件本身不需要 Python 或分离模型，详见项目首页的 [所需配置](../README.md#所需配置)。
- Linux / Windows 默认安装 CPU 版依赖，Mac 标准包包含 MPS 支持；服务自动检测可用 CUDA / Apple MPS，也可强制 CPU。两个 CPU 线程、4 秒模型分段、单任务；`--shifts 0` 减少重复推理。
- 本机 i7-1165G7 / 16 GB RAM 测试：15 秒音乐片段约 35 秒，分离进程内存峰值约 1.5 GiB（包含首次模型下载与载入）。这不是对其他机器或长片段的保证；更短的片段也有模型载入开销。
- 本次 Linux CPU 环境约 953 MB，模型约 80 MB，此外会占用片段缓存空间。生成伴奏时会联网访问 YouTube 和模型下载地址；麦克风录音留在浏览器 IndexedDB，不会发给本机分离服务或第三方。
- 伴奏、恢复信息与日志放在仓库 `.cache/karaoke/`；模型在 `.cache/torch/`。失败详情查看对应任务目录的 `worker.log`。这些目录和 `.venv/` 均被 Git 忽略。
- 本机请求使用专用请求头，不开放网站 CORS，也不支持任意 URL、任意文件路径或任意命令执行。

## 限制与验证

这不是实时消人声。分离可能残留原唱、混响或损失部分乐器；只有伴奏输出也仍需完成整套模型推理。需要登录、年龄/地区限制的视频可能无法提取；不会自动读取浏览器登录 Cookie。遇到下载失败可先更新 yt-dlp（仍需保留配套 EJS 依赖）：

```bash
.venv/bin/python -m pip install -U 'yt-dlp[default]'
```

练习时不要手动拖动 YouTube 进度条。生成伴奏与混音录音由独立音轨同步，尚非逐样本对齐；卡顿时暂停伴奏和录音，恢复播放时按视频位置重同步。逐句自动跟读可复用整首伴奏；下一句超出已生成伴奏的范围时停止。

自动化验证包含参数限制、后台中转、生成/取消/错误状态、片段缓存、音频传输、混音连接、混合音轨保存。已实跑 CPU 分离，以及公开 YouTube 视频 0–5 秒的提取与分离，输出 5 秒 WAV（随后增加 MP3 压缩传输）。音乐性能样本来自 [PyTorch 教程](https://docs.pytorch.org/audio/2.5.0/tutorials/hybrid_demucs_tutorial.html) 的 A Classic Education / NightOwl（MedleyDB，CC BY-NC-SA 4.0），样本与结果不提交到仓库。另用独立的无头 Chrome 实测 Web Audio + MediaRecorder 混音，产生了可解码的 2.46 秒立体声 WebM（麦克风以合成信号代替）。真实 Chrome / YouTube / 麦克风的完整人工演唱流程仍需试听验证。

```bash
npm test
python3 -m unittest discover -s karaoke -p 'test_*.py'
```

## 点击生成没有进度

伴奏服务必须运行在使用插件的同一台电脑上，地址固定为 `127.0.0.1:8765`。GitHub 只同步代码，不同步 Python 虚拟环境、模型缓存或运行中的服务。从另一台电脑拉取项目后，在项目根目录运行 `bash start-karaoke.sh`，Windows 使用上方 PowerShell 命令，安装依赖并启动服务。更新服务代码后，需在旧终端按 Ctrl+C，再重新启动服务；只刷新浏览器不会更新运行中的 Python 进程。

生成失败原因会保留在生成按钮下方。超过 10 分钟的视频请改选「当前练习片段」。

Apple 芯片固定使用 PyTorch / TorchAudio 2.6.0，以修复 [2.5.1 的 MPS 卷积限制](https://github.com/pytorch/pytorch/issues/152278)；旧版错误建议的 `PYTORCH_ENABLE_MPS_FALLBACK=1` 无法解决该问题，因此项目不依赖这一开关。统一分离入口继续调用原版 Demucs；为兼容新版 weights-only 模型加载，只允许官方 `htdemucs` 权重所需的模型类、Fraction 与 NumPy 元数据类型，不关闭新版加载保护。Intel Mac 2.2.2 保留原有加载方式。

## 在扩展中安装与管理模型（0.22.0）

先运行项目根目录启动脚本；扩展不会安装 Python 或启动本机服务。旧服务需在原终端按 Ctrl+C 后重新启动，新扩展需重新加载并刷新 YouTube。

在「伴奏设置／背景音设置」选择处理方式。歌曲默认 Demucs，电影背景音可选择 BandIt v2 multi-language；配音、唱歌的选择按视频分别保存，歌曲保留 Demucs。尚未安装时主按钮为「安装并提取」，完成安装后继续原有音频提取流程。安装、下载、校验和分离共用一个进度区；停止可以取消安装子进程或下载，下次可继续未完成的权重下载。

「管理模型」是独立弹窗，显示是否就绪、权重大小、设备、许可、错误与额外依赖占用。支持单独安装、重试和删除权重（删除前确认）。删除权重不会删除生成结果、浏览器缓存或人声录音；BandIt 的源码和额外依赖暂时保留。安装和分离互斥，普通配音及已有音频回听不受影响。

| 模型 | 用途 | 模型权重 | 额外依赖 | 设备 |
| --- | --- | --- | --- | --- |
| Demucs htdemucs | 歌曲伴奏；通用背景音 | 80.2 MiB | 复用基础环境 | CPU / NVIDIA CUDA / Apple MPS |
| BandIt v2 multi-language | 电影对白与音乐、音效分离 | 426 MiB | 约 363 MiB（文件系统占用约 381 MiB，因平台而异） | CPU / NVIDIA CUDA；Mac 暂用 CPU |

BandIt 建议额外预留 2 GiB（含下载、安装临时文件和处理中间音频），整机建议 16 GiB RAM。不是歌曲分离质量升级的保证；电影结果也可能残留对白或损失音效。支持与 Demucs 相同的最长 10 分钟，采用 8 秒窗口 / 4 秒重叠、单窗口推理及流式拼接，避免整段预测留在显存。CPU 处理可能很慢；Demucs 分离超时为一小时，BandIt 为两小时。显式 `--device mps` 不适用于 BandIt，请使用 `auto` 或 `cpu`；`auto` 下 Mac 的 BandIt 使用 CPU，Demucs 仍可使用 MPS。

模型、依赖由 Python 服务执行固定来源安装，扩展不能指定下载地址、包名或文件路径：

- Demucs 权重：`.cache/torch/hub/checkpoints/955717e8-8726e21a.th`，SHA-256 `8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4`。
- BandIt 权重：`.cache/models/bandit-v2-multi/checkpoint.ckpt`，SHA-256 `abcfccf65446752a057f4a302c941479a54b7560ebf8d7bca039d2ea98e64cfc`；来自 [作者发布的 Zenodo 模型](https://zenodo.org/records/12701995)，权重 CC BY-SA 4.0。
- BandIt 源码：`.cache/models/bandit-v2-multi/source`，固定 [官方仓库提交 d5563d9](https://github.com/kwatcharasupat/bandit-v2/tree/d5563d9031e95fdaa3e5a73d5020b9a0df61adb6)，Apache 2.0，下载压缩包同样校验 SHA-256。曾运行实验的电脑会将已校验的实验权重移动至正式路径，避免重复下载；实验依赖仍保留。
- 额外依赖：`.cache/models/bandit-deps`；按 `karaoke/bandit-requirements.txt` 用 pip `--target --no-deps` 安装在独立目录，仅 BandIt 工作子进程加入搜索路径，不升级基础 PyTorch / TorchAudio。安装后实际构造模型、校验并严格加载权重，成功后才原子发布就绪标记。Intel Mac 的 PyTorch 2.2 / Python 3.12 会在处理上游 `compile(disable=True)` 时先报版本不支持；`bandit_compat.py` 仅在模型构造期间对三个 BandIt 模块提供显式禁用编译的恒等适配，不改写全局 PyTorch 或上游源码。
- 安装日志：`.cache/models/logs/<模型编号>/worker.log`；「安装并提取」的安装日志与该次音频任务共用 `.cache/karaoke/<任务编号>/worker.log`。

旧 Demucs 缓存继续有效，BandIt 结果使用独立缓存标识，录音保存所用模型，回听和导出不会误用另一个模型的背景音。已有录音不会因切换模型而重新处理。

开发验证（不访问 YouTube、不申请麦克风）：

```bash
.venv/bin/python karaoke/smoke_test.py --model bandit-v2-multi --device cpu --seconds 2
# NVIDIA GPU：
.venv/bin/python karaoke/smoke_test.py --model bandit-v2-multi --device cuda --seconds 9
```

首次执行会安装 BandIt，需联网。Mac 原生双架构 CI 同样安装并运行 CPU 测试；每次结果以工作流为准，Windows 尚待当地实机验收。

## 背景音保存音质（0.23.0）

在背景音／伴奏设置的「保存音质」下拉框中选择：

| 选项 | 服务缓存 | 编码与用途 |
| --- | --- | --- |
| 标准（默认） | `accompaniment.mp3` | MP3 192 kbps，约 1.4 MB／分钟，节省磁盘与浏览器存储 |
| 无损 | `accompaniment.flac` | 24 位整数 PCM 的 FLAC 无损压缩；Demucs 44.1 kHz、BandIt 48 kHz，立体声，体积取决于内容 |

无损模式在视频音频解码和片段转换时使用 float32 PCM，Demucs 分离输出同样使用 float32 WAV；BandIt 原本就输出 float32。最终量化为 24 位 PCM 后使用 FLAC 保存，不经过 MP3。FLAC 解码保留编码时的 24 位 PCM；不代表保留浮点模型输出的每一位，也不能恢复 YouTube 原音频或模型分离已经丢失的内容。

这项选择只影响背景音提取与缓存，不改变麦克风的录音音质设置。回听与混合导出直接解码对应 FLAC；混合导出继续使用现有的 44.1 kHz / 16 位 WAV 格式，经过混音、必要的重采样和削波保护，不是 FLAC 原文件的逐位复制。

音质按视频、配音／唱歌分别记忆；标准缓存沿用原有编号，无损增加独立标识。录音的 `backingQuality` 保存其原始背景音音质，回听和导出不追随后来改动。无损任务使用 v3 元数据，让不支持此功能的旧服务跳过这些文件；已有标准缓存不受影响。

长 FLAC 不会一次通过 Chrome 消息传输：扩展向固定本机端点请求 1 MiB HTTP Range 分块，校验位置、总大小和 MIME 一致性后组装 Blob；总大小上限 192 MiB，覆盖最长 10 分钟的双声道 24 位音频。停止或切换视频时丢弃未完成的加载。浏览器存储不足时仍沿用现有保存失败提示。

更新后需重新加载扩展、刷新 YouTube，并在原终端停止、重启本机服务。开发验证：

```bash
.venv/bin/python karaoke/smoke_test.py --quality lossless --device cpu
.venv/bin/python karaoke/smoke_test.py --model bandit-v2-multi --quality lossless --device cuda --seconds 9
```

验证 FLAC 编码、位深、时长、声道与解码误差；单元测试另验证 24 位 PCM 的逐采样精确往返，不访问 YouTube 或申请麦克风权限。

### 同调原声

扩展选择非零练习调性后，可自动提取原声音轨用于听原曲、前置准备和录音参考。此路径仅使用 yt-dlp 与 FFmpeg，不下载或运行 Demucs/BandIt，也不需要 GPU。原声使用独立的 FLAC 缓存标识，不会作为伴奏显示或混入导出；与伴奏共用现有任务队列、取消、分块传输和有界磁盘缓存。更新后请停止旧服务并重新运行根目录启动脚本，扩展会检测服务是否支持此功能。
