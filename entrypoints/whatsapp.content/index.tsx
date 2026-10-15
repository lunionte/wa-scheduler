import ReactDOM from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Panel from '../../src/ui/Panel';
import { WhatsAppAdapter } from '../../src/content/adapter';
import { recipientKey, type Recipient } from '../../src/core/model';
import './style.css';

type PanelPosition = { left: number; bottom?: number; top?: number; height: number };

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'], cssInjectionMode: 'ui',
  async main(ctx) {
    const adapter = new WhatsAppAdapter();
    const events = new EventTarget();
    let previousHeader: HTMLElement | null = null;
    let previousSignature = '';
    let openRequested = location.hash === '#wa-scheduler';
    let identifyGeneration = 0;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', 'Agendar mensagem');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = 'Agendar mensagem';
    trigger.dataset.waSchedulerTrigger = '';
    trigger.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="pointer-events:none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    Object.assign(trigger.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
      boxSizing: 'border-box', flex: '0 0 40px', width: '40px', height: '40px', minWidth: '40px',
      padding: '8px', margin: '0', border: '0', borderRadius: '50%', lineHeight: '1',
      background: 'transparent', color: '#aebac1', cursor: 'pointer',
    });
    trigger.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); events.dispatchEvent(new Event('toggle'));
    });
    trigger.addEventListener('keydown', event => event.stopPropagation());

    function placement(): PanelPosition {
      const rect = trigger.getBoundingClientRect();
      return {
        left: Math.max(8, Math.min(rect.right - 410, window.innerWidth - Math.min(410, window.innerWidth - 32) - 8)),
        bottom: Math.max(8, window.innerHeight - rect.top + 10),
        height: Math.max(120, Math.min(720, rect.top - 20)),
      };
    }

    function App() {
      const [open, setOpen] = useState(openRequested);
      const [recipient, setRecipient] = useState<Recipient | null>(null);
      const [identifying, setIdentifying] = useState(false);
      const [generation, setGeneration] = useState(0);
      const [position, setPosition] = useState(placement);
      const confirmedRecipient = useRef<string | null>(null);
      const popover = useRef<HTMLDivElement>(null);
      const moved = useRef(false);
      const drag = useRef<{ id: number; x: number; y: number } | null>(null);
      function resetPosition() { moved.current = false; drag.current = null; setPosition(placement()); }
      function moveTo(left: number, top: number) {
        const rect = popover.current?.getBoundingClientRect();
        if (!rect) return;
        moved.current = true;
        setPosition(old => ({
          left: Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)),
          top: Math.max(8, Math.min(top, window.innerHeight - rect.height - 8)),
          height: Math.min(old.height, window.innerHeight - 16),
        }));
      }
      const startDrag: React.PointerEventHandler<HTMLElement> = event => {
        if (event.button !== 0 || (event.target as Element).closest('button')) return;
        const rect = popover.current?.getBoundingClientRect();
        if (!rect) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
      };
      const moveDrag: React.PointerEventHandler<HTMLElement> = event => {
        if (drag.current?.id !== event.pointerId) return;
        moveTo(event.clientX - drag.current.x, event.clientY - drag.current.y);
      };
      const endDrag: React.PointerEventHandler<HTMLElement> = event => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      };
      const refresh = useCallback(() => {
        const token = ++identifyGeneration;
        setIdentifying(true);
        void adapter.resolveRecipient(true).then(value => {
          if (token !== identifyGeneration) return;
          const key = value ? recipientKey(value) : null;
          if (key && confirmedRecipient.current && key !== confirmedRecipient.current) {
            events.dispatchEvent(new Event('chat'));
          } else {
            if (key) confirmedRecipient.current = key;
            setRecipient(value);
          }
        })
          .catch(() => { if (token === identifyGeneration) setRecipient(null); })
          .finally(() => { if (token === identifyGeneration) setIdentifying(false); });
      }, []);
      const close = () => { ++identifyGeneration; confirmedRecipient.current = null; setRecipient(null); setOpen(false); resetPosition(); openRequested = false; trigger.focus({ preventScroll: true }); };
      useEffect(() => { trigger.setAttribute('aria-expanded', String(open)); if (open) refresh(); }, [open, refresh]);
      useEffect(() => {
        if (!open || !popover.current) return;
        const observer = new ResizeObserver(() => {
          if (moved.current) {
            const rect = popover.current?.getBoundingClientRect();
            if (rect) moveTo(rect.left, rect.top);
          }
        });
        observer.observe(popover.current);
        return () => observer.disconnect();
      }, [open]);
      useEffect(() => {
        if (!open) return;
        let stopped = false;
        const timer = window.setInterval(() => {
          const token = identifyGeneration;
          void adapter.resolveRecipient().then(value => {
            if (stopped || token !== identifyGeneration) return;
            const key = value ? recipientKey(value) : null;
            if (key && confirmedRecipient.current && key !== confirmedRecipient.current) {
              events.dispatchEvent(new Event('chat'));
            } else {
              if (key) confirmedRecipient.current = key;
              setRecipient(old => old?.chatId === value?.chatId && old?.phone === value?.phone && old?.label === value?.label ? old : value);
            }
          }).catch(() => {});
        }, 1000);
        return () => { stopped = true; clearInterval(timer); };
      }, [open, recipient]);
      useEffect(() => {
        openRequested = false;
        const show = () => { openRequested = false; confirmedRecipient.current = null; resetPosition(); setOpen(true); refresh(); };
        const toggle = () => { ++identifyGeneration; confirmedRecipient.current = null; setRecipient(null); resetPosition(); setOpen(value => !value); };
        const changed = () => { ++identifyGeneration; confirmedRecipient.current = null; resetPosition(); setRecipient(null); setIdentifying(false); setGeneration(v => v + 1); setOpen(false); };
        const layout = () => {
          if (!moved.current) setPosition(placement());
          else {
            const rect = popover.current?.getBoundingClientRect();
            if (rect) moveTo(rect.left, rect.top);
          }
        };
        events.addEventListener('open', show); events.addEventListener('toggle', toggle);
        events.addEventListener('verify-chat', refresh);
        events.addEventListener('chat', changed); events.addEventListener('layout', layout);
        return () => {
          events.removeEventListener('open', show); events.removeEventListener('toggle', toggle);
          events.removeEventListener('verify-chat', refresh);
          events.removeEventListener('chat', changed); events.removeEventListener('layout', layout);
        };
      }, [refresh]);
      return open && <div ref={popover} className="scheduler-popover" style={{
        left: position.left, bottom: position.bottom, top: position.top,
        '--wa-panel-max-height': `${position.height}px`,
      } as React.CSSProperties}><Panel key={generation} recipient={recipient} identifying={identifying} refreshRecipient={refresh} onClose={close}
        onDragStart={startDrag} onDragMove={moveDrag} onDragEnd={endDrag} onMove={(dx, dy) => {
          const rect = popover.current?.getBoundingClientRect();
          if (rect) moveTo(rect.left + dx, rect.top + dy);
        }}/></div>;
    }

    // The fixed panel never participates in the composer layout; the toolbar receives only a 40px button.
    const ui = await createShadowRootUi(ctx, {
      name: 'wa-scheduler', position: 'inline', anchor: 'body', isolateEvents: true,
      onMount(container) {
        Object.assign(container.style, { margin: '0', padding: '0', position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '10000' });
        const app = document.createElement('div'); container.append(app);
        const root = ReactDOM.createRoot(app); root.render(<App/>); return root;
      },
      onRemove(root) { root?.unmount(); },
    });
    let mounted = false;

    function placeTrigger(action: HTMLElement, editor: HTMLElement) {
      let common = action.parentElement;
      while (common && common !== document.body && !common.contains(editor)) common = common.parentElement;
      const style = common ? getComputedStyle(common) : null;
      if (common && !common.querySelector('header') && style?.display.includes('flex') && style.flexDirection.startsWith('row')) {
        let branch = action;
        while (branch.parentElement && branch.parentElement !== common) branch = branch.parentElement;
        trigger.style.position = 'static'; trigger.style.removeProperty('top'); trigger.style.removeProperty('left');
        if (trigger.parentElement !== common || trigger.nextElementSibling !== branch) common.insertBefore(trigger, branch);
      } else {
        // Absolutely positioned voice controls need an overlay trigger rather than another layout child.
        const rect = action.getBoundingClientRect();
        Object.assign(trigger.style, { position: 'fixed', top: `${rect.top + (rect.height - 40) / 2}px`, left: `${Math.max(8, rect.left - 44)}px`, zIndex: '9999' });
        if (trigger.parentElement !== document.body) document.body.append(trigger);
      }
    }

    function update() {
      const header = adapter.header(), signature = adapter.signature();
      if (header !== previousHeader || signature !== previousSignature) {
        previousHeader = header; previousSignature = signature; events.dispatchEvent(new Event('verify-chat'));
      }
      const action = adapter.actionAnchor(), editor = adapter.editor();
      if (!action || !editor) { trigger.remove(); return; }
      if (!mounted) { ui.mount(); mounted = true; }
      // WhatsApp can remove injected siblings during a render. Reattach the
      // existing host and React tree; mounting a second root would lose state.
      else if (!ui.shadowHost.isConnected) document.body.append(ui.shadowHost);
      placeTrigger(action, editor);
      ui.uiContainer.style.fontFamily = getComputedStyle(editor).fontFamily || 'Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif';
      trigger.style.color = getComputedStyle(action).color;
      events.dispatchEvent(new Event('layout'));
      if (openRequested) events.dispatchEvent(new Event('open'));
    }
    let scheduled = false;
    function scheduleUpdate() {
      if (scheduled) return;
      scheduled = true; requestAnimationFrame(() => { scheduled = false; update(); });
    }
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'data-id'] });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    update();

    const listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
      if (sender.id !== chrome.runtime.id || sender.tab) return false;
      const type = (raw as { type?: unknown } | null)?.type;
      if (type === 'WA_SCHEDULER_OPEN') {
        openRequested = true; events.dispatchEvent(new Event('open'));
        if (!adapter.actionAnchor()) console.warn('WA Scheduler: barra de mensagem não localizada.', adapter.diagnostics());
        respond({ ok: true }); return false;
      }
      if (type === 'WA_SCHEDULER_PROBE') {
        void adapter.resolveRecipient().then(recipient => respond({ ready: adapter.available() && !adapter.unsupportedDraft(), recipient }), () => respond({ ready: false, recipient: null })); return true;
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    const hashChanged = () => {
      if (location.hash === '#wa-scheduler') { openRequested = true; events.dispatchEvent(new Event('open')); }
    };
    window.addEventListener('hashchange', hashChanged);
    ctx.onInvalidated(() => {
      observer.disconnect(); chrome.runtime.onMessage.removeListener(listener);
      window.removeEventListener('hashchange', hashChanged); window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true); trigger.remove(); ui.remove();
    });
  },
});
