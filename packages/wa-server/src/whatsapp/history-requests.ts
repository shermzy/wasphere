import { proto } from '@whiskeysockets/baileys';

// HIDDENXP FORK: on-demand chat history. sock.fetchMessageHistory() only sends a
// request to the phone; the answer arrives later as a 'messaging-history.set'
// event with syncType ON_DEMAND. This class pairs the two so the HTTP caller gets
// the messages in the response body. Nothing here fires a webhook.

export interface HistorySetEvent {
  syncType?: proto.HistorySync.HistorySyncType | null;
  peerDataRequestSessionId?: string | null;
  messages: proto.IWebMessageInfo[];
}

interface Pending {
  sessionId: string;
  chatJid: string;
  requestId?: string;
  resolve: (messages: proto.IWebMessageInfo[]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class HistoryTimeoutError extends Error {}
export class HistoryBusyError extends Error {}

export class HistoryRequests {
  private readonly pending = new Map<string, Pending>();

  private static keyOf(sessionId: string, chatJid: string) {
    return `${sessionId}|${chatJid}`;
  }

  /**
   * Registers a wait for one chat before the request is sent (the answer can
   * arrive before the send call returns). One request per chat at a time.
   */
  open(sessionId: string, chatJid: string, timeoutMs: number) {
    const key = HistoryRequests.keyOf(sessionId, chatJid);
    if (this.pending.has(key)) throw new HistoryBusyError('a history request for this chat is already running');
    let entry!: Pending;
    const done = new Promise<proto.IWebMessageInfo[]>((resolve, reject) => {
      entry = {
        sessionId,
        chatJid,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(key);
          reject(new HistoryTimeoutError('the phone did not answer in time'));
        }, timeoutMs),
      };
    });
    this.pending.set(key, entry);
    // The timer or dropSession can reject before the caller awaits `done` (it is
    // still awaiting the send). Without this, Node treats that as unhandled and exits.
    done.catch(() => {});
    return {
      done,
      setRequestId: (id: string) => { entry.requestId = id; },
      cancel: (err: Error) => this.finish(key, entry, () => entry.reject(err)),
    };
  }

  /** Called for every 'messaging-history.set'. Returns true when a request was answered. */
  settle(sessionId: string, event: HistorySetEvent): boolean {
    if (event.syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND) return false;
    let answered = false;
    for (const [key, entry] of this.pending) {
      if (entry.sessionId !== sessionId) continue;
      const forChat = event.messages.filter((m) => m.key?.remoteJid === entry.chatJid);
      const idMatch = !!entry.requestId && entry.requestId === event.peerDataRequestSessionId;
      if (!idMatch && forChat.length === 0) continue;
      this.finish(key, entry, () => entry.resolve(forChat));
      answered = true;
    }
    return answered;
  }

  /** Rejects every wait of a session (socket closed or deleted). */
  dropSession(sessionId: string, err: Error) {
    for (const [key, entry] of this.pending) {
      if (entry.sessionId === sessionId) this.finish(key, entry, () => entry.reject(err));
    }
  }

  private finish(key: string, entry: Pending, act: () => void) {
    if (this.pending.get(key) !== entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    act();
  }
}

export interface HistoryMessage {
  messageId: string | null | undefined;
  fromMe: boolean;
  sender: string | null | undefined;
  senderPn: string | null;
  pushName: string | null;
  timestamp: number | null;
  type: string | undefined;
  text: string | null;
}

function toSeconds(t: proto.IWebMessageInfo['messageTimestamp']): number | null {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  return typeof (t as any).toNumber === 'function' ? (t as any).toNumber() : Number(t);
}

/** Compact, text-only shape for history (no media download). Oldest first. */
export function toHistoryMessages(
  messages: proto.IWebMessageInfo[],
  contentTypeOf: (m: proto.IMessage) => string | undefined,
): HistoryMessage[] {
  const skip = new Set(['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'associatedChildMessage']);
  return messages
    .filter((m) => m.message)
    .map((m) => {
      const c = m.message!;
      const type = contentTypeOf(c);
      const key = m.key as typeof m.key & { participantAlt?: string | null };
      return {
        messageId: m.key?.id,
        fromMe: !!m.key?.fromMe,
        sender: m.key?.participant || m.key?.remoteJid,
        senderPn: key?.participantAlt ?? null,
        pushName: m.pushName ?? null,
        timestamp: toSeconds(m.messageTimestamp),
        type,
        text:
          c.conversation ??
          c.extendedTextMessage?.text ??
          c.imageMessage?.caption ??
          c.videoMessage?.caption ??
          c.documentMessage?.caption ??
          null,
      };
    })
    .filter((m) => !skip.has(m.type ?? ''))
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
