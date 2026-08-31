
/**
 * Calculates the distance between two points in meters using Haversine formula
 */
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

export const formatDate = (dateStr: string) => {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(dateStr));
};

/**
 * يحصل على معرف الجهاز الحقيقي والفريد غير القابل للتكرار أو التغير لنفس الهاتف
 * يدعم القراءة المباشرة من نظام الأندرويد (Android ID / Native Hardware)
 * وعلى المتصفح ينشئ بصمة عتادية فريدة محفورة ومخزنة بآلية غير قابلة للمسح بسهولة
 */
export const getDeviceFingerprint = (): string => {
  const win = window as any;

  // 1. المصدر الأدق: ANDROID_ID من نظام الأندرويد عبر الجسر الأصلي.
  //    ثابت عند حذف التطبيق وإعادة تثبيته ما دام مفتاح التوقيع لم يتغير.
  if (win.AndroidBridge && typeof win.AndroidBridge.getAndroidId === 'function') {
    try {
      const androidId = win.AndroidBridge.getAndroidId();
      if (androidId && String(androidId).length > 5) {
        const canonical = 'android_' + androidId;
        // نحفظ نسخة محلية ليبقى المعرّف متاحاً لو تعطّل الجسر لاحقاً
        try { localStorage.setItem('uniteam_device_token', canonical); } catch (e) {}
        return canonical;
      }
    } catch (e) {}
  }

  // 2. نفس المعرّف عبر الغلاف المساعد، وهو يعيده بالصيغة الموحّدة نفسها
  if (win.UniteamNative && typeof win.UniteamNative.getDeviceId === 'function') {
    try {
      const nativeId = win.UniteamNative.getDeviceId();
      if (nativeId && String(nativeId).indexOf('android_') === 0) {
        try { localStorage.setItem('uniteam_device_token', nativeId); } catch (e) {}
        return nativeId;
      }
    } catch (e) {}
  }

  // 2. الفحص والتخزين للويب مع بناء بصمة عتادية دقيقة (Hardware Fingerprint)
  let deviceId = localStorage.getItem('uniteam_device_token');

  // ترقية المعرّفات القديمة إلى الصيغة المعتمدة.
  // نسخ سابقة من التطبيق ولّدت معرّفات ببادئات مختلفة (dev_ / native_dev_ / native_hw_)،
  // وهي محفوظة في متصفحات الموظفين ولا يمسحها تصفير الأجهزة من لوحة المشرف.
  // بدون هذا السطر ستعود البادئة القديمة إلى الشيت عند إعادة التسجيل.
  // الصيغتان المعتمدتان فقط: android_ من التطبيق، و hw_ من المتصفح.
  if (deviceId && !/^(hw_|android_)/.test(deviceId)) {
    try { localStorage.removeItem('uniteam_device_token'); } catch (e) {}
    deviceId = null;
  }

  // إبطال المعرّفات المولّدة بالطريقة المعيبة السابقة.
  // كانت تبني نصاً يبدأ بمقاس الشاشة ثم تشفّره وتقتطع أول 18 حرفاً،
  // و18 حرف base64 تمثّل أول 13 بايت فقط - أي مقاس الشاشة وحده،
  // فيُقطع الجزء العشوائي بالكامل ويحصل كل جهازين متطابقي المواصفات
  // على المعرّف نفسه. تُكتشف هذه المعرّفات بفك تشفيرها والبحث عن نمط المقاس.
  if (deviceId && deviceId.indexOf('hw_') === 0) {
    try {
      // 16 حرف base64 تُفك إلى 12 بايت، وقد ينتهي المقاس عندها بلا شرطة سفلية
      const decoded = atob(deviceId.substring(3, 19));
      if (/^\d{2,5}x\d{2,5}x\d{1,2}(_|$)/.test(decoded)) {
        try { localStorage.removeItem('uniteam_device_token'); } catch (e) {}
        deviceId = null;
      }
    } catch (e) {
      // ليس نصاً مشفّراً بـ base64 - معرّف بالصيغة الجديدة، يُترك كما هو
    }
  }

  if (!deviceId) {
    // معرّف عشوائي بالكامل. الاعتماد على مواصفات العتاد غير مجدٍ هنا:
    // ملايين الهواتف تشترك في مقاس الشاشة وعدد الأنوية، فلا تضيف تمييزاً.
    let random = '';
    try {
      const buffer = new Uint8Array(24);
      (window.crypto || (window as any).msCrypto).getRandomValues(buffer);
      random = Array.prototype.map
        .call(buffer, (b: number) => b.toString(36))
        .join('');
    } catch (e) {
      random = '';
    }
    // بديل للمتصفحات القديمة التي لا تدعم crypto
    while (random.length < 18) {
      random += Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    deviceId = 'hw_' + random.replace(/[^a-z0-9]/g, '').substring(0, 18);
    localStorage.setItem('uniteam_device_token', deviceId);
    
    // حفظ نسخة احتياطية في IndexedDB لضمان بقاء الرقم نفسه حتى لو قام الموظف بمسح التخزين المحلي
    try {
      const request = indexedDB.open('UniteamSecurityDB', 1);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('security')) {
          db.createObjectStore('security', { keyPath: 'key' });
        }
      };
      request.onsuccess = (e: any) => {
        const db = e.target.result;
        const tx = db.transaction('security', 'readwrite');
        tx.objectStore('security').put({ key: 'device_id', value: deviceId });
      };
    } catch (e) {}
  }
  return deviceId;
};

/**
 * فحص ما إذا كان الهاتف يعمل في "وضع المطور" (Developer Options / USB Debugging)
 */
export const checkDeveloperOptionsStatus = (): { enabled: boolean; source: string } => {
  const win = window as any;

  // 1. القراءة المباشرة من إعدادات نظام الأندرويد عبر الجسر الأصلي
  if (win.AndroidBridge && typeof win.AndroidBridge.isDeveloperOptionsEnabled === 'function') {
    try {
      const isDev = win.AndroidBridge.isDeveloperOptionsEnabled();
      if (isDev) {
        let detail = '';
        try {
          if (typeof win.AndroidBridge.getDeveloperOptionsDetail === 'function') {
            detail = win.AndroidBridge.getDeveloperOptionsDetail() || '';
          }
        } catch (e) {}
        return {
          enabled: true,
          source: detail ? `إعدادات النظام - ${detail}` : 'إعدادات نظام الأندرويد'
        };
      }
      // الجسر موجود وأكد أن الجهاز سليم، فلا حاجة لفحوصات تقديرية
      return { enabled: false, source: 'System Clean' };
    } catch (e) {}
  }
  if (win.UniteamNative && typeof win.UniteamNative.isDeveloperMode === 'function') {
    try {
      const isDev = win.UniteamNative.isDeveloperMode();
      if (isDev) {
        let detail = '';
        try {
          if (typeof win.UniteamNative.getDeveloperModeDetail === 'function') {
            detail = win.UniteamNative.getDeveloperModeDetail() || '';
          }
        } catch (e) {}
        return {
          enabled: true,
          source: detail ? `إعدادات النظام - ${detail}` : 'Uniteam Native Bridge'
        };
      }
    } catch (e) {}
  }

  // 2. فحص محاكيات المطورين بيئياً
  if (win.__REACT_DEVTOOLS_GLOBAL_HOOK__ && win.location.search.includes('force_dev_mode=true')) {
    return { enabled: true, source: 'Browser DevTools Hook' };
  }

  return { enabled: false, source: 'System Clean' };
};

/**
 * فحص وتكتشف برامج الموقع الوهمي (Fake Location / Mock Location)
 */
export const checkMockLocationStatus = (position?: GeolocationPosition): { isFake: boolean; reason?: string } => {
  const win = window as any;

  // 1. فحص علامات الأندرويد المباشرة في كائن الإحداثيات (Android Mock Flag)
  if (position) {
    const rawPos = position as any;
    if (rawPos.coords && rawPos.coords.isMock === true) {
      return { isFake: true, reason: 'تم كشف علم الموقع الوهمي في نظام الأندرويد (isMock flag)' };
    }
    if (rawPos.isMock === true) {
      return { isFake: true, reason: 'تم كشف مزود موقع غير موثوق (Mock Location Provider)' };
    }

    // 2. فحص التناقضات الحسابية لنظام الـ GPS الفيك (Anomalies Detection)
    // - دقة خيالية ثابته مساوية لصفر أو شاذة جداً
    if (position.coords.accuracy === 0) {
      return { isFake: true, reason: 'دقة موقع غير طبيعية (Accuracy = 0m) تشير إلى استخدام برامج Fake GPS' };
    }
  }

  // 3. الفحص العميق عبر الجسر الأصلي: علم isMock على إحداثيات النظام،
  //    أو وجود تطبيق ممنوح صلاحية "تعيين موقع وهمي"
  if (win.AndroidBridge && typeof win.AndroidBridge.isMockLocationActive === 'function') {
    try {
      if (win.AndroidBridge.isMockLocationActive()) {
        let detail = '';
        try {
          if (typeof win.AndroidBridge.getMockLocationDetail === 'function') {
            detail = win.AndroidBridge.getMockLocationDetail() || '';
          }
        } catch (e) {}
        return {
          isFake: true,
          reason: detail || 'تم كشف نشاط موقع وهمي بواسطة نظام الأندرويد'
        };
      }
    } catch (e) {}
  }

  if (win.UniteamNative && typeof win.UniteamNative.isMockLocation === 'function') {
    try {
      if (win.UniteamNative.isMockLocation()) {
        let detail = '';
        try {
          if (typeof win.UniteamNative.getMockLocationDetail === 'function') {
            detail = win.UniteamNative.getMockLocationDetail() || '';
          }
        } catch (e) {}
        return {
          isFake: true,
          reason: detail || 'تم كشف نشاط موقع وهمي بواسطة نظام الأندرويد'
        };
      }
    } catch (e) {}
  }

  return { isFake: false };
};

// ==========================================
// نظام مزامنة الوقت الحقيقي وحمايته من التلاعب (Anti-Clock Tampering System)
// ==========================================

let syncBaseTimeMs = Date.now();
let syncBasePerfMs = performance.now();
let lastSavedTimeMs = 0;
let hasSyncedWithServer = false;

// 1. تحميل الفرق المخزن مسبقاً من التخزين المحلي لتسهيل العمل فوراً
const savedOffsetStr = localStorage.getItem('uniteam_time_offset');
let initialOffset = 0;
if (savedOffsetStr) {
  initialOffset = parseInt(savedOffsetStr, 10) || 0;
}

// 2. حساب الوقت الافتراضي عند بدء التشغيل
let initialTimeMs = Date.now() + initialOffset;

// 3. التحقق من تلاعب الساعة وإعادتها للوراء عند بدء التشغيل
const lastKnownStr = localStorage.getItem('uniteam_last_known_real_time');
if (lastKnownStr) {
  const lastKnown = parseInt(lastKnownStr, 10) || 0;
  if (initialTimeMs < lastKnown) {
    console.warn('Clock tampering/rewinding detected on startup.');
    // نجبر التطبيق على البدء من آخر وقت حقيقي موثق + ثانية واحدة
    initialTimeMs = lastKnown + 1000;
    // تعديل الفارق لمنع التلاعب
    initialOffset = initialTimeMs - Date.now();
    localStorage.setItem('uniteam_time_offset', initialOffset.toString());
  }
}

// تثبيت نقطة الأساس للوقت والمؤقت عالي الدقة (Monotonic Clock)
syncBaseTimeMs = initialTimeMs;
syncBasePerfMs = performance.now();

/**
 * مزامنة وقت التطبيق مع خوادم موثوقة (خادم التطبيق أو API عامة)
 */
export const syncTimeWithServer = async () => {
  const startTime = performance.now();
  
  // المحاولة 1: جلب الوقت من خادم التطبيق المحلي (سريع وموثوق جداً ومحمي من جدار الحماية)
  try {
    const res = await fetch('/server-config.json?t=' + Date.now(), { method: 'HEAD' });
    const serverDateHeader = res.headers.get('date');
    if (serverDateHeader) {
      const serverTime = new Date(serverDateHeader).getTime();
      const endTime = performance.now();
      const rtt = endTime - startTime; // زمن الرحلة ذهاباً وإياباً
      const adjustedServerTime = serverTime + (rtt / 2); // تصحيح الوقت بإضافة نصف الـ RTT

      const offset = adjustedServerTime - Date.now();
      localStorage.setItem('uniteam_time_offset', offset.toString());
      
      // تحديث نقاط الأساس في الذاكرة
      syncBaseTimeMs = adjustedServerTime;
      syncBasePerfMs = endTime;
      hasSyncedWithServer = true;
      console.log('Time synced with app server. Base:', new Date(syncBaseTimeMs).toISOString());
      return;
    }
  } catch (e) {
    console.warn('App server sync failed, attempting fallbacks...', e);
  }

  // المحاولة 2: جلب الوقت من WorldTimeAPI لجمهورية مصر العربية
  try {
    const res = await fetch('https://worldtimeapi.org/api/timezone/Africa/Cairo');
    if (res.ok) {
      const data = await res.json();
      if (data && data.unixtime) {
        const serverTime = data.unixtime * 1000;
        const endTime = performance.now();
        const rtt = endTime - startTime;
        const adjustedServerTime = serverTime + (rtt / 2);

        const offset = adjustedServerTime - Date.now();
        localStorage.setItem('uniteam_time_offset', offset.toString());

        // تحديث نقاط الأساس في الذاكرة
        syncBaseTimeMs = adjustedServerTime;
        syncBasePerfMs = endTime;
        hasSyncedWithServer = true;
        console.log('Time synced with WorldTimeAPI (Egypt). Base:', new Date(syncBaseTimeMs).toISOString());
        return;
      }
    }
  } catch (e) {
    console.warn('WorldTimeAPI sync failed.', e);
  }
};

/**
 * الحصول على الوقت الحقيقي الموثق (UTC) غير القابل للتلاعب
 * يعتمد على مؤقت المتصفح الأحادي (performance.now) لضمان زيادة بمعدل 1 ثانية في الثانية مهما حصل من تلاعب في ساعة الهاتف أثناء الجلسة
 */
export const getRealNetworkTime = (): Date => {
  const elapsedMs = performance.now() - syncBasePerfMs;
  const currentRealTimeMs = syncBaseTimeMs + elapsedMs;

  // حفظ آخر وقت حقيقي معروف في التخزين المحلي بحد أقصى مرة كل 5 ثوانٍ لتجنب الحلقات اللانهائية السريعة وحماية الأداء
  const nowPerf = performance.now();
  if (nowPerf - lastSavedTimeMs > 5000) {
    localStorage.setItem('uniteam_last_known_real_time', Math.round(currentRealTimeMs).toString());
    lastSavedTimeMs = nowPerf;
  }

  return new Date(currentRealTimeMs);
};

/**
 * استخراج تفاصيل التاريخ والوقت لجمهورية مصر العربية بالتحديد (توقيت القاهرة) بغض النظر عن لغة ونطاق الهاتف
 */
export function getEgyptDateTimeComponents(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const components: { [key: string]: number } = {};
  parts.forEach(p => {
    if (p.type !== 'literal') {
      components[p.type] = parseInt(p.value, 10);
    }
  });
  return components;
}

/**
 * تحويل أي تاريخ إلى كائن تاريخ يعمل بالتوقيت المحلي لجمهورية مصر العربية (قاهرية)
 */
export function getEgyptTime(dateInput?: Date | number | string): Date {
  const baseDate = dateInput ? new Date(dateInput) : getRealNetworkTime();
  const comps = getEgyptDateTimeComponents(baseDate);
  
  // إنشاء كائن تاريخ يعكس قيم الوقت الخاصة بمصر محلياً
  const d = new Date(baseDate.getTime());
  d.setFullYear(comps.year, comps.month - 1, comps.day);
  d.setHours(comps.hour, comps.minute, comps.second, 0);
  return d;
}

