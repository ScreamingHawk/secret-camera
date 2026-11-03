const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withIncomingImageShare(config) {
  return withAndroidManifest(config, (mod) => {
    const activity = mod.modResults.manifest.application?.[0]?.activity?.find(
      (item) => item.$['android:name'] === '.MainActivity'
    );
    if (!activity)
      throw new Error('Expo MainActivity missing for image share target');
    activity['intent-filter'] ??= [];
    activity['intent-filter'] = activity['intent-filter'].filter((filter) => {
      const shareAction = filter.action?.some((entry) =>
        [
          'android.intent.action.SEND',
          'android.intent.action.SEND_MULTIPLE',
        ].includes(entry.$['android:name'])
      );
      const broadImage = filter.data?.some(
        (entry) => entry.$['android:mimeType'] === 'image/*'
      );
      return !(shareAction && broadImage);
    });
    for (const action of [
      'android.intent.action.SEND',
      'android.intent.action.SEND_MULTIPLE',
    ]) {
      const matches = activity['intent-filter'].filter(
        (filter) =>
          filter.action?.some((entry) => entry.$['android:name'] === action) &&
          filter.data?.some(
            (entry) => entry.$['android:mimeType'] === 'image/jpeg'
          )
      );
      if (matches.length) {
        let kept = false;
        activity['intent-filter'] = activity['intent-filter'].filter(
          (filter) => {
            const match =
              filter.action?.some(
                (entry) => entry.$['android:name'] === action
              ) &&
              filter.data?.some(
                (entry) => entry.$['android:mimeType'] === 'image/jpeg'
              );
            if (!match) return true;
            if (!kept) {
              kept = true;
              return true;
            }
            return false;
          }
        );
        continue;
      }
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': action } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
        data: [{ $: { 'android:mimeType': 'image/jpeg' } }],
      });
    }
    activity.$['android:launchMode'] = 'singleTask';
    return mod;
  });
};
