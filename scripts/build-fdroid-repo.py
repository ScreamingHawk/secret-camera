#!/usr/bin/env python3
"""Build a signed F-Droid repository index from caller-verified APKs."""
import argparse, hashlib, json, os, shutil, subprocess, tempfile, re
from pathlib import Path

APP_ID = "link.standen.secretcamera"

def validate_current_version(versions, manifest):
    """Ensure the manifest identifies the numerically newest indexed build."""
    if not versions:
        raise ValueError('index contains no package versions')
    normalized = []
    seen = {}
    for item in versions:
        code = int(item['manifest']['versionCode'])
        version = str(item['manifest']['versionName'])
        if code in seen and seen[code] != version:
            raise ValueError(f'conflicting versions share versionCode {code}')
        seen[code] = version
        normalized.append((code, version))
    max_code = max(code for code, _ in normalized)
    newest = {version for code, version in normalized if code == max_code}
    if len(newest) != 1 or next(iter(newest)) != str(manifest['current_version']) or max_code != int(manifest['current_version_code']):
        raise ValueError('index package version does not match manifest')
    return max_code

def publish_staging(stage, output):
    """Replace output while retaining its old contents if publication fails."""
    backup = None
    moved_old = False
    try:
        if output.exists():
            fd, backup_name = tempfile.mkstemp(prefix=output.name + '.backup-', dir=output.parent)
            os.close(fd)
            os.unlink(backup_name)
            backup = Path(backup_name)
            output.rename(backup)
            moved_old = True
        try:
            stage.rename(output)
        except BaseException:
            if moved_old:
                backup.rename(output)
                moved_old = False
            raise
        if backup is not None and backup.exists():
            shutil.rmtree(backup)
    finally:
        if stage.exists():
            shutil.rmtree(stage)

def run(argv, **kw):
    return subprocess.run(argv, check=True, text=True, capture_output=True, **kw)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--apks', type=Path, required=True, help='directory containing verified APK(s)')
    p.add_argument('--output', type=Path, required=True, help='publication repo directory')
    p.add_argument('--manifest', type=Path, required=True, help='JSON: name, current_version, current_version_code, description')
    a=p.parse_args()
    required=('FDROID_KEYSTORE','FDROID_KEYALIAS','FDROID_STOREPASS','FDROID_KEYPASS','FDROID_EXPECTED_FINGERPRINT')
    env=os.environ.copy()
    missing=[k for k in required if not env.get(k)]
    if missing: p.error('missing environment: '+', '.join(missing))
    apkdir=a.apks.resolve(); output=a.output.resolve()
    apks=sorted(apkdir.glob('*.apk'))
    if not apks: p.error('no APK files found')
    m=json.loads(a.manifest.read_text())
    keytool=Path(env.get('JAVA_HOME','')).joinpath('bin/keytool')
    jar=Path(env.get('JAVA_HOME','')).joinpath('bin/jarsigner')
    for binary in (keytool,jar):
        if not binary.is_file(): p.error(f'missing Java tool: {binary}')
    ks=Path(env['FDROID_KEYSTORE']).resolve()
    fpout=run([str(keytool),'-list','-v','-keystore',str(ks),'-alias',env['FDROID_KEYALIAS'],'-storepass:env','FDROID_STOREPASS'],env=env).stdout
    import re
    found=re.search(r'(?im)^\s*SHA256:\s*([0-9A-F: ]+)',fpout)
    if not found: p.error('could not read repository key SHA-256 fingerprint')
    fingerprint=found.group(1).replace(':','').replace(' ','').upper()
    expected=env['FDROID_EXPECTED_FINGERPRINT'].replace(':','').replace(' ','').upper()
    if fingerprint != expected: p.error(f'repository key fingerprint mismatch: found {fingerprint}')
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='fdroid-work-') as td:
        work=Path(td); (work/'repo').mkdir(); (work/'metadata').mkdir()
        for apk in apks: shutil.copy2(apk,work/'repo'/apk.name)
        icon=work/'metadata'/f'{APP_ID}'
        icon.mkdir(parents=True)
        shutil.copy2(Path(__file__).resolve().parents[1]/'assets/images/icon-512.png',icon/'icon.png')
        import yaml
        metadata = {'Categories': ['Photography'], 'License': 'MIT',
                    'SourceCode': 'https://github.com/ScreamingHawk/secret-camera',
                    'Name': m['name'], 'Summary': m['name'], 'Description': m['description'],
                    'CurrentVersion': str(m['current_version']),
                    'CurrentVersionCode': int(m['current_version_code'])}
        (work/'metadata'/f'{APP_ID}.yml').write_text(yaml.safe_dump(metadata))
        config={'repo_url':'https://secret-camera.standen.link/fdroid/repo','repo_name':'Secret Camera','repo_description':'Secret Camera releases',
          'archive_older':0,'keystore':str(ks),'repo_keyalias':env['FDROID_KEYALIAS'],'keystorepass':env['FDROID_STOREPASS'],'keypass':env['FDROID_KEYPASS'],
          'jarsigner':str(jar),'keytool':str(keytool),'java_paths':{'keytool':str(keytool),'jarsigner':str(jar)},'cachedir':str(work/'cache'), 'make_current_version_link':False, 'sdk_path':env.get('ANDROID_HOME','')}
        import yaml
        (work/'config.yml').write_text(yaml.safe_dump(config,sort_keys=True)); os.chmod(work/'config.yml',0o600)
        env.update({'JAVA_HOME':str(keytool.parent.parent),'PATH':str(keytool.parent)+os.pathsep+env.get('PATH',''),'ANDROID_HOME':env.get('ANDROID_HOME','')})
        fdroid=shutil.which('fdroid',path=env.get('PATH'))
        if not fdroid: p.error('fdroid command not found on PATH')
        try:
            run([str(fdroid),'update','--clean'],cwd=work,env=env)
        except subprocess.CalledProcessError as exc:
            raise SystemExit(f"fdroid update failed: {exc.stderr[-4000:]}")
        generated=work/'repo'
        sig=generated/'entry.jar'
        if not sig.is_file(): p.error('fdroid update did not produce entry.jar')
        verified = run([str(jar),'-verify','-certs',str(sig)],env=env)
        if 'jar verified.' not in verified.stdout or 'treated as unsigned' in verified.stdout:
            p.error('modern index JAR was not cryptographically verified')
        verify=run([str(keytool),'-printcert','-jarfile',str(sig)],env=env).stdout
        v=re.search(r'(?im)^\s*SHA256:\s*([0-9A-F: ]+)',verify)
        if not v or v.group(1).replace(':','').replace(' ','').upper()!=expected: p.error('generated index signature certificate mismatch')
        # Validate and publish atomically; retain previous publication on failure.
        import zipfile
        with zipfile.ZipFile(sig) as signed:
            entry = json.loads(signed.read('entry.json'))
        index_bytes = (generated/'index-v2.json').read_bytes()
        if entry['index']['name'] != '/index-v2.json' or entry['index']['size'] != len(index_bytes) or entry['index']['sha256'] != hashlib.sha256(index_bytes).hexdigest():
            p.error('signed entry does not authenticate index-v2.json')
        index = json.loads(index_bytes)
        entries = list(index.get('packages', {}).get(APP_ID, {}).get('versions', {}).values())
        try:
            validate_current_version(entries, m)
        except (ValueError, KeyError, TypeError) as exc:
            p.error(str(exc))
        selected = [{'apk': x['file']['name'].lstrip('/'), 'version': x['manifest']['versionName'], 'code': x['manifest']['versionCode']} for x in entries]
        if not list((generated/'icons').rglob('*')): p.error('repository index contains no icons')
        stage=Path(tempfile.mkdtemp(prefix='fdroid-publish-',dir=output.parent))
        for item in generated.iterdir():
            if item.is_dir(): shutil.copytree(item,stage/item.name)
            else: shutil.copy2(item,stage/item.name)
        if any(x.name in {'config.yml','metadata','keystore'} for x in stage.iterdir()): p.error('refusing private/config data in publication')
        publish_staging(stage, output)
        print(json.dumps({'fingerprint':fingerprint,'index_files':sorted(x.name for x in output.iterdir()),'packages':selected,'apk_sha256':{x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in apks},'verification':'jarsigner cryptographic signature verified; keytool certificate matches expected'},sort_keys=True))
if __name__=='__main__': main()
