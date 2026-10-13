import sdk from 'virtual:wa-scheduler-sdk';
import { createPageApi } from '../src/integration/page-api';
import { WhatsAppAdapter } from '../src/content/adapter';

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'], world: 'MAIN', runAt: 'document_start',
  main() {
    if (!window.__waSchedulerPageV1) {
      const dom = new WhatsAppAdapter();
      Object.defineProperty(window, '__waSchedulerPageV1', {
        configurable: true, // Re-injection after extension updates may replace the adapter.
        value: createPageApi(sdk, Date.now, 15000, () => dom.available() && !dom.unsupportedDraft()),
      });
    }
  },
});
