const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');

const legacyRules = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" path="." />
  <exclude domain="root" path="cache/" />
  <exclude domain="root" path="code_cache/" />
  <exclude domain="file" path="." />
  <exclude domain="database" path="." />
  <exclude domain="sharedpref" path="." />
  <exclude domain="device_root" path="." />
  <exclude domain="device_file" path="." />
  <exclude domain="device_database" path="." />
  <exclude domain="device_sharedpref" path="." />
  <exclude domain="external" path="." />
</full-backup-content>
`;

const extractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="root" path="." />
    <exclude domain="root" path="cache/" />
    <exclude domain="root" path="code_cache/" />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
    <exclude domain="external" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="." />
    <exclude domain="root" path="cache/" />
    <exclude domain="root" path="code_cache/" />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
    <exclude domain="external" path="." />
  </device-transfer>
</data-extraction-rules>
`;

function withVaultBackupRules(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application)
      throw new Error('Android application manifest entry missing');
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] =
      '@xml/secret_camera_backup_rules';
    application.$['android:dataExtractionRules'] =
      '@xml/secret_camera_data_extraction_rules';
    return mod;
  });

  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const res = path.join(
        mod.modRequest.platformProjectRoot,
        'app/src/main/res/xml'
      );
      fs.mkdirSync(res, { recursive: true });
      fs.writeFileSync(
        path.join(res, 'secret_camera_backup_rules.xml'),
        legacyRules
      );
      fs.writeFileSync(
        path.join(res, 'secret_camera_data_extraction_rules.xml'),
        extractionRules
      );
      return mod;
    },
  ]);
}

module.exports = withVaultBackupRules;
module.exports.backupRules = { legacyRules, extractionRules };
