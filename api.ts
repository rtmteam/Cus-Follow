import { getRealNetworkTime } from './utils';

/**
 * نداء الخادم بطلب POST وقراءة ردّه JSON.
 *
 * `text/plain` طلب بسيط لا يستدعي preflight، ويُقرأ ردّه — بخلاف `no-cors`
 * الذي يُعمي الاستجابة. ولأن الطلب POST لا تظهر كلمة المرور في الرابط.
 *
 * @throws Error برسالة مصنّفة:
 *   NO_LINK · SERVER_404 · HTTP <n> · INVALID_RESPONSE · OLD_SERVER_CODE · AbortError
 */
export const postJson = async (url: string, payload: unknown, timeoutMs: number): Promise<any> => {
  if (!url || !url.startsWith('http')) throw new Error('NO_LINK');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  beginServerRequest();
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    endServerRequest();
  }

  if (response.status === 404) throw new Error('SERVER_404');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const text = (await response.text()).trim();
  // صفحة تسجيل دخول جوجل أو صفحة خطأ HTML بدل ردّ الكود
  if (!text || text.startsWith('<')) throw new Error('INVALID_RESPONSE');

  try {
    return JSON.parse(text);
  } catch {
    // ردّ نصّي مثل «Error: Unknown action» = كود الخادم المنشور أقدم من التطبيق
    throw new Error('OLD_SERVER_CODE');
  }
};

/**
 * رموز الخادم التي تعني أن الجلسة المحفوظة على الهاتف لم تعد صالحة:
 * كلمة المرور تغيّرت، أو الحساب حُذف، أو فُكّ ربط الجهاز.
 * عندها يُخرَج المستخدم إلى شاشة الدخول. أي فشل آخر (شبكة، مهلة) لا يُخرجه.
 */
export const SESSION_INVALID_CODES = ['AUTH_FAILED', 'DEVICE_NOT_LINKED', 'UNAUTHORIZED'];

/** رسالة عربية لأخطاء الاتصال — لا تدّعي أن شيئاً لم يُحفظ */
export const describeConnectionError = (err: any): string => {
  if (err?.name === 'AbortError') {
    return 'الشبكة بطيئة ولم يصل ردّ الخادم في الوقت المحدد. انتقل لمكان بتغطية أفضل وأعد المحاولة.';
  }
  if (err?.message === 'NO_LINK') return 'التطبيق غير مربوط بالخادم بعد. انتظر لحظات أو أعد فتح التطبيق.';
  if (err?.message === 'SERVER_404') return 'رابط الخادم غير صحيح أو تم حذفه (404). راجع المسؤول.';
  if (err?.message === 'INVALID_RESPONSE') return 'الرابط المسجل لا يؤدي إلى كود النظام. راجع المسؤول.';
  if (err?.message === 'OLD_SERVER_CODE') return 'كود الخادم المنشور أقدم من التطبيق. راجع المسؤول لنشر التحديث.';
  return 'تعذّر الاتصال بالخادم. تأكد من الإنترنت وحاول مجدداً.';
};

// =====================================================================
//  الطلبات المهمة الجارية — سجلّ المراقبة لا يُرسَل أثناءها
// =====================================================================
//
// قيس في ٢٨ سبتمبر: خمسة طلبات متزامنة للخادم ← واحد منها استغرق ١٧ ثانية
// (جوجل تشغّل نسخة جديدة من السكربت للطلب الزائد). فسطر السجل الذي كان
// يُرسَل مع الدخول وفتح الزيارة في اللحظة نفسها كان يُبطئ أحدهما.

let inFlight = 0;
let lastServerContact = 0;

/** يُعلَّم عند بدء طلب مهم (دخول · مزامنة · أمر زيارة) */
export const beginServerRequest = (): void => { inFlight++; };

/** يُعلَّم عند انتهائه — نجح أو فشل */
export const endServerRequest = (): void => {
  inFlight = Math.max(0, inFlight - 1);
  lastServerContact = Date.now();
  if (inFlight === 0) scheduleAuditFlush(AUDIT_QUIET_MS);
};

// =====================================================================
//  إيقاظ الخادم مبكراً
// =====================================================================
//
// Apps Script ينام بعد دقائق بلا طلبات، وأول طلب بعدها ٦–١٧ ثانية بدل ٢–٣.
// طلب ping صغير لا يلمس الشيت يُرسَل حين نعرف أن طلباً مهماً قادم (فتح شاشة
// الدخول · اختيار عميل)، فيكون الخادم قد استيقظ لحظة الضغط.

const PING_EVERY_MS = 60000;
let lastPing = 0;

export const wakeServer = (url: string | undefined): void => {
  if (!url || !url.startsWith('http')) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const now = Date.now();
  // لا داعي إن كان هناك طلب جارٍ أو اتصال حديث — الخادم مستيقظ
  if (inFlight > 0 || now - lastPing < PING_EVERY_MS || now - lastServerContact < PING_EVERY_MS) return;
  lastPing = now;
  const sep = url.includes('?') ? '&' : '?';
  // no-cors: لا نحتاج الردّ، ولا نريد أي فحص CORS يؤخّر الطلب
  fetch(url + sep + 'action=ping', { method: 'GET', mode: 'no-cors', cache: 'no-store' }).catch(() => {});
};

// =====================================================================
//  سجلّ المراقبة — طابور على الهاتف يُرسَل دفعةً واحدة
// =====================================================================
//
// كان كل سطر طلباً مستقلاً يُرسَل فوراً — مع الدخول ومع فتح الزيارة نفسها —
// ويفتح ملف السجل المنفصل من جديد في كل مرة. الآن: السطر يُحفظ على الهاتف
// بوقت حدوثه، ويُرسَل الطابور دفعةً واحدة بعد هدوء ٥ ثوانٍ ولا شيء مهم جارٍ.
// فشل الإرسال لا يُضيّع شيئاً: يبقى الطابور ويُعاد لاحقاً.

const AUDIT_KEY = 'cusfollow_audit_queue';
const AUDIT_MAX = 200;       // أقصى ما يُحفظ على الهاتف (الأقدم يسقط أولاً)
const AUDIT_BATCH = 50;      // أقصى ما يُرسَل في طلب واحد
const AUDIT_QUIET_MS = 5000; // هدوء قبل الإرسال
const AUDIT_RETRY_MS = 30000;

interface AuditEntry {
  id: string;
  at: string;
  user: string;
  auditAction: string;
  details: string;
  deviceInfo: string;
}

let auditUrl = '';
let auditSheetId = '';
let auditTimer: ReturnType<typeof setTimeout> | null = null;
let auditFlushing = false;

const readAuditQueue = (): AuditEntry[] => {
  try {
    const q = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');
    return Array.isArray(q) ? q : [];
  } catch { return []; }
};

const writeAuditQueue = (q: AuditEntry[]): void => {
  try { localStorage.setItem(AUDIT_KEY, JSON.stringify(q.slice(-AUDIT_MAX))); } catch { /* الذاكرة ممتلئة — نتجاوز */ }
};

/** رابط الخادم ومعرّف ملف السجل — يُضبطان كلما تغيّرت الإعدادات */
export const configureAudit = (url: string | undefined, sheetId: string | undefined): void => {
  auditUrl = url || '';
  auditSheetId = sheetId || '';
  if (auditUrl) scheduleAuditFlush(AUDIT_QUIET_MS); // ما تبقّى من جلسة سابقة
};

/** يضيف سطراً للطابور — لا ينتظر شيئاً ولا يرسل فوراً */
export const queueAudit = (user: string, auditAction: string, details: string): void => {
  const q = readAuditQueue();
  q.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    at: getRealNetworkTime().toISOString(),
    user,
    auditAction,
    details,
    deviceInfo: typeof navigator !== 'undefined' ? navigator.userAgent : ''
  });
  writeAuditQueue(q);
  scheduleAuditFlush(AUDIT_QUIET_MS);
};

export const scheduleAuditFlush = (ms: number): void => {
  if (auditTimer) clearTimeout(auditTimer);
  auditTimer = setTimeout(() => { auditTimer = null; flushAudit(); }, ms);
};

const flushAudit = async (): Promise<void> => {
  if (auditFlushing || !auditUrl || !auditUrl.startsWith('http')) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { scheduleAuditFlush(AUDIT_RETRY_MS); return; }
  if (inFlight > 0) return; // endServerRequest يعيد الجدولة عند انتهاء الطلب المهم

  const batch = readAuditQueue().slice(0, AUDIT_BATCH);
  if (batch.length === 0) return;

  auditFlushing = true;
  let sent = false;
  try {
    const res = await fetch(auditUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'logAuditBatch', entries: batch, spreadsheetId: auditSheetId })
    });
    const text = res.ok ? await res.text() : '';
    sent = text.includes('Audit Logged');
  } catch { sent = false; }
  auditFlushing = false;
  lastServerContact = Date.now();

  if (sent) {
    // الحذف بالمعرّف لا بالعدد: قد تُضاف سطور جديدة أثناء الإرسال
    const done = new Set(batch.map(e => e.id));
    const rest = readAuditQueue().filter(e => !done.has(e.id));
    writeAuditQueue(rest);
    if (rest.length > 0) scheduleAuditFlush(1000);
  } else {
    // خادم لم يُحدَّث بعد، أو شبكة — يبقى الطابور ويُعاد لاحقاً
    scheduleAuditFlush(AUDIT_RETRY_MS);
  }
};
