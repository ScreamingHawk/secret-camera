/* eslint-env jest */
const fs = require('fs');
const os = require('os');
const path = require('path');
const appConfig = require('../app.json');

jest.mock('@expo/config-plugins', () => ({
  withAndroidManifest: (config, callback) => {
    config.mods = {
      ...(config.mods || {}),
      android: { ...(config.mods?.android || {}), manifest: callback },
    };
    return config;
  },
  withDangerousMod: (config, [platform, callback]) => {
    config.mods = {
      ...(config.mods || {}),
      [platform]: { ...(config.mods?.[platform] || {}), dangerous: callback },
    };
    return config;
  },
}));
const withVaultBackupRules = require('../plugins/withVaultBackupRules');

const EXCLUDED_DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];

function applyMod(mod, modResults, modRequest) {
  return mod({ modResults, modRequest });
}

describe('Android vault backup exclusions', () => {
  test('plugin mods set backup flags and generate all expected exclusion sections', async () => {
    expect(appConfig.expo.android.allowBackup).toBe(false);
    expect(appConfig.expo.plugins).toContain('./plugins/withVaultBackupRules');

    const config = withVaultBackupRules({ mods: {} });
    const manifestMod = config.mods.android.manifest;
    const manifestResult = await applyMod(manifestMod, {
      manifest: { application: [{ $: {} }] },
    });
    const application = manifestResult.modResults.manifest.application[0];
    expect(application.$['android:allowBackup']).toBe('false');
    expect(application.$['android:fullBackupContent']).toBe(
      '@xml/secret_camera_backup_rules'
    );
    expect(application.$['android:dataExtractionRules']).toBe(
      '@xml/secret_camera_data_extraction_rules'
    );

    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), 'vault-backup-rules-')
    );
    try {
      const dangerousMod = config.mods.android.dangerous;
      await applyMod(dangerousMod, undefined, { platformProjectRoot: fixture });
      const xmlDir = path.join(fixture, 'app/src/main/res/xml');
      const legacy = fs.readFileSync(
        path.join(xmlDir, 'secret_camera_backup_rules.xml'),
        'utf8'
      );
      const extraction = fs.readFileSync(
        path.join(xmlDir, 'secret_camera_data_extraction_rules.xml'),
        'utf8'
      );

      expect(legacy).toContain('<full-backup-content>');
      expect(extraction).toContain('<cloud-backup>');
      expect(extraction).toContain('<device-transfer>');
      const sections = ['cloud-backup', 'device-transfer'].map((name) => {
        const section = extraction.match(
          new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)
        );
        expect(section).not.toBeNull();
        return section[1];
      });
      for (const rules of [legacy, ...sections]) {
        for (const domain of EXCLUDED_DOMAINS) {
          expect(rules).toContain(`<exclude domain="${domain}" path="." />`);
        }
      }
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
