const { MakerDeb } = require('@electron-forge/maker-deb');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const { MakerRpm } = require('@electron-forge/maker-rpm');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');

module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/@homebridge/node-pty-prebuilt-multiarch/**',
    },
    appBundleId: 'com.vibe99.app',
    executableName: 'Vibe99',
    name: 'Vibe99',
    osxSign: false,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      authors: 'Vibe99',
      name: 'vibe99',
      setupExe: 'Vibe99Setup.exe',
    }),
    new MakerZIP({}, ['darwin', 'linux']),
    new MakerDMG({
      format: 'ULFO',
    }),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};
