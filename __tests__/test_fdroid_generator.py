import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'build-fdroid-repo.py'
spec = importlib.util.spec_from_file_location('fdroid_generator', SCRIPT)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def version(name, code):
    return {'manifest': {'versionName': name, 'versionCode': code}}


class GeneratorTests(unittest.TestCase):
    def test_max_version_validation_ignores_mapping_order(self):
        data = [version('1.2', 12), version('1.10', 110)]
        manifest = {'current_version': '1.10', 'current_version_code': 110}
        generator.validate_current_version(data, manifest)
        generator.validate_current_version(list(reversed(data)), manifest)

    def test_rejects_manifest_not_at_numeric_max(self):
        with self.assertRaises(ValueError):
            generator.validate_current_version([version('1.10', 110), version('2.0', 200)],
                                               {'current_version': '1.10', 'current_version_code': 110})

    def test_second_rename_failure_restores_output_and_preserves_previous(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            output, stage = root / 'repo', root / 'stage'
            output.mkdir(); (output / 'old').write_text('keep')
            stage.mkdir(); (stage / 'new').write_text('new')
            unrelated = root / 'repo.previous'
            unrelated.mkdir(); (unrelated / 'unrelated').write_text('untouched')
            rename = Path.rename
            def fail_stage_once(path, target):
                if path == stage:
                    raise OSError('injected second rename failure')
                return rename(path, target)
            with patch.object(Path, 'rename', fail_stage_once):
                with self.assertRaisesRegex(OSError, 'injected'):
                    generator.publish_staging(stage, output)
            self.assertEqual((output / 'old').read_text(), 'keep')
            self.assertTrue((unrelated / 'unrelated').exists())
            self.assertFalse(stage.exists())


if __name__ == '__main__':
    unittest.main()
