const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const cleanup = args.has('--cleanup');
const packagePath = path.join(root, 'package.json');
const packageBackup = path.join(root, 'bench/.gallery-perf-package-main.json');
const entryPath = path.join(root, 'bench/galleryPerfEntry.tsx');
const generatedDir = path.join(root, 'bench/generated');

if (cleanup) {
  if (fs.existsSync(packageBackup)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.main = JSON.parse(fs.readFileSync(packageBackup, 'utf8')).main;
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    fs.rmSync(packageBackup);
  }
  fs.rmSync(entryPath, { force: true });
  fs.rmSync(generatedDir, { recursive: true, force: true });
  fs.rmSync(path.join(root, 'app/components/GalleryPerfBaseline.tsx'), {
    force: true,
  });
  fs.rmSync(path.join(root, 'app/components/GalleryPerfCandidate.tsx'), {
    force: true,
  });
  console.log(
    'Restored package entry and removed generated GalleryView variants.'
  );
  process.exit(0);
}

if (fs.existsSync(packageBackup)) {
  throw new Error(
    'Gallery perf preparation already active; run with --cleanup first'
  );
}
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
fs.writeFileSync(
  packageBackup,
  `${JSON.stringify({ main: pkg.main }, null, 2)}\n`
);
pkg.main = './bench/galleryPerfEntry.tsx';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const source = fs.readFileSync(
  path.join(root, 'app/components/GalleryView.tsx'),
  'utf8'
);
const listEnd = '        keyExtractor={(item) => item}\n';
const imageSource = '          source={{ uri: view }}\n';
if (
  source.split(listEnd).length - 1 !== 1 ||
  source.split(imageSource).length - 1 !== 1
) {
  throw new Error(
    'GalleryView instrumentation anchors changed; refusing to generate test variants'
  );
}
const instrumented = source
  .replace(
    'interface GalleryViewProps {',
    `const galleryPerfViewabilityConfig = { itemVisiblePercentThreshold: 1 };\nconst galleryPerfViewabilityHandler = ({ viewableItems }: any) => {\n  (globalThis as any).__scGalleryPerf?.visibleItems(\n    viewableItems.filter((entry: any) => entry.isViewable).map((entry: any) => entry.item)\n  );\n};\n\ninterface GalleryViewProps {`
  )
  .replace(
    listEnd,
    `${listEnd}        onViewableItemsChanged={galleryPerfViewabilityHandler}\n        viewabilityConfig={galleryPerfViewabilityConfig}\n`
  )
  .replace(
    imageSource,
    `${imageSource}          onLoad={() => (globalThis as any).__scGalleryPerf?.imageLoaded(item)}\n`
  )
  .replace("from '../constants'", "from '../../app/constants'")
  .replace(
    "from '../utils/encryptedPhotoView'",
    "from '../../app/utils/encryptedPhotoView'"
  )
  .replace(
    "from '../utils/photoMigration'",
    "from '../../app/utils/photoMigration'"
  )
  .replace("from './ImageView'", "from '../../app/components/ImageView'");

const candidateProps = [
  '        initialNumToRender={12}\n',
  '        maxToRenderPerBatch={6}\n',
  '        windowSize={5}\n',
  '        removeClippedSubviews\n',
];
for (const prop of candidateProps) {
  if (!instrumented.includes(prop))
    throw new Error(`Missing candidate FlatList prop ${prop.trim()}`);
}
const baseline = candidateProps.reduce(
  (text, prop) => text.replace(prop, ''),
  instrumented
);
fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(
  path.join(generatedDir, 'GalleryPerfBaseline.tsx'),
  `// Generated test-only source.\n${baseline}`
);
fs.writeFileSync(
  path.join(generatedDir, 'GalleryPerfCandidate.tsx'),
  `// Generated test-only source.\n${instrumented}`
);
fs.writeFileSync(
  entryPath,
  `import { registerRootComponent } from 'expo';\nimport GalleryPerfHarness from './GalleryPerfHarness';\nregisterRootComponent(GalleryPerfHarness);\n`
);
console.log(
  'Generated isolated test entry and baseline-default/candidate GalleryView variants.'
);
