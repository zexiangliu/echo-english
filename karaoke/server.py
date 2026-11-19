"""Loopback-only vocal separation worker. Run with the project's Python venv."""
import argparse
import errno
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from models import ModelManager, DEFAULT_MODEL, BANDIT_MODEL, model_id, INSTALL_STATES, InstallCancelled

PORT = 8765
MAX_SECONDS = 600
MAX_JOBS = 8
AUDIO_CHUNK_BYTES = 1024 * 1024
ACTIVE_STATES = ("queued", "downloading", "converting", "separating", "encoding") + INSTALL_STATES


def probe_device(requested):
    if requested == "cpu":
        return {"device": "cpu", "deviceName": "CPU"}
    try:
        output = subprocess.check_output(
            [sys.executable, str(Path(__file__).with_name("accelerator.py")), "--device", requested],
            stderr=subprocess.PIPE, timeout=45, text=True)
        return json.loads(output)
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        if requested in ("cuda", "mps"):
            detail = f"无法启用 {requested.upper()}，请检查对应硬件与 PyTorch 环境。"
            if isinstance(error, subprocess.CalledProcessError):
                try:
                    detail = json.loads(error.output)["error"]
                except (TypeError, ValueError, KeyError):
                    pass
            raise RuntimeError(detail + " 可使用 --device cpu。") from error
        return {"device": "cpu", "deviceName": "CPU", "deviceNote": "GPU 检测失败，使用 CPU。"}


def process_options():
    # Each worker owns its descendants (yt-dlp may launch FFmpeg).
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def stop_process(proc):
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        # terminate()/kill() alone leave FFmpeg children running on Windows.
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
        proc.wait(timeout=5)
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
    except ProcessLookupError:
        proc.wait()


def separation_progress(log):
    # Match seconds-based Demucs bars, not the model download's byte-based bars.
    matches = list(re.finditer(r"(\d{1,3})%\|[^\r\n]*\|\s*[\d.]+/[\d.]+\s+\[[^\]<]*<([^,\]]+)", log))
    if not matches:
        return None, None
    match = matches[-1]
    remaining = match[2].strip()
    eta = None
    if re.fullmatch(r"\d+(?::\d+){1,2}", remaining):
        eta = 0
        for part in remaining.split(":"):
            eta = eta * 60 + int(part)
    return min(100, int(match[1])), eta


def validate_clip(data):
    video = data.get("videoId")
    start, end = data.get("start"), data.get("end")
    if not isinstance(video, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video):
        raise ValueError("无效的 YouTube 视频编号。")
    try:
        finite = all(not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v) for v in (start, end))
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError("片段时间必须为有限数字。")
    if start < 0 or end <= start or end - start > MAX_SECONDS or end > 86400:
        raise ValueError("请选择不超过 10 分钟的片段。")
    source = data.get("source", "backing")
    if source not in ("backing", "original"):
        raise ValueError("不支持的音源类型。")
    quality = data.get("quality", "standard")
    if quality not in ("standard", "lossless"):
        raise ValueError("不支持的音质选项。")
    if source == "original":
        quality = "lossless"
    model = model_id(data.get("model", DEFAULT_MODEL))
    start, end = round(start, 3), round(end, 3)
    if end <= start:
        raise ValueError("片段时间精度为毫秒，终点必须晚于起点。")
    return {"videoId": video, "start": start, "end": end,
            **({"source": source} if source != "backing" else {}),
            **({"model": model} if model != DEFAULT_MODEL else {}),
            **({"quality": quality} if quality != "standard" else {})}


class Cancelled(Exception):
    pass


class Jobs:
    def __init__(self, cache, runner=None, accelerator=None, allow_cpu_fallback=True, models=None):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.models = models
        self.lock = models.lock if models else threading.RLock()
        self.jobs = {}
        self.worker = None
        self.runner = runner or self.separate
        self.accelerator = accelerator or {"device": "cpu", "deviceName": "CPU"}
        self.allow_cpu_fallback = allow_cpu_fallback
        self.restore()

    def restore(self):
        found = []
        for directory in self.cache.iterdir():
            if not directory.is_dir() or directory.is_symlink() or not re.fullmatch(r"[a-f0-9]{32}", directory.name):
                continue
            try:
                metadata = json.loads((directory / "metadata.json").read_text())
                if not isinstance(metadata, dict) or metadata.get("version") not in (1, 2, 3) or metadata.get("state") != "ready":
                    continue
                clip = validate_clip(metadata)
                audio = self.audio_path(directory, clip)
                if not audio.is_file() or audio.is_symlink() or audio.stat().st_size == 0:
                    continue
                elapsed = float(metadata.get("elapsedSeconds", 0))
                created = float(metadata["createdAt"])
                if not math.isfinite(elapsed) or elapsed < 0 or not math.isfinite(created):
                    continue
                now = time.monotonic()
                found.append(dict(clip, id=directory.name, key=self.clip_key(clip), state="ready", error=None,
                                  started=now-elapsed, finished=now, createdAt=created,
                                  directory=directory, audio=audio, cancel=threading.Event()))
            except (OSError, ValueError, TypeError, KeyError):
                continue
        ordered = sorted(found, key=lambda j: j["createdAt"])
        # Only completed, validated Echo jobs are eligible for rolling eviction.
        # Unknown directories and incomplete/error logs remain untouched.
        for old in ordered[:-MAX_JOBS]:
            shutil.rmtree(old["directory"], ignore_errors=True)
        for job in ordered[-MAX_JOBS:]:
            self.jobs[job["id"]] = job

    @staticmethod
    def audio_path(directory, clip):
        return directory / ("accompaniment.flac" if clip.get("quality") == "lossless" else "accompaniment.mp3")

    @staticmethod
    def audio_mime(job):
        return "audio/flac" if job.get("quality") == "lossless" else "audio/mpeg"

    @staticmethod
    def clip_key(clip):
        return hashlib.sha256(json.dumps(clip, sort_keys=True).encode()).hexdigest()[:24]

    @staticmethod
    def persist(job):
        metadata = {k: job[k] for k in ("videoId", "start", "end", "createdAt")}
        if "source" in job:
            metadata["source"] = job["source"]
        if "model" in job:
            metadata["model"] = job["model"]
        if "quality" in job:
            metadata["quality"] = job["quality"]
        metadata.update(version=3 if job.get("quality") == "lossless" else 2 if job.get("model") == BANDIT_MODEL else 1, state="ready", elapsedSeconds=job["finished"]-job["started"])
        temporary = job["directory"] / "metadata.json.tmp"
        temporary.write_text(json.dumps(metadata))
        temporary.replace(job["directory"] / "metadata.json")

    def start(self, data):
        clip = validate_clip(data)
        key = self.clip_key(clip)
        with self.lock:
            # Only ready results are shared: cancelling one tab cannot cancel another.
            for job in self.jobs.values():
                if job["key"] == key and job["state"] == "ready" and job["audio"].exists():
                    return self.public(job)
            if self.models and self.models.active:
                raise RuntimeError("已有模型正在安装，请完成或停止后重试。")
            if any(j["state"] in ACTIVE_STATES for j in self.jobs.values()):
                raise RuntimeError("已有一个伴奏正在生成，请完成或停止后重试。")
            # Keep at most eight recent jobs and their files.
            while len(self.jobs) >= MAX_JOBS:
                old = self.jobs.pop(next(iter(self.jobs)))
                shutil.rmtree(old["directory"], ignore_errors=True)
            job_id = uuid.uuid4().hex
            directory = self.cache / job_id
            directory.mkdir()
            job = dict(clip, id=job_id, key=key, state="queued", error=None, started=time.monotonic(), finished=None, createdAt=time.time(),
                       directory=directory, audio=self.audio_path(directory, clip), cancel=threading.Event())
            self.jobs[job_id] = job
            self.worker = threading.Thread(target=self.run, args=(job,))
            self.worker.start()
            return self.public(job)

    def close(self):
        with self.lock:
            for job in self.jobs.values():
                job["cancel"].set()
            worker = self.worker
        # Let command() reap the process tree before the interpreter exits.
        if worker is not None:
            worker.join()
        if self.models:
            self.models.close()

    @staticmethod
    def public(job):
        result = {k: job[k] for k in ("id", "videoId", "start", "end", "state", "error")}
        percent, eta = (100, 0) if job["state"] == "ready" else (None, None)
        if job["state"] == "separating":
            try:
                with (job["directory"] / "worker.log").open("rb") as log:
                    log.seek(0, 2)
                    log.seek(max(0, log.tell() - 8192))
                    output = log.read().decode(errors="replace")
                    output = re.split(r"Echo: (?:CUDA|GPU) failed; retrying on CPU\.", output)[-1]
                    if job.get("model") == BANDIT_MODEL:
                        values = re.findall(r"Echo progress: (\d+)", output)
                        percent = int(values[-1]) if values else None
                    else:
                        percent, eta = separation_progress(output)
                    if percent is None and re.search(r'Downloading:.*https?://', output):
                        result["modelDownloading"] = True
            except OSError:
                pass
        if job["state"] in INSTALL_STATES:
            percent = job.get("progress")
        result["source"] = job.get("source", "backing")
        result["model"] = job.get("model", DEFAULT_MODEL)
        result["quality"] = job.get("quality", "standard")
        result.update({k: job[k] for k in ("device", "deviceNote") if k in job})
        return dict(result, progress=percent, remainingSeconds=eta,
                    elapsedSeconds=round((job["finished"] or time.monotonic()) - job["started"]))

    def get(self, job_id):
        with self.lock:
            if job_id not in self.jobs:
                raise KeyError("找不到伴奏任务，请重新生成。")
            return self.jobs[job_id]

    def cancel(self, job_id):
        with self.lock:
            job = self.get(job_id)
            if job["state"] not in ("ready", "error", "cancelled"):
                job["cancel"].set()
            return self.public(job)

    def run(self, job):
        try:
            self.runner(job)
            if job["cancel"].is_set():
                raise Cancelled()
            if not job["audio"].is_file():
                raise RuntimeError("分离未生成伴奏文件。")
            job["finished"] = time.monotonic()
            self.persist(job)
            job["state"] = "ready"
        except (Cancelled, InstallCancelled):
            job["state"] = "cancelled"
        except Exception as error:
            job["error"] = str(error)
            job["state"] = "error"
        finally:
            job["finished"] = time.monotonic()

    @staticmethod
    def command(job, args, timeout, failure):
        if job["cancel"].is_set():
            raise Cancelled()
        env = dict(os.environ, OMP_NUM_THREADS="2", MKL_NUM_THREADS="2",
                   TORCH_HOME=str(Path(__file__).resolve().parent.parent / ".cache" / "torch"))
        with (job["directory"] / "worker.log").open("ab") as log:
            proc = subprocess.Popen(args, stdout=log, stderr=log, env=env, **process_options())
            deadline = time.monotonic() + timeout
            try:
                while proc.poll() is None:
                    if job["cancel"].wait(0.2):
                        raise Cancelled()
                    if time.monotonic() > deadline:
                        raise RuntimeError(failure + "（处理超时）")
                if proc.returncode:
                    raise RuntimeError(failure + " 详细原因见本机 worker.log。")
            finally:
                stop_process(proc)

    @staticmethod
    def separation_output(job):
        if job.get("source") == "original":
            return job["directory"] / "clip.wav"
        if job.get("model") == BANDIT_MODEL:
            return job["directory"] / "background.wav"
        return job["directory"] / "stems/htdemucs/clip/no_vocals.wav"

    def separate_audio(self, job):
        """Shared separation path for songs and film backgrounds."""
        directory = job["directory"]
        job["device"] = self.accelerator["device"]
        args = [sys.executable, str(Path(__file__).with_name("separate.py")), "--two-stems", "vocals", "-n", "htdemucs",
                "-d", job["device"], "--segment", "4", "--shifts", "0", "-j", "1",
                "-o", str(directory / "stems"), str(directory / "clip.wav")]
        if job.get("quality") == "lossless":
            args.insert(2, "--float32")
        if job.get("model") == BANDIT_MODEL:
            if not self.models:
                raise RuntimeError("BandIt 需要新版模型管理服务。")
            if job["device"] == "mps":
                if not self.allow_cpu_fallback:
                    raise RuntimeError("BandIt 暂不支持 MPS，请用 --device cpu 或 auto 启动。")
                job.update(device="cpu", deviceNote="BandIt 在 Mac 上暂用 CPU。")
            args = [sys.executable, str(Path(__file__).with_name("bandit.py")),
                    "--deps", str(self.models.deps), "--source", str(self.models.source),
                    "--checkpoint", str(self.models.weight(BANDIT_MODEL)), "-d", job["device"],
                    "--input", str(directory / "clip.wav"),
                    "--output", str(self.separation_output(job))]
        timeout = 7200 if job.get("model") == BANDIT_MODEL else 3600
        log = directory / "worker.log"
        offset = log.stat().st_size if log.exists() else 0
        try:
            self.command(job, args, timeout, "本机去原唱失败；首次运行需联网下载模型。")
        except RuntimeError:
            # Retry only GPU runtime failures, never downloads, cancellation or
            # arbitrary model errors. A new process releases all CUDA allocations.
            if not log.is_file():
                raise
            with log.open("rb") as source:
                source.seek(max(offset, log.stat().st_size - 16384))
                tail = source.read().decode(errors="replace")
            gpu_failure = re.search(r"CUDA out of memory|CUDA error:|CUDA-capable device|"
                                    r"CUDA driver|CUDNN_STATUS|CUBLAS_STATUS|Torch not compiled with CUDA", tail, re.I)
            if job["device"] == "mps":
                gpu_failure = re.search(r"(?:RuntimeError|NotImplementedError|TypeError):[^\n]*(?:MPS|Metal)", tail, re.I)
            if job["device"] not in ("cuda", "mps") or not self.allow_cpu_fallback or not gpu_failure:
                raise
            if job["cancel"].is_set():
                raise Cancelled()
            job.update(device="cpu", deviceNote="GPU 处理失败，已自动改用 CPU。")
            shutil.rmtree(directory / "stems", ignore_errors=True)
            with log.open("a") as output:
                output.write("\nEcho: GPU failed; retrying on CPU.\n")
            args[args.index("-d") + 1] = "cpu"
            self.command(job, args, timeout, "CPU 回退分离失败，详情见 worker.log。")

    def separate(self, job):
        original = job.get("source") == "original"
        for package in (("yt_dlp",) if original else ("yt_dlp", "demucs", "torch", "torchaudio")):
            if importlib.util.find_spec(package) is None:
                raise RuntimeError("请先按 karaoke/README.md 安装本机分离依赖。")
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise RuntimeError("请先安装 FFmpeg（含 ffprobe）。")
        if self.models and not original:
            self.models.ensure(job.get("model", DEFAULT_MODEL), job, self.command)
        directory = job["directory"]
        job["state"] = "downloading"
        self.command(job, [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
                          "--no-progress", "--socket-timeout", "20", "--retries", "2",
                          "--js-runtimes", "node", "--js-runtimes", "deno",
                          "-f", "bestaudio/best", "--download-sections", f"*{job['start']}-{job['end']}",
                          "--force-keyframes-at-cuts", "-x", "--audio-format", "wav",
                          *(["--postprocessor-args", "ExtractAudio+ffmpeg_o:-c:a pcm_f32le"] if job.get("quality") == "lossless" else []),
                          "-o", str(directory / "source.%(ext)s"),
                          f"https://www.youtube.com/watch?v={job['videoId']}"], 600,
                     "无法读取此视频音频；视频可能要求登录、限制访问，或需更新 yt-dlp。")
        job["state"] = "converting"
        self.command(job, ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(directory / "source.wav"),
                          "-t", str(job["end"] - job["start"]), "-ar", "48000" if job.get("model") == BANDIT_MODEL else "44100", "-ac", "2",
                          *(["-c:a", "pcm_f32le"] if job.get("quality") == "lossless" else []),
                          str(directory / "clip.wav")], 120, "音频片段转换失败。")
        if not original:
            job["state"] = "separating"
            self.separate_audio(job)
        job["state"] = "encoding"
        self.encode_audio(job)
        # Keep only the accompaniment and diagnostic log after success.
        shutil.rmtree(directory / "stems", ignore_errors=True)
        for name in ("source.wav", "clip.wav", "background.wav"):
            (directory / name).unlink(missing_ok=True)

    def encode_audio(self, job):
        if job.get("quality") == "lossless":
            codec = ["-codec:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", "-compression_level", "5"]
        else:
            codec = ["-codec:a", "libmp3lame", "-b:a", "192k"]
        self.command(job, ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(self.separation_output(job)),
                           *codec, str(job["audio"])], 120, "背景音编码保存失败。")


def handler(jobs):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, data):
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def allowed(self):
            # No CORS headers: ordinary websites cannot POST this custom header.
            if (self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}"
                    or self.headers.get("X-Echo-Client") != "echo-english"):
                self.reply(403, {"error": "仅供 Echo 扩展访问。"})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            if self.path == "/health":
                return self.reply(200, dict(service="echo-karaoke", version=1,
                                           maxSeconds=MAX_SECONDS, modelManagement=jobs.models is not None, losslessBackings=True, originalAudio=True, **jobs.accelerator))
            if self.path == "/models" and jobs.models:
                with jobs.lock:
                    result = jobs.models.catalog()
                    result["busy"] = result["busy"] or any(j["state"] in ACTIVE_STATES for j in jobs.jobs.values())
                return self.reply(200, result)
            cached = re.fullmatch(r"/backings/([A-Za-z0-9_-]{11})(?:\?quality=(standard|lossless))?", self.path)
            if cached:
                with jobs.lock:
                    values = [dict(jobs.public(j)) for j in reversed(list(jobs.jobs.values()))
                              if j.get("source", "backing") == "backing" and j["videoId"] == cached[1] and j.get("quality", "standard") == (cached[2] or "standard")
                              and j["state"] == "ready" and j["audio"].is_file()]
                return self.reply(200, {"backings": values})
            match = re.fullmatch(r"/jobs/([a-f0-9]{32})(/audio)?", self.path)
            if not match:
                return self.reply(404, {"error": "路径不存在。"})
            try:
                job = jobs.get(match[1])
            except KeyError:
                return self.reply(404, {"error": "任务不存在，请重新生成。"})
            if not match[2]:
                return self.reply(200, jobs.public(job))
            if job["state"] != "ready":
                return self.reply(409, {"error": "伴奏尚未生成。"})
            try:
                with job["audio"].open("rb") as source:
                    size = os.fstat(source.fileno()).st_size
                    start, end = 0, size - 1
                    requested = self.headers.get("Range")
                    if requested:
                        part = re.fullmatch(r"bytes=(\d+)-(\d+)", requested)
                        if not part:
                            return self.reply(416, {"error": "无效的音频分块范围。"})
                        start, end = int(part[1]), min(int(part[2]), size - 1)
                        if start > end or end - start + 1 > AUDIO_CHUNK_BYTES:
                            return self.reply(416, {"error": "音频分块范围超出限制。"})
                    self.send_response(206 if requested else 200)
                    self.send_header("Content-Type", jobs.audio_mime(job))
                    self.send_header("Content-Length", str(end - start + 1))
                    self.send_header("Accept-Ranges", "bytes")
                    if requested:
                        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    source.seek(start)
                    remaining = end - start + 1
                    while remaining:
                        block = source.read(min(remaining, 65536))
                        if not block:
                            break
                        self.wfile.write(block)
                        remaining -= len(block)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except FileNotFoundError:
                self.reply(404, {"error": "音频缓存已清理，请重新生成。"})

        def do_POST(self):
            if not self.allowed():
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 1024:
                    raise ValueError("请求内容过大或为空。")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("请求格式错误。")
                if self.path == "/jobs":
                    return self.reply(202, jobs.start(data))
                model_action = re.fullmatch(r"/models/([a-z0-9-]+)/(install|cancel|remove)", self.path)
                if model_action and jobs.models:
                    model, action = model_action.groups()
                    model_id(model)
                    with jobs.lock:
                        if action == "cancel":
                            jobs.models.cancel(model)
                        else:
                            if any(j["state"] in ACTIVE_STATES for j in jobs.jobs.values()):
                                raise RuntimeError("请先完成或停止音频提取任务。")
                            if action == "install":
                                jobs.models.start(model, jobs.command)
                            else:
                                jobs.models.remove(model)
                    return self.reply(200, jobs.models.catalog())
                match = re.fullmatch(r"/jobs/([a-f0-9]{32})/cancel", self.path)
                if match:
                    return self.reply(200, jobs.cancel(match[1]))
                self.reply(404, {"error": "路径不存在。"})
            except (ValueError, TypeError) as error:
                self.reply(400, {"error": str(error) or "请求格式错误。"})
            except KeyError:
                self.reply(404, {"error": "任务不存在。"})
            except OSError as error:
                self.reply(409, {"error": f"无法写入本机文件，请检查权限和磁盘空间：{error}"})
            except RuntimeError as error:
                self.reply(409, {"error": str(error)})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(__file__).resolve().parent.parent / ".cache" / "karaoke")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto",
                        help="auto: use CUDA / Apple MPS when available, otherwise CPU; explicit GPU: no fallback")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    try:
        accelerator = probe_device(args.device)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1
    models = ModelManager(Path(__file__).resolve().parent.parent)
    jobs = Jobs(args.cache, accelerator=accelerator, allow_cpu_fallback=args.device == "auto", models=models)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), handler(jobs))
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        print(f"端口 {PORT} 已被占用。请在旧终端按 Ctrl+C，再运行 ./start-karaoke.sh（Windows：start-karaoke.ps1）。", file=sys.stderr)
        return 1
    print(f"Echo 伴奏服务已启动：http://127.0.0.1:{PORT}（Ctrl+C 停止）", flush=True)
    print(f"分离设备：{accelerator['deviceName']}（{accelerator['device']}）", flush=True)
    if accelerator.get("deviceNote"):
        print(accelerator["deviceNote"], flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        jobs.close()


if __name__ == "__main__":
    sys.exit(main())
