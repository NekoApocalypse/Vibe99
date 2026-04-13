const path = require('node:path');
const { build } = require('electron-builder');
const { MakerBase } = require('@electron-forge/maker-base');

class MakerAppImage extends MakerBase {
  constructor(configOrFetcher, platformsToMakeOn) {
    super(configOrFetcher, platformsToMakeOn);
    this.name = 'appimage';
    this.defaultPlatforms = ['linux'];
  }

  isSupportedOnCurrentPlatform() {
    return this.isInstalled('electron-builder');
  }

  async make({ dir, makeDir, targetArch }) {
    const outputDir = path.resolve(makeDir, 'AppImage', targetArch);
    const linuxConfig = {
      target: ['AppImage'],
      executableName: 'Vibe99',
      ...(this.config.linux ?? {}),
    };

    await this.ensureDirectory(outputDir);

    const artifacts = await build({
      prepackaged: dir,
      publish: 'never',
      config: {
        appId: 'com.vibe99.app',
        directories: {
          output: outputDir,
        },
        executableName: 'Vibe99',
        linux: linuxConfig,
        ...this.config,
        linux: linuxConfig,
      },
    });

    return artifacts;
  }
}

module.exports = MakerAppImage;
