import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { whatsappFixture } from './fixture';
import type { Database } from '../src/core/model';

let context: BrowserContext;
let worker: Worker;
let page: Page;
let profile: string;

async function launchProfile() {
  const extension = path.resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    executablePath: process.env.WA_SCHEDULER_CHROMIUM,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 },
  });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension://')) return route.continue();
    if (url.startsWith('https://web.whatsapp.com/')) return route.fulfill({ contentType: 'text/html', body: whatsappFixture });
    return route.abort();
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  page = await context.newPage(); await page.goto('https://web.whatsapp.com/');
  await expect(page.getByRole('button', { name: 'Agendar mensagem', exact: true })).toBeVisible();
}
test.beforeEach(async () => {
  profile = path.resolve('artifacts/profiles', randomUUID());
  await mkdir(profile, { recursive: true });
  await launchProfile();
});
test.afterEach(async () => {
  await context?.close();
  // Only delete the disposable profile created by this test, inside the project.
  if (profile && path.dirname(profile) === path.resolve('artifacts/profiles')) await rm(profile, { recursive: true, force: true });
});

async function openPanel() {
  const toolbar = page.locator('footer').first();
  const height = await toolbar.count() ? await toolbar.evaluate(el => el.getBoundingClientRect().height) : null;
  await page.getByRole('button', { name: 'Agendar mensagem', exact: true }).click();
  await expect(page.getByText('+5511999999999', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { fixtureContactOpens: number }).fixtureContactOpens)).toBe(0);
  if (height !== null) expect(await toolbar.evaluate(el => el.getBoundingClientRect().height)).toBe(height);
}
async function createRecurring() {
  await openPanel();
  await page.getByLabel('Mensagem', { exact: true }).fill('Agendada 👋\nsegunda linha');
  await page.getByLabel('A cada intervalo', { exact: true }).check();
  await page.getByRole('button', { name: 'Agendar mensagem', exact: true }).last().click();
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
}
async function makeDue() {
  const before = await worker.evaluate(async () => {
    const key = 'waSchedulerDatabase';
    const data = (await chrome.storage.local.get(key))[key] as { schedules: { nextAt: number; }[]; history: unknown[] };
    data.schedules[0]!.nextAt = Date.now() + 500;
    await chrome.storage.local.set({ [key]: data });
    await chrome.alarms.create('wa-scheduler:next', { when: Date.now() + 1000 });
    return data.history.length;
  });
  // Synchronize with the real alarm/worker rather than assuming Chrome dispatches
  // within a locator's default five seconds. Keep all result assertions below.
  await expect.poll(() => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: unknown[] };
    return db.history.length;
  }), { timeout: 30000 }).toBe(before + 1);
}

test('painel ancorado, tema do sistema, teclado e janela aleatória', async () => {
  await openPanel();
  const panel = page.getByRole('dialog', { name: 'Agendador de mensagens' });
  const before = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.screenshot({ path: 'artifacts/painel-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await panel.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(before);
  await page.getByLabel('Sortear horário dentro de uma janela').check();
  await expect(page.getByLabel('Entre', { exact: true })).toBeVisible();
  await expect(page.getByLabel('E', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/painel-dark.png' });
  const bounds = await panel.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
  await panel.press('Escape'); await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Agendar mensagem', exact: true })).toBeFocused();
});

test('envio por alarme preserva rascunho e registra resultado', async () => {
  await createRecurring();
  await page.getByRole('button', { name: 'Fechar agendador' }).click();
  await page.getByRole('textbox', { name: 'Digite uma mensagem' }).fill('Meu rascunho 🙌\nsegunda linha');
  await makeDue();
  await expect(page.locator('.message .selectable-text')).toHaveText('Agendada 👋\nsegunda linha');
  await expect(page.getByRole('textbox', { name: 'Digite uma mensagem' })).toHaveText('Meu rascunho 🙌\nsegunda linha', { useInnerText: true });
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: { result: { status: string } }[] };
    return db.history.at(-1)?.result.status;
  })).toBe('sent');
  await openPanel(); await page.getByRole('button', { name: /^Histórico(?: \(\d+\))?$/ }).click();
  await expect(page.getByText('Enviada', { exact: true })).toBeVisible();
});

test('trocar conversa fecha formulário e pula envio sem atingir outro contato', async () => {
  await createRecurring();
  await page.getByRole('button', { name: 'Trocar conversa' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await makeDue();
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: { result: { status: string } }[] };
    return db.history.at(-1)?.result.status;
  })).toBe('missed');
  await expect(page.locator('.message')).toHaveCount(0);
});

test('pausar, retomar, editar, excluir e persistir após recarregar', async () => {
  await createRecurring();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByText('Pausado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Mensagem', { exact: true }).fill('Mensagem editada');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await page.reload(); await openPanel();
  await page.getByRole('button', { name: 'Agendamentos (1)' }).click();
  await expect(page.getByText('Mensagem editada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Excluir', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir', exact: true }).last().click();
  await expect(page.getByText('Nenhum agendamento nesta conversa.')).toBeVisible();
});

test('segunda aba não duplica a ocorrência', async () => {
  await createRecurring();
  const second = await context.newPage(); await second.goto('https://web.whatsapp.com/');
  await makeDue();
  await expect.poll(async () => {
    return await page.locator('.message').count() + await second.locator('.message').count();
  }).toBe(1);
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: unknown[] };
    return db.history.length;
  })).toBe(1);
});

test('abre por comando do ícone e cabe em janela estreita', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 720, height: 650 });
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    await chrome.tabs.sendMessage(tabs[0]!.id!, { type: 'WA_SCHEDULER_OPEN' });
  });
  const panel = page.getByRole('dialog'); await expect(panel).toBeVisible();
  await expect(page.getByText('+5511999999999', { exact: true })).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(720);
  await page.screenshot({ path: 'artifacts/painel-dark-compacto.png' });
});

test('horário pontual sorteado persiste após recarregar e envia uma vez', async () => {
  await openPanel();
  await page.getByLabel('Mensagem', { exact: true }).fill('Mensagem pontual');
  await page.getByLabel('Sortear horário dentro de uma janela').check();
  const tomorrow = new Date(Date.now() + 86400000);
  const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Data', { exact: true }).fill(date);
  await page.getByLabel('Entre', { exact: true }).fill('05:00');
  await page.getByLabel('E', { exact: true }).fill('05:40');
  await page.getByRole('button', { name: 'Agendar mensagem', exact: true }).last().click();
  await expect(page.getByText('Envio único', { exact: true })).toBeVisible();
  const chosen = await worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as {
      schedules: { timing: { at: number; window: { start: number; end: number } } }[];
    };
    return db.schedules[0]!.timing;
  });
  expect(chosen.at).toBeGreaterThanOrEqual(chosen.window.start);
  expect(chosen.at).toBeLessThanOrEqual(chosen.window.end);
  expect(chosen.at % 60000).toBe(0);
  await page.reload(); await openPanel();
  await page.getByRole('button', { name: 'Agendamentos (1)' }).click();
  const after = await worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { schedules: { timing: { at: number } }[] };
    return db.schedules[0]!.timing.at;
  });
  expect(after).toBe(chosen.at);
  await page.getByRole('button', { name: 'Fechar agendador' }).click();
  await makeDue();
  await expect(page.locator('.message')).toHaveCount(1);
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { schedules: { state: string }[] };
    return db.schedules[0]!.state;
  })).toBe('finished');
});

test('falta de confirmação pausa a recorrência sem repetir e preserva o rascunho', async () => {
  await createRecurring();
  await page.getByRole('button', { name: 'Fechar agendador' }).click();
  await page.evaluate(() => { (window as unknown as { fixtureConfirm: boolean }).fixtureConfirm = false; });
  await page.getByRole('textbox', { name: 'Digite uma mensagem' }).fill('Rascunho a preservar');
  await makeDue();
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: { result: { status: string } }[] };
    return db.history.at(-1)?.result.status;
  }), { timeout: 15000 }).toBe('uncertain');
  await expect(page.getByRole('textbox', { name: 'Digite uma mensagem' })).toHaveText('Rascunho a preservar', { useInnerText: true });
  await openPanel(); await page.getByRole('button', { name: 'Agendamentos (1)' }).click();
  await expect(page.getByText('Pausado', { exact: true })).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(1);
});

test('histórico citado não bloqueia envio mas resposta em preparação bloqueia', async () => {
  await createRecurring();
  await page.getByRole('button', { name: 'Fechar agendador' }).click();
  await page.evaluate(() => {
    const quote = document.createElement('div'); quote.dataset.testid = 'quoted-message';
    document.querySelector('#messages')!.append(quote);
  });
  await makeDue(); await expect(page.locator('.message')).toHaveCount(1);
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: unknown[] };
    return db.history.length;
  })).toBe(1);
  await page.evaluate(() => {
    const quote = document.createElement('div'); quote.dataset.testid = 'compose-quoted-message';
    document.querySelector('footer')!.append(quote);
  });
  await makeDue();
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: { result: { status: string } }[] };
    return db.history.at(-1)?.result.status;
  })).toBe('missed');
  await expect(page.locator('.message')).toHaveCount(1);
});

test('reconstrói alarmes e recupera envio interrompido após reiniciar a extensão', async () => {
  await createRecurring();
  await page.getByRole('button', { name: 'Fechar agendador' }).click();
  // Restart Chromium with the same disposable profile. Clear alarms first to prove reconstruction from storage.
  await worker.evaluate(() => chrome.alarms.clearAll());
  await context.close(); await launchProfile(); await openPanel();
  await expect.poll(async () => worker.evaluate(async () => (await chrome.alarms.get('wa-scheduler:next'))?.name)).toBe('wa-scheduler:next');
  await worker.evaluate(async () => {
    const key = 'waSchedulerDatabase';
    const db = (await chrome.storage.local.get(key))[key] as {
      schedules: { id: string; nextAt: number; recipient: { phone: string; label: string } }[];
      inFlight: unknown;
    };
    const scheduled = db.schedules[0]!;
    db.inFlight = { id: `${scheduled.id}:${scheduled.nextAt}`, scheduleId: scheduled.id, scheduledAt: scheduled.nextAt, recipient: scheduled.recipient };
    await chrome.storage.local.set({ [key]: db });
  });
  await context.close(); await launchProfile(); await openPanel();
  await page.getByRole('button', { name: 'Agendamentos (1)' }).click();
  await expect(page.getByText('Pausado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Histórico(?: \(\d+\))?$/ }).click();
  await expect(page.getByText('Resultado incerto', { exact: true })).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(0);
});

test('barra sem main ou footer e com ícones novos mantém o botão e o envio', async () => {
  await page.evaluate(() => {
    document.querySelector('#main')!.removeAttribute('id');
    const footer = document.querySelector('footer')!;
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px;background:#f0f2f5';
    toolbar.append(...footer.childNodes); footer.replaceWith(toolbar);
    const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
    const action = document.querySelector<HTMLElement>('#action')!;
    action.querySelector('[data-icon]')!.setAttribute('data-icon', 'microphone-refreshed');
    editor.addEventListener('input', () => {
      const sending = editor.innerText.length > 0;
      action.setAttribute('aria-label', sending ? 'Enviar' : 'Mensagem de voz');
      action.innerHTML = '<svg></svg>';
    });
  });
  await createRecurring();
  await page.getByRole('button', { name: 'Fechar agendador' }).click();
  await makeDue();
  await expect(page.locator('.message .selectable-text')).toHaveText('Agendada 👋\nsegunda linha');
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: { result: { status: string } }[] };
    return db.history.at(-1)?.result.status;
  })).toBe('sent');
  await expect(page.getByRole('button', { name: 'Agendar mensagem', exact: true })).toHaveCount(1);
});

test('conversa com LID agenda e envia sem inventar telefone nem abrir informações', async () => {
  await page.evaluate(() => {
    (window as unknown as { fixtureChatId: string }).fixtureChatId = '123456789012345@lid';
    document.querySelector('#messages')!.innerHTML = '';
  });
  await page.getByRole('button', { name: 'Agendar mensagem', exact: true }).click();
  await expect(page.getByText('Conversa individual identificada', { exact: true })).toBeVisible();
  await page.getByLabel('Mensagem', { exact: true }).fill('Mensagem para conversa com LID');
  await page.getByLabel('A cada intervalo', { exact: true }).check();
  await page.getByRole('button', { name: 'Agendar mensagem', exact: true }).last().click();
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar agendador' }).click();
  await makeDue();
  await expect.poll(async () => worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as { history: { result: { status: string } }[] };
    return db.history.at(-1)?.result.status;
  })).toBe('sent');
  expect(await page.evaluate(() => (window as unknown as { fixtureContactOpens: number }).fixtureContactOpens)).toBe(0);
});

test('bundle real inicializa sem substituir WPP de terceiros e sem telemetria', async () => {
  const telemetry: string[] = [];
  const failures: string[] = [];
  const smoke = await context.newPage();
  smoke.on('pageerror', error => failures.push(error.message));
  smoke.on('request', request => {
    if (/google-analytics|analytics\.google|googletagmanager/.test(request.url())) telemetry.push(request.url());
  });
  await context.route('https://web.whatsapp.com/runtime-smoke', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body>Runtime smoke test</body></html>',
  }));
  await smoke.goto('https://web.whatsapp.com/runtime-smoke');
  await expect.poll(() => smoke.evaluate(() => typeof window.__waSchedulerPageV1?.identify)).toBe('function');
  expect(await smoke.evaluate(() => window.__waSchedulerPageV1!.identify())).toEqual({ ready: false, recipient: null });
  await smoke.evaluate(() => {
    Object.assign(window, { WPP: { thirdParty: true }, WPPConfig: { thirdParty: true, disableGoogleAnalytics: false } });
  });
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/runtime-smoke' });
    await chrome.scripting.executeScript({ target: { tabId: tabs[0]!.id! }, world: 'MAIN', files: ['content-scripts/whatsapp-main.js'] });
  });
  const globals = await smoke.evaluate(() => {
    const w = window as unknown as { WPP: unknown; WPPConfig: unknown };
    return { WPP: w.WPP, WPPConfig: w.WPPConfig };
  });
  expect(globals).toEqual({ WPP: { thirdParty: true }, WPPConfig: { thirdParty: true, disableGoogleAnalytics: false } });
  await smoke.waitForTimeout(1500);
  expect(telemetry).toEqual([]); expect(failures).toEqual([]);
});

test('troca entre contatos de mesmo nome fecha o painel pela identidade do runtime', async () => {
  await openPanel();
  await page.getByLabel('Mensagem', { exact: true }).fill('Formulário do primeiro contato');
  // Leave the same header node and title: DOM label alone cannot detect this.
  await page.evaluate(() => { (window as unknown as { fixturePhone: string }).fixturePhone = '5511888888888'; });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Agendar mensagem', exact: true }).click();
  await expect(page.getByText('+5511888888888', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveValue('');
});

test('arrasta pelo cabeçalho, preserva a posição durante atualizações e retorna ao reabrir', async () => {
  await openPanel();
  const panel = page.getByRole('dialog');
  const handle = page.getByRole('button', { name: 'Mover painel', exact: true });
  const initial = (await panel.boundingBox())!;
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + 60, start.y + 10);
  await page.mouse.down(); await page.mouse.move(start.x - 240, start.y - 90, { steps: 12 }); await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeLessThan(initial.x - 200); expect(moved.y).toBeLessThan(initial.y - 50);
  await page.evaluate(() => document.querySelector('#messages')!.append(document.createElement('div')));
  await expect.poll(async () => (await panel.boundingBox())!.x).toBe(moved.x);
  await handle.focus(); await handle.press('ArrowRight');
  await expect.poll(async () => (await panel.boundingBox())!.x).toBe(moved.x + 10);
  await page.setViewportSize({ width: 720, height: 650 });
  await expect.poll(async () => {
    const box = (await panel.boundingBox())!;
    return box.x >= 8 && box.y >= 8 && box.x + box.width <= 712 && box.y + box.height <= 642;
  }).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Fechar agendador' }).click(); await openPanel();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.x)).toBe(Math.round(initial.x));
  await expect.poll(async () => Math.round((await panel.boundingBox())!.y)).toBe(Math.round(initial.y));
});

test('cores das ações e histórico com contador persistente por conversa e leitura', async () => {
  await createRecurring();
  const color = (name: string) => page.getByRole('button', { name, exact: true }).evaluate(el => getComputedStyle(el).color);
  expect(await color('Pausar')).toBe('rgb(137, 101, 0)');
  expect(await color('Editar')).toBe('rgb(37, 107, 155)');
  expect(await color('Excluir')).toBe('rgb(179, 38, 30)');
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  expect(await color('Continuar')).toBe('rgb(0, 128, 105)');
  await worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as Database;
    const schedule = db.schedules[0]!;
    db.history = (['sent', 'missed', 'uncertain'] as const).map((status, index) => ({
      id: `history-${index}`, scheduleId: schedule.id, recipient: schedule.recipient,
      scheduledAt: Date.now() - index * 1000, completedAt: Date.now(),
      result: { status, reason: `Resultado de teste ${index}` },
    }));
    await chrome.storage.local.set({ waSchedulerDatabase: db });
  });
  await expect(page.getByRole('button', { name: 'Histórico (3)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar agendador' }).click(); await openPanel();
  await expect(page.getByRole('button', { name: 'Histórico (3)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Histórico (3)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Histórico', exact: true })).toBeVisible();
  const sent = page.getByRole('listitem').filter({ has: page.getByText('Enviada', { exact: true }) });
  const missed = page.getByRole('listitem').filter({ has: page.getByText('Não enviada', { exact: true }) });
  expect(await sent.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(240, 250, 245)');
  expect(await missed.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 245, 244)');
  await page.screenshot({ path: 'artifacts/historico-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await sent.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(32, 55, 47)');
  expect(await missed.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(53, 43, 46)');
  await page.screenshot({ path: 'artifacts/historico-dark.png' });
  await page.reload(); await openPanel();
  await expect(page.getByRole('button', { name: 'Histórico', exact: true })).toBeVisible();
  await worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as Database;
    db.history.push({ ...db.history[0]!, id: 'history-new' });
    await chrome.storage.local.set({ waSchedulerDatabase: db });
  });
  await expect(page.getByRole('button', { name: 'Histórico (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trocar conversa' }).click();
  await page.getByRole('button', { name: 'Agendar mensagem', exact: true }).click();
  await expect(page.getByText('+5511888888888', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Histórico', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trocar conversa' }).click(); await openPanel();
  await expect(page.getByRole('button', { name: 'Histórico (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Histórico (1)', exact: true }).click();
  await worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as Database;
    db.history = [];
    await chrome.storage.local.set({ waSchedulerDatabase: db });
  });
  await expect.poll(() => worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('waSchedulerHistoryRead:')).length)).toBe(0);
});

test('exclusão automática vem desativada, persiste e limpa finalizados sem apagar histórico', async () => {
  await createRecurring();
  const toggle = page.getByRole('switch', { name: /Excluir finalizados automaticamente/ });
  await expect(toggle).not.toBeChecked();
  await worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as Database;
    const original = db.schedules[0]!;
    for (let index = 0; index < 2; index++) {
      const recipient = index ? { phone: '5511888888888', label: 'Outro' } : original.recipient;
      const id = crypto.randomUUID();
      db.schedules.push({ ...original, id, recipient, timing: { kind: 'once', at: Date.now() - 1000 }, nextAt: null, state: 'finished' });
      db.history.push({ id: `${id}:old`, scheduleId: id, recipient, scheduledAt: Date.now() - 1000,
        completedAt: Date.now(), result: { status: 'sent', reason: 'Enviado anteriormente' } });
    }
    await chrome.storage.local.set({ waSchedulerDatabase: db });
  });
  await expect(page.getByRole('button', { name: 'Agendamentos (2)', exact: true })).toBeVisible();
  await expect(page.getByText('Finalizado', { exact: true })).toBeVisible();
  await toggle.check(); await expect(toggle).toBeChecked();
  await expect(page.getByRole('button', { name: 'Agendamentos (1)', exact: true })).toBeVisible();
  const snapshot = await worker.evaluate(async () => (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as Database);
  expect(snapshot.schedules).toHaveLength(1); expect(snapshot.history).toHaveLength(2);
  await page.screenshot({ path: 'artifacts/agendamentos-auto-delete-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'artifacts/agendamentos-auto-delete-dark.png' });
  await page.reload(); await openPanel();
  await page.getByRole('button', { name: 'Agendamentos (1)', exact: true }).click();
  await expect(toggle).toBeChecked();
  await worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('waSchedulerDatabase')).waSchedulerDatabase as Database;
    db.schedules[0]!.timing = { kind: 'once', at: Date.now() + 1000 };
    await chrome.storage.local.set({ waSchedulerDatabase: db });
  });
  await makeDue();
  await expect(page.getByText('Nenhum agendamento nesta conversa.')).toBeVisible();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: /^Histórico/ }).click();
  await expect(page.getByText('Enviada', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Agendamentos (0)', exact: true }).click();
  await toggle.uncheck(); await expect(toggle).not.toBeChecked();
  await page.reload(); await openPanel();
  await page.getByRole('button', { name: 'Agendamentos (0)', exact: true }).click();
  await expect(toggle).not.toBeChecked();
});

test('recriação do cabeçalho da mesma conversa preserva painel e formulário', async () => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPanel();
  await page.getByLabel('Mensagem', { exact: true }).fill('Formulário preservado');
  await page.evaluate(() => {
    const header = document.querySelector('#main > header')!;
    header.replaceWith(header.cloneNode(true));
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveValue('Formulário preservado');
  await page.getByRole('button', { name: 'Fechar agendador' }).click(); await openPanel();
  expect(errors).toEqual([]);
});

test('recupera host removido sem perder o formulário e permite reabrir', async () => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPanel();
  await page.getByLabel('Mensagem', { exact: true }).fill('Texto antes da remoção');
  await page.evaluate(() => document.querySelector('wa-scheduler')!.remove());
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveValue('Texto antes da remoção');
  await page.getByRole('button', { name: 'Fechar agendador' }).click(); await openPanel();
  expect(errors).toEqual([]);
});

test('identificação temporariamente indisponível bloqueia salvar sem fechar ou apagar o formulário', async () => {
  await openPanel();
  await page.getByLabel('Mensagem', { exact: true }).fill('Não perder durante reconexão');
  await page.evaluate(() => {
    const api = window.__waSchedulerPageV1!;
    const original = api.identify;
    api.identify = () => ({ ready: false, recipient: null });
    window.setTimeout(() => { api.identify = original; }, 3000);
  });
  await expect(page.getByRole('button', { name: 'Agendar mensagem', exact: true }).last()).toBeDisabled();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveValue('Não perder durante reconexão');
  await expect(page.getByText('+5511999999999', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agendar mensagem', exact: true }).last()).toBeEnabled();
});
