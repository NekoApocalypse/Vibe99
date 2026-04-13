const path = require('node:path');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const { MakerRpm } = require('@electron-forge/maker-rpm');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');

const platformIcons = {
  darwin: path.join(__dirname, 'assets', 'icons', 'icon.icns'),
  linux: path.join(__dirname, 'assets', 'icons', 'icon.png'),
  win32: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
};

const makers = [
  new MakerSquirrel({
    authors: 'Vibe99',
    name: 'vibe99',
    setupExe: 'Vibe99Setup.exe',
    setupIcon: platformIcons.win32,
  }),
  new MakerZIP({}, ['darwin', 'linux']),
  new MakerDMG({
    format: 'ULFO',
  }),
  new MakerDeb({
    options: {
      bin: 'Vibe99',
      categories: ['Development', 'TerminalEmulator'],
      description: 'Focus-first desktop terminal workspace for agentic coding',
      genericName: 'Terminal Workspace',
      homepage: 'https://github.com/NekoApocalypse/Vibe99',
      icon: 'assets/icons/icon.png',
      maintainer: 'Vibe99',
      productDescription:
        'Desktop terminal workspace that keeps one pane readable while the rest stay visible as peripheral context.',
      section: 'devel',
    },
  }),
  {
    name: './electron/maker-appimage.cjs',
    config: {
      linux: {
        category: 'Development',
        icon: path.join(__dirname, 'assets', 'icons'),
      },
    },
    platforms: ['linux'],
  },
];

if (process.platform !== 'linux' || process.env.VIBE99_ENABLE_RPM === '1') {
  makers.push(new MakerRpm({}));
}

module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/@homebridge/node-pty-prebuilt-multiarch/**',
    },
    appBundleId: 'com.vibe99.app',
    executableName: 'Vibe99',
    icon: platformIcons[process.platform] ?? platformIcons.linux,
    name: 'Vibe99',
    osxSign: false,
  },
  rebuildConfig: {},
  makers,
  plugins: [new AutoUnpackNativesPlugin({})],
};
