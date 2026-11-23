'use strict';
// electron/ytm/ytm-login-preload.cjs
//
// Login-window ONLY preload script.
// Avoids non-native prototype overrides on navigator.webdriver or navigator.credentials
// (which Google BotGuard detects and bounces to /v3/signin/rejected).

const { webFrame } = require('electron');

const CLEAN_SHIM = `
(function() {
  'use strict';
  try {
    // 1. Remove "Electron" brand from navigator.userAgentData without breaking native signatures
    if (navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)) {
      const cleanBrands = navigator.userAgentData.brands
        .filter((b) => !/electron/i.test(b.brand))
        .map((b) => ({ ...b }));
      const origUAData = navigator.userAgentData;
      const origGetHighEntropyValues = origUAData.getHighEntropyValues.bind(origUAData);
      const origToJSON = origUAData.toJSON
        ? origUAData.toJSON.bind(origUAData)
        : () => ({
            brands: cleanBrands,
            mobile: origUAData.mobile,
            platform: origUAData.platform,
          });

      const maskedUAData = Object.create(Object.getPrototypeOf(origUAData));
      Object.defineProperties(maskedUAData, {
        brands: { get: () => cleanBrands, enumerable: true },
        mobile: { get: () => origUAData.mobile, enumerable: true },
        platform: { get: () => origUAData.platform, enumerable: true },
        getHighEntropyValues: {
          value: async function(hints) {
            const res = await origGetHighEntropyValues(hints);
            if (Array.isArray(res.brands)) {
              res.brands = res.brands.filter((b) => !/electron/i.test(b.brand));
            }
            if (Array.isArray(res.fullVersionList)) {
              res.fullVersionList = res.fullVersionList.filter((b) => !/electron/i.test(b.brand));
            }
            return res;
          },
        },
        toJSON: { value: origToJSON },
      });

      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        get: function() { return maskedUAData; },
        configurable: true,
      });
    }

    // 2. Provide minimal window.chrome stub only if missing
    if (!window.chrome) {
      window.chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        },
        runtime: {
          OnInstalledReason: {},
          OnRestartRequiredReason: {},
          PlatformArch: {},
          PlatformNaclArch: {},
          PlatformOs: {},
          RequestUpdateCheckStatus: {},
        },
      };
    }
  } catch (e) {
    // ignore
  }
})();
`;

try {
  webFrame.executeJavaScript(CLEAN_SHIM);
} catch (e) {
  // ignore
}