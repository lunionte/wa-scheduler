import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Panel from '../src/ui/Panel';
import { emptyDatabase } from '../src/core/model';
import type { Request } from '../src/core/protocol';

const recipient = { phone: '5511999999999', label: 'Teste' };
const schedule = {
  id: '00000000-0000-4000-8000-000000000001', recipient, message: 'Texto preservado',
  timing: { kind: 'interval', minutes: 1 }, createdAt: 1000, updatedAt: 1000,
  anchorAt: 1000, nextAt: 61000, state: 'active',
};
const legacy = () => {
  const { settings: _settings, ...database } = emptyDatabase();
  return { ...database, schedules: [structuredClone(schedule)] };
};
let container: HTMLDivElement;
let root: Root;
let respond: ReturnType<typeof vi.fn<(request: Request) => Promise<unknown>>>;
let storageListener: ((changes: object, area: string) => void) | undefined;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  respond = vi.fn(async () => ({ ok: true, database: legacy() }));
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: respond },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: (listener: typeof storageListener) => { storageListener = listener; }, removeListener: vi.fn() },
    },
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function mount() {
  await act(async () => { root.render(createElement(Panel, { recipient, identifying: false, refreshRecipient: vi.fn(), onClose: vi.fn() })); });
}
function button(text: string) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent === text);
  expect(found, `botão ${text}`).toBeDefined(); return found!;
}

describe('respostas recebidas pelo painel', () => {
  it('aceita snapshot antigo sem settings, mantém os dados e mostra toggle desativado', async () => {
    const original = legacy(); respond.mockResolvedValue({ ok: true, database: original });
    await mount(); await act(async () => button('Agendamentos (1)').click());
    expect(container.querySelector('input[role="switch"]')?.getAttribute('type')).toBe('checkbox');
    expect((container.querySelector('input[role="switch"]') as HTMLInputElement).checked).toBe(false);
    expect(container.textContent).toContain('Texto preservado');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(original).not.toHaveProperty('settings');
  });
  it('normaliza também a resposta de uma alteração sem derrubar o painel', async () => {
    respond.mockImplementation(async request => ({ ok: true, database: {
      ...legacy(), schedules: [{ ...schedule, state: request.type === 'WA_SCHEDULER_PAUSE' ? 'paused' : 'active' }],
    } }));
    await mount(); await act(async () => button('Agendamentos (1)').click());
    await act(async () => button('Pausar').click());
    expect(container.textContent).toContain('Pausado');
    expect(container.textContent).toContain('Texto preservado');
    expect(button('Continuar')).toBeDefined();
    expect((container.querySelector('input[role="switch"]') as HTMLInputElement).checked).toBe(false);
  });
  it('rejeita banco incompatível após atualização sem substituir os dados válidos ou lançar erro de renderização', async () => {
    await mount(); await act(async () => button('Agendamentos (1)').click());
    respond.mockResolvedValue({ ok: true, database: { ...legacy(), settings: null } });
    await act(async () => storageListener?.({}, 'local'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Recarregue');
    expect(container.textContent).toContain('Texto preservado');
    expect((container.querySelector('input[role="switch"]') as HTMLInputElement).checked).toBe(false);
  });
  it('preserva a opção ativada em uma resposta atual', async () => {
    respond.mockResolvedValue({ ok: true, database: { ...legacy(), settings: { autoDeleteFinished: true } } });
    await mount(); await act(async () => button('Agendamentos (1)').click());
    expect((container.querySelector('input[role="switch"]') as HTMLInputElement).checked).toBe(true);
  });
});
