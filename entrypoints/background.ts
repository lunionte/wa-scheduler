import { SchedulerEngine } from '../src/core/engine';
import { requestSchema, probeResponseSchema } from '../src/core/protocol';
import { databaseSchema, resultSchema, sameRecipient } from '../src/core/model';
import type { Schedule, SendResult } from '../src/core/model';
import type { ProbeResponse, Response } from '../src/core/protocol';

const ALARM = 'wa-scheduler:next';
const KEY = 'waSchedulerDatabase';
const WA_URL = 'https://web.whatsapp.com/';

async function pruneHistoryReadMarkers() {
  // Read database + markers in the same storage snapshot. Never modify schedules.
  const stored = await chrome.storage.local.get(null);
  const parsed = databaseSchema.safeParse(stored[KEY]);
  if (!parsed.success) return;
  const retained = new Set(parsed.data.history.map(item => item.id));
  const prefix = 'waSchedulerHistoryRead:';
  const obsolete = Object.keys(stored).filter(key => key.startsWith(prefix) && !retained.has(key.slice(prefix.length)));
  if (obsolete.length) await chrome.storage.local.remove(obsolete);
}

function timeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tempo limite excedido.')), ms);
    task.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function dispatch(schedule: Schedule, occurrenceId: string, deadline: number): Promise<SendResult> {
  const tabs = (await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }))
    .filter(tab => tab.id !== undefined && !tab.discarded)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.id! - b.id!);
  for (const tab of tabs) {
    if (Date.now() > deadline) break;
    let probe: ProbeResponse;
    try { probe = probeResponseSchema.parse(await timeout(chrome.tabs.sendMessage(tab.id!, { type: 'WA_SCHEDULER_PROBE' }), 8000)); }
    catch { continue; }
    if (!probe?.ready || !probe.recipient || !sameRecipient(probe.recipient, schedule.recipient)) continue;
    // Once dispatched, never try another tab: the first could already have sent.
    try {
      const command = {
        type: 'WA_SCHEDULER_SEND', occurrenceId, recipient: schedule.recipient,
        message: schedule.message, deadline,
      } as const;
      const results = await timeout(chrome.scripting.executeScript({
        target: { tabId: tab.id!, frameIds: [0] }, world: 'MAIN',
        func: (input: typeof command) => window.__waSchedulerPageV1?.send(input) ??
          { status: 'missed', reason: 'A integração com o WhatsApp ainda não está pronta.' },
        args: [command],
      }), 25000);
      return resultSchema.parse(results[0]?.result);
    } catch {
      return { status: 'uncertain', reason: 'A aba não confirmou o envio. Confira a conversa antes de retomar.', unsafe: true };
    }
  }
  return { status: 'missed', reason: 'A conversa agendada não estava aberta e disponível.' };
}

export default defineBackground(() => {
  const engine = new SchedulerEngine({
    load: async () => (await chrome.storage.local.get(KEY))[KEY],
    persist: async database => { await chrome.storage.local.set({ [KEY]: database }); },
    arm: async at => {
      if (at === null) await chrome.alarms.clear(ALARM);
      else await chrome.alarms.create(ALARM, { when: Math.max(at, Date.now() + 100) });
    },
    send: dispatch, now: Date.now, uuid: () => crypto.randomUUID(),
  });
  // Run on each new worker instance, not just browser startup.
  const ready = engine.recover();
  ready.catch(error => console.error('WA Scheduler: recuperação falhou', error));
  void ready.then(pruneHistoryReadMarkers).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) void pruneHistoryReadMarkers().catch(() => {});
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) void ready.then(() => engine.tick()).catch(error => console.error('WA Scheduler: alarme falhou', error));
  });

  chrome.runtime.onMessage.addListener((raw, sender, respond: (response: Response) => void) => {
    if (sender.id !== chrome.runtime.id || !sender.tab || !sender.url?.startsWith(WA_URL)) return false;
    // Independent of engine.ready/serial: tick waits for a tab probe, whose
    // content script needs this lookup. Queueing it would deadlock that tick.
    if ((raw as { type?: unknown } | null)?.type === 'WA_SCHEDULER_ACTIVE' && sender.frameId === 0) {
      void chrome.scripting.executeScript({
        target: { tabId: sender.tab.id!, frameIds: [0] }, world: 'MAIN',
        func: () => window.__waSchedulerPageV1?.identify() ?? { ready: false, recipient: null },
      }).then(results => {
        const value = probeResponseSchema.safeParse(results[0]?.result);
        (respond as (value: unknown) => void)(value.success ? value.data : { ready: false, recipient: null });
      }, () => (respond as (value: unknown) => void)({ ready: false, recipient: null }));
      return true;
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return false;
    void (async () => {
      await ready;
      const message = parsed.data;
      switch (message.type) {
        case 'WA_SCHEDULER_SAVE': return engine.save(message.input, message.id);
        case 'WA_SCHEDULER_PAUSE': return engine.pause(message.id, message.paused);
        case 'WA_SCHEDULER_DELETE': return engine.remove(message.id);
        default: return engine.snapshot();
      }
    })().then(database => respond({ ok: true, database }), error => respond({
      ok: false, error: error instanceof Error ? error.message : 'Operação indisponível.',
    }));
    return true;
  });

  chrome.action.onClicked.addListener(() => {
    void (async () => {
      const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
      const tab = tabs.find(t => t.active) ?? tabs[0];
      if (tab?.id !== undefined) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        // Hash also handles tabs that have not loaded the content script yet.
        try { await chrome.tabs.sendMessage(tab.id, { type: 'WA_SCHEDULER_OPEN' }); }
        catch { await chrome.tabs.update(tab.id, { url: `${WA_URL}#wa-scheduler` }); }
      } else {
        await chrome.tabs.create({ url: `${WA_URL}#wa-scheduler` });
      }
    })().catch(error => console.error('WA Scheduler: não foi possível abrir o painel', error));
  });
});
