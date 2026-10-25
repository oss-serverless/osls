'use strict';

const { createRequire } = require('module');
const path = require('path');
const fsp = require('fs').promises;
const spawn = require('../utils/spawn');
const inquirer = require('../utils/serverless-utils/inquirer');

const relativeBinPath = '@osls/compose/bin/serverless-compose';

const isInteractive = require('../utils/is-interactive')();

const ensureMinimalPackageJson = async () => {
  return fsp.writeFile(path.join(process.cwd(), 'package.json'), '{}');
};

const resolveAbsoluteModulePath = (contextDirname, modulePath) => {
  try {
    return createRequire(path.resolve(contextDirname, 'require-resolver')).resolve(modulePath);
  } catch {
    return null;
  }
};

const resolveGlobalNpmPath = async () => {
  const npmNodeModulesPath = await (async () => {
    try {
      return String((await spawn('npm', ['root', '-g'])).stdoutBuffer).trim();
    } catch {
      return null;
    }
  })();

  if (!npmNodeModulesPath) return null;
  try {
    return require.resolve(`${npmNodeModulesPath}/${relativeBinPath}`);
  } catch {
    return null;
  }
};

module.exports = async () => {
  // 1. If installed locally in service node_modules, run it
  const localNpmPath = resolveAbsoluteModulePath(process.cwd(), relativeBinPath);
  if (localNpmPath) {
    require(localNpmPath);
    return;
  }

  // 2. If installed as npm global installation, run it
  const globalNpmPath = await resolveGlobalNpmPath();
  if (globalNpmPath) {
    require(globalNpmPath);
    return;
  }

  let packageJsonContent;
  try {
    packageJsonContent = require(path.join(process.cwd(), 'package.json'));
  } catch {
    // Pass
  }

  let hasInstalledCompose;

  if (isInteractive) {
    process.stdout.write(
      `${['', 'osls compose needs to be installed first. This is a one-time operation.'].join(
        '\n'
      )}\n`
    );

    // In this situation, we want to ask user for installing the `@osls/compose`
    // and adding it to `devDependencies` of `package.json`

    let promptMessage = 'Do you want to install osls compose locally with "npm"?';
    if (!packageJsonContent) {
      promptMessage += ' A "package.json" file will also be created in your current directory.';
    }

    const shouldInstallCompose = (
      await inquirer.prompt({
        message: promptMessage,
        type: 'confirm',
        name: 'shouldInstallCompose',
      })
    ).shouldInstallCompose;

    // Add progress bar
    if (shouldInstallCompose) {
      const createProgressFooter = require('../utils/progress-footer');
      const cliProgressFooter = createProgressFooter();
      cliProgressFooter.shouldAddProgressAnimationPrefix = true;
      cliProgressFooter.progressAnimationPrefixFrames =
        cliProgressFooter.progressAnimationPrefixFrames.map((frame) => `\x1b[91m${frame}\x1b[39m`);

      cliProgressFooter.updateProgress('Installing osls compose CLI');

      try {
        if (!packageJsonContent) {
          try {
            await ensureMinimalPackageJson();
          } catch {
            process.stdout.write(
              `${[
                '',
                'Could not create "package.json" in current directory.',
                'Please create it manually and run this command again.',
              ].join('\n')}\n`
            );
            return;
          }
        }

        try {
          await spawn('npm', ['install', '--save-dev', '@osls/compose']);
        } catch {
          process.stdout.write(
            `${[
              '',
              'Could not install osls compose CLI locally.',
              'Please install it manually with "npm i --save-dev @osls/compose" and run this command again.',
            ].join('\n')}\n`
          );
          return;
        }
      } finally {
        cliProgressFooter.updateProgress();
      }
      hasInstalledCompose = true;
    } else {
      process.stdout.write(
        `${[
          '',
          'Please install it manually with "npm i --save-dev @osls/compose" and run this command again.',
        ].join('\n')}\n`
      );
      return;
    }
  } else {
    // Non-interactive scenario

    // Here, we want to check if user has `@osls/compose` in `devDependencies` of `package.json`
    // If that is the case, we want to run `npm install` to ensure it's installed
    // In all other scenarios, we want to inform user that `@osls/compose` needs to be installed first (and/or added to "package.json")
    process.stdout.write(`${['', 'Installing osls compose CLI via NPM'].join('\n')}\n`);

    const failedInstallationErrorMessage = `${[
      '',
      'Installation failed. Make sure the "@osls/compose" package is required in "package.json" in the current directory so that osls can install it automatically.',
      'Alternatively you can install the "@osls/compose" package manually via NPM.',
    ].join('\n')}\n`;

    if (
      packageJsonContent &&
      packageJsonContent.devDependencies &&
      packageJsonContent.devDependencies['@osls/compose']
    ) {
      try {
        await spawn('npm', ['install', '--no-save', '--no-package-lock', '@osls/compose']);
        hasInstalledCompose = true;
      } catch {
        process.stdout.write(failedInstallationErrorMessage);
        // Ensure to crash builds in CI
        process.exitCode = 1;
        return;
      }
    } else {
      process.stdout.write(failedInstallationErrorMessage);
      // Ensure to crash builds in CI
      process.exitCode = 1;
      return;
    }
  }

  if (hasInstalledCompose) {
    // Try to run local compose
    const installedLocalNpmPath = resolveAbsoluteModulePath(process.cwd(), relativeBinPath);
    require(installedLocalNpmPath);
  }
};
