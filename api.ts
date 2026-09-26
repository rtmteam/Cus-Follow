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
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
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
