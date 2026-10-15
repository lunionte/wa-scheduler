import { useEffect, useId, useRef, useState } from 'react';
import type { Database, Recipient, Schedule } from '../core/model';
import { emptyDatabase, recipientKey, recipientSchema } from '../core/model';
import type { Request, Response } from '../core/protocol';
import { parseResponse } from '../core/protocol';
import { formatDateTime, parseLocalDateTime, randomMinute } from '../core/time';
import styles from './Panel.module.css';

interface Props {
  recipient: Recipient | null;
  identifying: boolean;
  refreshRecipient(): void;
  onClose(): void;
  onDragStart?: React.PointerEventHandler<HTMLElement>;
  onDragMove?: React.PointerEventHandler<HTMLElement>;
  onDragEnd?: React.PointerEventHandler<HTMLElement>;
  onMove?: (dx: number, dy: number) => void;
  request?: (message: Request) => Promise<Response>;
}
type Backup = { key: string; text: string; recipient: Recipient; savedAt: number };
const requestDefault = (message: Request): Promise<Response> => chrome.runtime.sendMessage(message);
const localDate = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const localTime = (at: number) => {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const statusLabels = { sent: 'Enviada', missed: 'Não enviada', failed: 'Falha', uncertain: 'Resultado incerto' };

export function ClockIcon({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export default function Panel({ recipient, identifying, refreshRecipient, onClose, onDragStart, onDragMove, onDragEnd, onMove, request = requestDefault }: Props) {
  const [database, setDatabase] = useState<Database>(emptyDatabase);
  const [databaseLoaded, setDatabaseLoaded] = useState(false);
  const [autoDeleteChoice, setAutoDeleteChoice] = useState<boolean | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [tab, setTab] = useState<'form' | 'list' | 'history'>('form');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'once' | 'interval'>('once');
  const [date, setDate] = useState(localDate(Date.now() + 3600000));
  const [time, setTime] = useState(localTime(Date.now() + 3600000));
  const [random, setRandom] = useState(false);
  const [endTime, setEndTime] = useState(localTime(Date.now() + 6000000));
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<'minutes' | 'hours'>('hours');
  const [editing, setEditing] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteId, setDeleteId] = useState<string>();
  const [readHistory, setReadHistory] = useState<Set<string>>(() => new Set());
  const panel = useRef<HTMLElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messageId = useId();
  const identity = recipient ? recipientKey(recipient) : null;

  useEffect(() => {
    panel.current?.focus();
    let alive = true;
    const load = async () => {
      try {
        const response = parseResponse(await request({ type: 'WA_SCHEDULER_SNAPSHOT' }));
        if (!alive) return;
        if (response.ok) { setDatabase(response.database); setDatabaseLoaded(true); } else setError(response.error);
        const stored = await chrome.storage.local.get(null);
        if (alive) setReadHistory(new Set(Object.entries(stored).flatMap(([key, value]) =>
          key.startsWith('waSchedulerHistoryRead:') && value === true ? [key.slice('waSchedulerHistoryRead:'.length)] : [])));
        if (alive) setBackups(Object.entries(stored).flatMap(([key, value]) => {
          if (!key.startsWith('waSchedulerDraft:') || !value || typeof value !== 'object') return [];
          const backup = value as Partial<Omit<Backup, 'key'>>;
          const parsedRecipient = recipientSchema.safeParse(backup.recipient);
          return typeof backup.text === 'string' && typeof backup.savedAt === 'number' && parsedRecipient.success
            ? [{ key, text: backup.text, savedAt: backup.savedAt, recipient: parsedRecipient.data }] : [];
        }));
      } catch { if (alive) setError('A extensão foi atualizada ou está indisponível. Recarregue o WhatsApp Web.'); }
    };
    void load();
    const listener = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local') void load();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => { alive = false; chrome.storage.onChanged.removeListener(listener); };
  }, [request]);

  const schedules = database.schedules.filter(s => recipientKey(s.recipient) === identity).sort((a, b) => b.createdAt - a.createdAt);
  const history = database.history.filter(h => recipientKey(h.recipient) === identity).slice().reverse();
  const unread = history.filter(item => !readHistory.has(item.id));
  const unreadIds = JSON.stringify(unread.map(item => item.id));
  useEffect(() => {
    if (tab !== 'history' || unreadIds === '[]') return;
    const ids: string[] = JSON.parse(unreadIds);
    // One key per occurrence: reads from multiple tabs cannot overwrite each other.
    void chrome.storage.local.set(Object.fromEntries(ids.map(id => [`waSchedulerHistoryRead:${id}`, true])))
      .then(() => setReadHistory(old => new Set([...old, ...ids])))
      .catch(() => setError('Não foi possível marcar o histórico como lido.'));
  }, [tab, unreadIds]);

  async function mutate(command: Request): Promise<Database | null> {
    setPending(true); setError(''); setNotice('');
    try {
      const response = parseResponse(await request(command));
      if (!response.ok) throw new Error(response.error);
      setDatabase(response.database);
      return response.database;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível salvar.');
      return null;
    } finally { setPending(false); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!recipient) { setError('Confirme o contato antes de agendar.'); return; }
    try {
      const start = mode === 'once' ? parseLocalDateTime(date, time) : 0;
      const end = random && mode === 'once' ? parseLocalDateTime(date, endTime) : start;
      const at = random ? randomMinute(start, end) : start;
      const minutes = Number(amount) * (unit === 'hours' ? 60 : 1);
      if (mode === 'interval' && (!Number.isInteger(Number(amount)) || Number(amount) < 1)) {
        throw new Error('Informe uma quantidade inteira maior que zero.');
      }
      const result = await mutate({ type: 'WA_SCHEDULER_SAVE', id: editing, input: {
        recipient, message, timing: mode === 'once' ? {
          kind: 'once', at, ...(random ? { window: { start, end } } : {}),
        } : { kind: 'interval', minutes },
      } });
      if (result) {
        setNotice(mode === 'once' ? `Agendado para ${formatDateTime(at)}${random ? ' (horário sorteado)' : ''}.` : 'Recorrência salva. O primeiro envio acontece após o intervalo.');
        setEditing(undefined); setMessage(''); setTab('list');
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Horário inválido.'); }
  }

  function edit(schedule: Schedule) {
    setEditing(schedule.id); setMessage(schedule.message); setMode(schedule.timing.kind);
    setError(''); setNotice('');
    if (schedule.timing.kind === 'once') {
      const start = schedule.timing.window?.start ?? schedule.timing.at;
      setDate(localDate(start)); setTime(localTime(start));
      setRandom(!!schedule.timing.window); setEndTime(localTime(schedule.timing.window?.end ?? start));
    } else {
      setAmount(String(schedule.timing.minutes)); setUnit('minutes');
    }
    setTab('form');
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function handleKey(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const focusable = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
      const root = panel.current!.getRootNode() as ShadowRoot;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (root.activeElement === first || root.activeElement === panel.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && root.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  return <section ref={panel} className={styles.panel} role="dialog" aria-label="Agendador de mensagens" aria-modal="false" tabIndex={-1} onKeyDown={handleKey}>
    <header className={styles.header} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
      <div className={styles.heading} role="button" tabIndex={0} aria-label="Mover painel" title="Arraste para mover; use as setas quando este controle estiver selecionado" onKeyDown={event => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
        const direction = directions[event.key];
        if (direction) { event.preventDefault(); event.stopPropagation(); onMove?.(...direction); }
      }}><ClockIcon size={22}/><h1>Agendar mensagem</h1></div>
      <button type="button" className={styles.iconButton} aria-label="Fechar agendador" onClick={onClose}>×</button>
    </header>
    <div className={styles.contact}>
      <span className={styles.contactDot}/>
      <div><strong>{identifying ? 'Identificando contato…' : recipient?.label ?? 'Contato não confirmado'}</strong>
        <small>{recipient ? recipient.phone ? `+${recipient.phone}` : 'Conversa individual identificada' : 'Abra uma conversa individual e aguarde o WhatsApp terminar de carregar.'}</small></div>
      {!recipient && !identifying && <button type="button" className={styles.linkButton} onClick={refreshRecipient}>Verificar</button>}
    </div>
    <nav className={styles.tabs} aria-label="Seções do agendador">
      {([['form', 'Mensagem'], ['list', `Agendamentos (${schedules.length})`], ['history', unread.length ? `Histórico (${unread.length})` : 'Histórico']] as const).map(([value, label]) =>
        <button type="button" key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}
    </nav>
    <div className={styles.content}>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {notice && <div role="status" className={styles.success}>{notice}</div>}
      {backups.filter(b => recipientKey(b.recipient) === identity).map(backup => <div className={styles.backup} key={backup.key}>
        <strong>Rascunho preservado</strong><p>Copie este texto para recuperar seu rascunho.</p>
        <textarea aria-label="Rascunho preservado" readOnly value={backup.text}/>
        <button type="button" className={styles.linkButton} onClick={async () => {
          await chrome.storage.local.remove(backup.key); setBackups(old => old.filter(b => b.key !== backup.key));
        }}>Já recuperei o rascunho</button>
      </div>)}
      {tab === 'form' && <form onSubmit={save}>
        {editing && <div className={styles.editing}>Editando agendamento <button type="button" className={styles.linkButton} onClick={() => { setEditing(undefined); setMessage(''); }}>Cancelar edição</button></div>}
        <div className={styles.field}><label htmlFor={messageId}>Mensagem</label><textarea id={messageId} ref={textarea} value={message} onChange={e => setMessage(e.target.value)} rows={4} maxLength={10000} required placeholder="Escreva a mensagem que será enviada…"/></div>
        <fieldset className={styles.mode}><legend>Quando enviar</legend>
          <label><input type="radio" name="mode" checked={mode === 'once'} onChange={() => setMode('once')}/>Data e hora</label>
          <label><input type="radio" name="mode" checked={mode === 'interval'} onChange={() => setMode('interval')}/>A cada intervalo</label>
        </fieldset>
        {mode === 'once' ? <>
          <div className={styles.row}><label className={styles.field}>Data<input type="date" value={date} min={localDate(Date.now())} onChange={e => setDate(e.target.value)} required/></label>
            <label className={styles.field}>{random ? 'Entre' : 'Hora'}<input type="time" value={time} onChange={e => setTime(e.target.value)} required/></label>
            {random && <label className={styles.field}>E<input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required/></label>}</div>
          <label className={styles.checkbox}><input type="checkbox" checked={random} onChange={e => setRandom(e.target.checked)}/>Sortear horário dentro de uma janela</label>
          {random && <p className={styles.help}>Um minuto será sorteado ao salvar. O envio acontece uma única vez.</p>}
        </> : <>
          <div className={styles.row}><label className={styles.field}>A cada<input type="number" min="1" max={unit === 'hours' ? 8760 : 525600} step="1" value={amount} onChange={e => setAmount(e.target.value)} required/></label>
            <label className={styles.field}>Unidade<select value={unit} onChange={e => setUnit(e.target.value as 'minutes' | 'hours')}><option value="minutes">Minutos</option><option value="hours">Horas</option></select></label></div>
          <p className={styles.help}>O primeiro envio ocorre após o intervalo. A repetição continua até você pausar ou excluir.</p>
        </>}
        <button type="submit" className={styles.primary} disabled={pending || !recipient || identifying}>{pending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Agendar mensagem'}</button>
      </form>}
      {tab === 'list' && <>
        <label className={styles.autoDelete}>
          <span><strong>Excluir finalizados automaticamente</strong><small>Vale para todas as conversas. Ao ativar, remove também os já finalizados. O histórico é mantido.</small></span>
          <input type="checkbox" role="switch" checked={autoDeleteChoice ?? database.settings.autoDeleteFinished} disabled={pending || !databaseLoaded}
            onChange={event => {
              const enabled = event.target.checked;
              setAutoDeleteChoice(enabled);
              void mutate({ type: 'WA_SCHEDULER_SETTINGS', autoDeleteFinished: enabled }).finally(() => setAutoDeleteChoice(null));
            }}/>
          <span className={styles.switchTrack} aria-hidden="true"/>
        </label>
        {schedules.length ? <ul className={styles.list}>{schedules.map(schedule => <li className={styles.card} key={schedule.id}>
        <div className={styles.cardTitle}><strong>{schedule.timing.kind === 'once' ? 'Envio único' : `A cada ${schedule.timing.minutes} min`}</strong>
          <span className={styles.badge}>{schedule.state === 'active' ? 'Ativo' : schedule.state === 'paused' ? 'Pausado' : 'Finalizado'}</span></div>
        <p className={styles.message}>{schedule.message}</p>
        <small>{schedule.nextAt && schedule.state === 'active' ? `Próximo: ${formatDateTime(schedule.nextAt)}` : 'Sem próximo envio ativo'}</small>
        {schedule.timing.kind === 'once' && schedule.timing.window && <small>Horário sorteado: {formatDateTime(schedule.timing.at)}</small>}
        <div className={styles.actions}>
          <button type="button" className={styles.editAction} disabled={pending} onClick={() => edit(schedule)}>Editar</button>
          {schedule.timing.kind === 'interval' && <button type="button" className={schedule.state === 'active' ? styles.pauseAction : styles.resumeAction} disabled={pending} onClick={() => void mutate({ type: 'WA_SCHEDULER_PAUSE', id: schedule.id, paused: schedule.state === 'active' })}>{schedule.state === 'active' ? 'Pausar' : 'Continuar'}</button>}
          <button type="button" className={styles.deleteAction} disabled={pending} onClick={() => setDeleteId(schedule.id)}>Excluir</button>
        </div>
        {deleteId === schedule.id && <div className={styles.confirm}><span>Excluir este agendamento?</span><button type="button" className={styles.deleteAction} disabled={pending} onClick={async () => { await mutate({ type: 'WA_SCHEDULER_DELETE', id: schedule.id }); setDeleteId(undefined); }}>Excluir</button><button type="button" onClick={() => setDeleteId(undefined)}>Cancelar</button></div>}
      </li>)}</ul> : <div className={styles.empty}><ClockIcon size={36}/><p>Nenhum agendamento nesta conversa.</p><button type="button" className={styles.linkButton} onClick={() => setTab('form')}>Criar agendamento</button></div>}
      </>}
      {tab === 'history' && (history.length ? <ul className={styles.list}>{history.map(item => <li className={`${styles.card} ${item.result.status === 'sent' ? styles.historySent : styles.historyNotSent}`} key={item.id}>
        <div className={styles.cardTitle}><strong>{statusLabels[item.result.status]}</strong><small>{formatDateTime(item.scheduledAt)}</small></div>
        <p className={styles.help}>{item.result.reason}</p>
      </li>)}</ul> : <p className={styles.empty}>Os resultados dos envios aparecerão aqui.</p>)}
    </div>
    <footer className={styles.footnote}>Mantenha esta conversa aberta. Envios perdidos são pulados.<br/>Horário do sistema · tolerância de atraso de até 60 segundos.</footer>
  </section>;
}
