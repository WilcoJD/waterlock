// Metro config. Expo (SDK 52+) auto-detects the npm-workspaces monorepo, so it watches the repo root
// and resolves @ripvault/shared (TypeScript source) from the workspace symlink with no extra setup.
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
