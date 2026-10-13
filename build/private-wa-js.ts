import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// The pinned vendor bundle is an IIFE, not an ES module. Keep its exports and
// configuration private so another extension's WPP/WPPConfig is left intact.
export function privateBundle(source: string): string {
  const substitutions: [string, string][] = [
    ['window.WPPConfig||{}', '{disableGoogleAnalytics:true,googleAnalyticsId:null,deviceName:false,syncAllStatus:false,sendStatusToDevice:false,linkPreviewApiServers:null}'],
    [',window.WPPConfig=t.config', ''],
    ['self.WPP=__webpack_exports__', 'schedulerSdk=__webpack_exports__'],
    // file-type's Node-only stream helper cannot run in a browser. Do not ship
    // eval or relax MV3/page CSP for this unreachable dependency branch.
    ['eval("require")("stream")', '(()=>{throw new Error("Node streams are unavailable in this browser bundle")})()'],
  ];
  for (const [before, after] of substitutions) {
    if (source.split(before).length !== 2) throw new Error(`WA-JS bundle changed: ${before}`);
    source = source.replace(before, after);
  }
  return `// Modified WA-JS 4.6.1: private namespace and disabled telemetry.\nlet schedulerSdk;\n${source}\nexport default schedulerSdk;`;
}

export function privateWaJsPlugin() {
  const require = createRequire(import.meta.url);
  const bundle = require.resolve('@wppconnect/wa-js');
  return {
    name: 'private-wa-js',
    resolveId(id: string) { if (id === 'virtual:wa-scheduler-sdk') return '\0wa-scheduler-sdk'; },
    load(id: string) { if (id === '\0wa-scheduler-sdk') return privateBundle(readFileSync(bundle, 'utf8')); },
  };
}
