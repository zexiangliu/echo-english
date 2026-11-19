import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from server import Jobs, validate_clip

CLIP = {'videoId': 'abcdefghijk', 'start': 10, 'end': 20}

class OriginalTests(unittest.TestCase):
    def test_original_has_separate_cache_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs = Jobs(directory, runner=lambda job: job['audio'].write_bytes(b'audio'))
            backing = jobs.start({**CLIP, 'quality': 'lossless'}); jobs.worker.join()
            original = jobs.start({**CLIP, 'source': 'original'}); jobs.worker.join()
            self.assertNotEqual(original['id'], backing['id'])
            job = jobs.get(original['id'])
            self.assertEqual(job['quality'], 'lossless')
            self.assertEqual(job['audio'].suffix, '.flac')
            restored = Jobs(directory)
            self.assertEqual(restored.start({**CLIP, 'source': 'original'})['id'], original['id'])
            with self.assertRaises(ValueError):
                validate_clip({**CLIP, 'source': 'invalid'})

    def test_original_download_skips_models_and_separation(self):
        with tempfile.TemporaryDirectory() as directory:
            models = Mock(); jobs = Jobs(directory)
            jobs.models = models
            job = {**validate_clip({**CLIP, 'source': 'original'}), 'directory': Path(directory), 'cancel': threading.Event()}
            job['audio'] = jobs.audio_path(Path(directory), job)
            calls = []
            with patch('server.importlib.util.find_spec', return_value=True) as package, patch('server.shutil.which', return_value='ffmpeg'), patch.object(jobs, 'command', side_effect=lambda job,args,*rest: calls.append(args)), patch.object(jobs,'separate_audio') as separate:
                jobs.separate(job)
            self.assertEqual([call.args[0] for call in package.call_args_list], ['yt_dlp'])
            models.ensure.assert_not_called(); separate.assert_not_called()
            self.assertEqual(len(calls), 3)
            self.assertIn('flac', calls[-1]); self.assertIn('ExtractAudio+ffmpeg_o:-c:a pcm_f32le', calls[0])
