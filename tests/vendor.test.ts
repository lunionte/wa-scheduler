// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { privateBundle } from '../build/private-wa-js';

describe('bundle privado WA-JS', () => {
  it('desliga telemetria antes de inicializar e preserva globais de outras extensões', () => {
    const require = createRequire(import.meta.url);
    const source = privateBundle(readFileSync(require.resolve('@wppconnect/wa-js'), 'utf8'));
    expect(source).not.toContain('window.WPPConfig');
    expect(source).not.toContain('self.WPP=');
    expect(source).toContain('disableGoogleAnalytics:true');
    expect(source).toContain('syncAllStatus:false');
    expect(source).toContain('schedulerSdk=__webpack_exports__');
    expect(source).not.toContain('eval(');
  });
  it('falha explicitamente quando a estrutura da distribuição muda', () => {
    expect(() => privateBundle('outro bundle')).toThrow('WA-JS bundle changed');
  });
});
