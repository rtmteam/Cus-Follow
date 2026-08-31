
import React, { useState, useEffect, useRef } from 'react';
import { User, Customer, VisitReason, Visit } from '../types';
import { MapPin, Clock, CheckCircle, AlertCircle, Cloud, FileText, Search, Store, DoorOpen, DoorClosed, Wallet, AlertTriangle, CalendarClock, UserRound, MessageSquare, Ban, ChevronDown } from 'lucide-react';
import { calculateDistance, getDeviceFingerprint, getEgyptTime, getRealNetworkTime, checkDeveloperOptionsStatus, checkMockLocationStatus } from '../utils';

interface UserDashboardProps {
  user: User;
  customers: Customer[];
  visitReasons: VisitReason[];
  /** الزيارات المفتوحة كما يراها الخادم — مرجع أعلى من النسخة المحلية */
  openVisits: Visit[];
  /** النطاق الافتراضي حول العميل حين يُترك عمود النطاق فارغاً */
  customerRadius: number;
  googleSheetLink: string;
  onRefresh: () => void;
  isSyncing: boolean;
  lastUpdated?: string;
  logAction: (action: string, details?: string) => void;
}

/**
 * مهلة إرسال أوامر الزيارة.
 *
 * عشرون ثانية: أطول من أي شبكة بيانات معقولة حتى المتقطّعة، وأقصر من أن
 * يظن الموظف أن التطبيق تعطّل. عند تجاوزها يُلغى الطلب وتظهر رسالة تؤكد
 * له أن شيئاً لم يُسجَّل، فيعيد المحاولة بلا خوف من ازدواج التسجيل.
 */
const VISIT_TIMEOUT_MS = 20000;

/** مفتاح الزيارة المفتوحة محلياً — تنجو من إغلاق التطبيق وانطفاء الشاشة */
const ACTIVE_VISIT_KEY = 'uniteam_active_visit';
/** آخر الزيارات المغلقة من هذا الجهاز — للعرض فقط */
const RECENT_VISITS_KEY = 'uniteam_recent_visits';

/** قيمة «أخرى» في قائمة الأسباب — تفتح خانة كتابة حرّة */
const OTHER_REASON = '__other__';

const readLocal = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (e) {
    return fallback;
  }
};

const writeLocal = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // التخزين ممتلئ أو محظور — لا يُبطل العملية نفسها
  }
};

/** تنسيق المبالغ بأرقام لاتينية وفواصل آلاف */
const money = (v: number | undefined) =>
  (typeof v === 'number' && !isNaN(v) ? v : 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

const UserDashboard: React.FC<UserDashboardProps> = ({
  user,
  customers,
  visitReasons,
  openVisits,
  customerRadius,
  googleSheetLink,
  onRefresh,
  isSyncing,
  lastUpdated,
  logAction
}) => {
  /**
   * التوكيل الذي يتبعه الموظف.
   *
   * الحقل نفسه الذي كان يحمل الفرع الأساسي. المطابقة أدناه متسامحة عمداً:
   * تقبل كود التوكيل أو اسمه، وتتجاهل المسافات وحالة الأحرف — فبيانات
   * الشيت تُملأ بيد بشر ولا تأتي متطابقة حرفياً.
   */
  const myAgency = (
    user.defaultBranchId ||
    user.defaultBranch ||
    user.assignedBranch ||
    user.branch ||
    ''
  ).toString().trim();

  const belongsToMyAgency = (c: Customer): boolean => {
    if (!myAgency) return false;
    const target = myAgency.toLowerCase();
    return (
      c.agencyCode.trim().toLowerCase() === target ||
      c.agencyName.trim().toLowerCase() === target
    );
  };

  const myCustomers = customers.filter(belongsToMyAgency);

  // ---------- الموقع ----------
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number; accuracy: number; timestamp: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  /**
   * سبب تعذّر تتبّع الموقع في الخلفية.
   *
   * بلا هذه الحالة يبقى الموظف ينتظر رقم مسافة لن يأتي، ولا يعلم أن الإذن
   * مرفوض إلا إن ضغط زر الزيارة.
   */
  const [geoError, setGeoError] = useState<{ label: string; help: string } | null>(null);

  // ---------- الواجهة ----------
  const [search, setSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  /** القائمة مغلقة حتى يضغطها الموظف — الشاشة تبدأ نظيفة والزر أقرب لإبهامه */
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'none'; msg: string }>({ type: 'none', msg: '' });
  const [currentTime, setCurrentTime] = useState(getEgyptTime());

  // ---------- الزيارة ----------
  const [activeVisit, setActiveVisit] = useState<Visit | null>(() => readLocal<Visit | null>(ACTIVE_VISIT_KEY, null));
  const [recentVisits, setRecentVisits] = useState<Visit[]>(() => readLocal<Visit[]>(RECENT_VISITS_KEY, []));

  const [reasonChoice, setReasonChoice] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [actualDebt, setActualDebt] = useState('');
  const [overdueDays, setOverdueDays] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  /** ملاحظة حرّة — اختيارية، ولا تمنع الإغلاق إن تُركت فارغة */
  const [comment, setComment] = useState('');

  // ساعة التوقيت المصري
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(getEgyptTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  // تتبّع الموقع في الخلفية
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError({
        label: 'الموقع غير مدعوم',
        help: 'هذا المتصفح لا يدعم تحديد الموقع. استخدم تطبيق Uniteam من هاتفك.'
      });
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError(null);
        setLiveLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp
        });
      },
      (err) => {
        console.debug('Background GPS Error', err);
        if (err && err.code === 1) {
          setGeoError({
            label: 'إذن الموقع مرفوض',
            help: 'افتح إعدادات الهاتف ← التطبيقات ← Uniteam ← الأذونات ← الموقع، واختر "السماح أثناء استخدام التطبيق"، ثم أعد المحاولة.'
          });
        } else if (err && err.code === 2) {
          setGeoError({
            label: 'GPS متوقّف',
            help: 'فعّل خدمة الموقع (GPS) في الهاتف، وتأكد أنك لست في مكان مغلق تماماً.'
          });
        } else {
          setGeoError({
            label: 'تعذّر تحديد الموقع',
            help: 'اخرج لمكان مكشوف قليلاً وانتظر ثوانٍ حتى تظهر المسافة.'
          });
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  /**
   * الخادم هو المرجع في الزيارات المفتوحة.
   *
   * لو أُغلقت الزيارة من جهاز آخر، أو مُسحت من الشيت، فالنسخة المحلية
   * تصير كذباً يحبس الموظف في زيارة لا وجود لها. لا نمسحها إلا بعد مزامنة
   * ناجحة فعلاً (lastUpdated) حتى لا يتسبّب انقطاع الشبكة في مسحها.
   */
  useEffect(() => {
    const mine = openVisits.find(
      (v) => user.serialNumber && String(v.serialNumber).trim() === String(user.serialNumber).trim()
    );

    if (mine) {
      setActiveVisit((prev) => {
        const merged: Visit = { ...(prev || ({} as Visit)), ...mine, status: 'open' };
        writeLocal(ACTIVE_VISIT_KEY, merged);
        return merged;
      });
      return;
    }

    if (lastUpdated) {
      setActiveVisit((prev) => {
        if (!prev) return prev;
        localStorage.removeItem(ACTIVE_VISIT_KEY);
        return null;
      });
    }
  }, [openVisits, lastUpdated, user.serialNumber]);

  /** إغلاق القائمة عند الضغط خارجها — سلوك القوائم المنسدلة المتوقّع */
  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerOpen]);

  /**
   * نتائج البحث.
   *
   * يبحث في أربعة حقول: كود العميل · اسمه · كود المندوب · اسم المندوب.
   * ويُقصَر المعروض على عدد قليل بلا بحث — قائمة بمئات العملاء داخل حاوية
   * تمرير تُرهق الإبهام ولا تُوصل لأحد. الرقم يرتفع فور الكتابة.
   */
  const CUSTOMERS_BEFORE_SEARCH = 6;

  const matchedCustomers = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return myCustomers;
    return myCustomers.filter((c) =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.repCode || '').toLowerCase().includes(q) ||
      (c.repName || '').toLowerCase().includes(q)
    );
  })();

  const isSearching = search.trim() !== '';
  const visibleCustomers = isSearching
    ? matchedCustomers.slice(0, 30)
    : matchedCustomers.slice(0, CUSTOMERS_BEFORE_SEARCH);
  const hiddenCount = matchedCustomers.length - visibleCustomers.length;

  const selectedCustomer = myCustomers.find((c) => c.id === selectedCustomerId) || null;

  const radiusOf = (c: Customer) => (c.radius && c.radius > 0 ? c.radius : customerRadius || 100);

  const distanceTo = (c: Customer | null): number | null => {
    if (!c || !liveLocation) return null;
    return Math.round(calculateDistance(liveLocation.lat, liveLocation.lng, c.latitude, c.longitude));
  };

  /**
   * البوابات المشتركة قبل أي أمر زيارة.
   *
   * نفس ترتيب الفحص المعتمد في التطبيق: وضع المطور، ثم الاتصال، ثم الموقع،
   * ثم الموقع الوهمي، ثم النطاق. تُعاد كاملةً عند الفتح وعند الإغلاق.
   *
   * @returns إحداثيات صالحة، أو null بعد أن تكون قد عرضت سبب الرفض
   */
  const guardAndLocate = async (customer: Customer, label: string): Promise<{ lat: number; lng: number } | null> => {
    const devCheck = checkDeveloperOptionsStatus();
    if (devCheck.enabled) {
      const msg = 'تنبيه أمني محظور: وضع المطور (Developer Options) مفعّل على هاتفك. لا يُسمح بتسجيل الزيارات. يرجى تعطيل وضع المطور وإعادة المحاولة.';
      setStatus({ type: 'error', msg });
      logAction(`${label} مرفوض (وضع المطور)`, `السبب: ${msg} | المصدر: ${devCheck.source}`);
      return null;
    }

    if (!navigator.onLine) {
      const msg = 'عذراً، يجب أن يكون الهاتف متصلاً بالإنترنت لتسجيل الزيارة.';
      setStatus({ type: 'error', msg });
      logAction(`فشل ${label}`, `السبب: ${msg}`);
      return null;
    }

    let lat = 0;
    let lng = 0;
    let rawPos: GeolocationPosition | undefined;

    const fresh = liveLocation && Date.now() - liveLocation.timestamp < 60000;
    if (fresh && liveLocation) {
      lat = liveLocation.lat;
      lng = liveLocation.lng;
    } else {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          });
        });
        rawPos = position;
        lat = position.coords.latitude;
        lng = position.coords.longitude;
        setLiveLocation({ lat, lng, accuracy: position.coords.accuracy, timestamp: position.timestamp });
      } catch (error) {
        const geoErr = error as GeolocationPositionError;
        let msg = 'تعذر تحديد الموقع الحالي بدقة. تأكد من تفعيل GPS والمحاولة مرة أخرى.';
        if (geoErr && geoErr.code === 1) {
          msg = 'إذن الوصول للموقع مرفوض. افتح إعدادات الهاتف ← التطبيقات ← Uniteam ← الأذونات ← الموقع، واختر "السماح أثناء استخدام التطبيق"، ثم أعد المحاولة.';
        } else if (geoErr && geoErr.code === 2) {
          msg = 'تعذر الوصول لخدمة الموقع. تأكد من تفعيل GPS في الهاتف ومن أنك لست في مكان مغلق تماماً.';
        } else if (geoErr && geoErr.code === 3) {
          msg = 'انتهت مهلة تحديد الموقع. اخرج لمكان مكشوف قليلاً وأعد المحاولة.';
        }
        setStatus({ type: 'error', msg });
        logAction(`فشل ${label}`, `السبب: ${msg}`);
        return null;
      }
    }

    const mockCheck = checkMockLocationStatus(rawPos);
    if (mockCheck.isFake) {
      const msg = `تنبيه أمني محظور: تم الكشف عن استخدام برنامج موقع وهمي (Fake GPS / Mock Location). ${mockCheck.reason || ''}`;
      setStatus({ type: 'error', msg });
      logAction(`${label} مرفوض (موقع وهمي)`, `السبب: ${msg} | الإحداثيات: ${lat}, ${lng}`);
      return null;
    }

    const dist = calculateDistance(lat, lng, customer.latitude, customer.longitude);
    const allowed = radiusOf(customer);
    if (dist > allowed) {
      const msg = `أنت بعيد عن ${customer.name} بمسافة ${Math.round(dist)}م. الحد المسموح ${allowed}م — اقترب من مكان العميل وأعد المحاولة.`;
      setStatus({ type: 'error', msg });
      logAction(`فشل ${label}`, `السبب: ${msg} | الإحداثيات: ${lat}, ${lng}`);
      return null;
    }

    return { lat, lng };
  };

  /**
   * إرسال أمر زيارة وقراءة ردّ الخادم على أربعة مستويات.
   *
   * التحقق على أربعة مستويات: 404 ثم response.ok ثم
   * «هل الردّ HTML» ثم وجود نصّ النجاح بعينه. بلا هذا الترتيب يظهر النجاح
   * على شاشة الموظف بينما لم يُكتب شيء على الشيت.
   */
  const sendVisitCommand = async (payload: any, successText: string): Promise<{ ok: boolean; text: string }> => {
    if (!googleSheetLink) throw new Error('NO_LINK');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VISIT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(googleSheetLink, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 404) throw new Error('SERVER_404');
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const text = (await response.text()).trim();
    if (!text || text.startsWith('<')) throw new Error('INVALID_RESPONSE_FORMAT');

    // رفض منطقي من الخادم — رسالته عربية جاهزة للعرض كما هي
    if (text.includes('Error') || text.includes('Security Alert')) {
      return { ok: false, text };
    }
    if (!text.includes(successText)) throw new Error('OLD_OR_INVALID_CODE');

    return { ok: true, text };
  };

  /** ترجمة أخطاء الاتصال إلى رسائل تقول للموظف ما يفعل */
  const describeError = (err: any): string => {
    if (err?.message === 'NO_LINK') return 'التطبيق غير مربوط بالسحابة - يرجى تحديث الصفحة أو مراجعة الإدارة.';
    if (err?.message === 'SERVER_404') return 'رابط الشركة غير صحيح أو تم حذفه من السيرفر (404).';
    if (err?.message === 'INVALID_RESPONSE_FORMAT') return 'الرابط المسجل لا يؤدي إلى كود النظام. يرجى مراجعة المسؤول.';
    if (err?.message === 'OLD_OR_INVALID_CODE') return 'كود السيرفر قديم أو غير متوافق. لم تُسجَّل الزيارة.';
    if (err?.name === 'AbortError') return 'الشبكة بطيئة ولم يكتمل الإرسال خلال ٢٠ ثانية. لم يُسجَّل شيء — انتقل لمكان بتغطية أفضل وحاول مجدداً.';
    if (err?.message === 'Failed to fetch') return 'تعذر الوصول للسيرفر. تأكد من اتصال الإنترنت أو صحة الرابط.';
    return err?.message ? `خطأ: ${err.message}` : 'فشل الاتصال بالنظام. تأكد من الإنترنت.';
  };

  // ---------- فتح زيارة ----------
  const handleOpenVisit = async () => {
    if (!selectedCustomer) {
      setStatus({ type: 'error', msg: 'اختر العميل أولاً من القائمة.' });
      return;
    }

    setIsWorking(true);
    setStatus({ type: 'none', msg: '' });

    const customer = selectedCustomer;
    const coords = await guardAndLocate(customer, 'فتح زيارة');
    if (!coords) {
      setIsWorking(false);
      return;
    }

    const visitId = `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;

    try {
      const result = await sendVisitCommand(
        {
          action: 'startVisit',
          visitId,
          nationalId: user.nationalId,
          serialNumber: user.serialNumber,
          deviceId: getDeviceFingerprint(),
          customerCode: customer.code,
          latitude: coords.lat,
          longitude: coords.lng
        },
        'Visit Started'
      );

      if (!result.ok) {
        setStatus({ type: 'error', msg: result.text });
        logAction('فشل فتح زيارة', `العميل: ${customer.name} | ردّ الخادم: ${result.text}`);
        setIsWorking(false);
        return;
      }

      const visit: Visit = {
        id: visitId,
        userId: user.id,
        userName: user.fullName,
        userJob: user.jobTitle,
        serialNumber: user.serialNumber,
        customerId: customer.id,
        customerCode: customer.code,
        customerName: customer.name,
        repCode: customer.repCode,
        repName: customer.repName,
        agencyCode: customer.agencyCode,
        agencyName: customer.agencyName,
        totalDebtAtVisit: customer.totalDebt,
        overdueDebtAtVisit: customer.overdueDebt,
        startTime: getRealNetworkTime().toISOString(),
        startLatitude: coords.lat,
        startLongitude: coords.lng,
        status: 'open'
      };

      setActiveVisit(visit);
      writeLocal(ACTIVE_VISIT_KEY, visit);
      setStatus({ type: 'success', msg: `فُتحت الزيارة عند ${customer.name}. أجب على الأسئلة ثم أغلق الزيارة قبل مغادرة المكان.` });
      logAction('فتح زيارة', `العميل: ${customer.name} (${customer.code}), التوكيل: ${customer.agencyName}`);
      onRefresh();
    } catch (err: any) {
      console.error('Start Visit Error:', err);
      const msg = describeError(err);
      setStatus({ type: 'error', msg });
      logAction('فشل فتح زيارة', `العميل: ${customer.name} | السبب: ${msg}`);
    } finally {
      setIsWorking(false);
    }
  };

  // ---------- إغلاق زيارة ----------
  const resolvedReason = reasonChoice === OTHER_REASON ? otherReason.trim() : reasonChoice.trim();
  const answersReady =
    resolvedReason !== '' &&
    actualDebt.trim() !== '' && !isNaN(Number(actualDebt)) &&
    overdueDays.trim() !== '' && !isNaN(Number(overdueDays)) &&
    paymentDate.trim() !== '';

  const resetAnswers = () => {
    setReasonChoice('');
    setOtherReason('');
    setActualDebt('');
    setOverdueDays('');
    setPaymentDate('');
    setComment('');
  };

  /**
   * العميل المرجع لفحص الموقع أثناء الزيارة المفتوحة.
   *
   * قد يكون اختفى من الشيت بعد فتح الزيارة، فنسقط إلى لقطة الزيارة نفسها
   * بدل أن يُحبس الموظف في زيارة يتعذّر إغلاقها أو إلغاؤها.
   */
  const customerForActiveVisit = (): Customer | null => {
    if (!activeVisit) return null;
    return (
      myCustomers.find((c) => c.code === activeVisit.customerCode) ||
      ({
        id: activeVisit.customerId,
        code: activeVisit.customerCode,
        name: activeVisit.customerName,
        repCode: activeVisit.repCode,
        repName: activeVisit.repName,
        agencyCode: activeVisit.agencyCode,
        agencyName: activeVisit.agencyName,
        totalDebt: activeVisit.totalDebtAtVisit,
        overdueDebt: activeVisit.overdueDebtAtVisit,
        latitude: activeVisit.startLatitude,
        longitude: activeVisit.startLongitude
      } as Customer)
    );
  };

  /**
   * إلغاء الزيارة بالكامل.
   *
   * لا يشترط الإجابة على الأسئلة — فالإلغاء تراجع لا إتمام. لكنه **يشترط
   * الموقع**: بدونه يصير الإلغاء مهرباً من فحص النطاق، إذ يفتح الموظف
   * الزيارة عند العميل ثم يمشي ويلغيها من أي مكان.
   */
  const handleCancelVisit = async () => {
    if (!activeVisit) return;

    if (!confirm(
      `إلغاء الزيارة عند ${activeVisit.customerName}؟\n\n` +
      `لن تُحتسب زيارةً، وستُسجَّل كزيارة ملغاة في التقارير.`
    )) return;

    const customer = customerForActiveVisit();
    if (!customer) return;

    setIsWorking(true);
    setStatus({ type: 'none', msg: '' });

    const coords = await guardAndLocate(customer, 'إلغاء زيارة');
    if (!coords) {
      setIsWorking(false);
      return;
    }

    try {
      const result = await sendVisitCommand(
        {
          action: 'cancelVisit',
          visitId: activeVisit.id,
          nationalId: user.nationalId,
          serialNumber: user.serialNumber,
          deviceId: getDeviceFingerprint(),
          customerCode: activeVisit.customerCode,
          latitude: coords.lat,
          longitude: coords.lng,
          comment: comment.trim()
        },
        'Visit Cancelled'
      );

      if (!result.ok) {
        setStatus({ type: 'error', msg: result.text });
        logAction('فشل إلغاء زيارة', `العميل: ${activeVisit.customerName} | ردّ الخادم: ${result.text}`);
        setIsWorking(false);
        return;
      }

      const name = activeVisit.customerName;
      setActiveVisit(null);
      localStorage.removeItem(ACTIVE_VISIT_KEY);
      resetAnswers();
      setSelectedCustomerId('');
      setSearch('');

      setStatus({ type: 'success', msg: `أُلغيت الزيارة عند ${name}. يمكنك فتح زيارة جديدة الآن.` });
      logAction('إلغاء زيارة', `العميل: ${name} (${activeVisit.customerCode})`);
      onRefresh();
    } catch (err: any) {
      console.error('Cancel Visit Error:', err);
      const msg = describeError(err);
      setStatus({ type: 'error', msg });
      logAction('فشل إلغاء زيارة', `العميل: ${activeVisit.customerName} | السبب: ${msg}`);
    } finally {
      setIsWorking(false);
    }
  };

  const handleCloseVisit = async () => {
    if (!activeVisit) return;

    if (!answersReady) {
      setStatus({ type: 'error', msg: 'أكمل الإجابة على الأسئلة الأربعة قبل إغلاق الزيارة.' });
      return;
    }

    const customer = customerForActiveVisit();
    if (!customer) return;

    setIsWorking(true);
    setStatus({ type: 'none', msg: '' });

    const coords = await guardAndLocate(customer, 'إغلاق زيارة');
    if (!coords) {
      setIsWorking(false);
      return;
    }

    try {
      const result = await sendVisitCommand(
        {
          action: 'closeVisit',
          visitId: activeVisit.id,
          nationalId: user.nationalId,
          serialNumber: user.serialNumber,
          deviceId: getDeviceFingerprint(),
          customerCode: activeVisit.customerCode,
          latitude: coords.lat,
          longitude: coords.lng,
          overdueReason: resolvedReason,
          actualDebt: Number(actualDebt),
          overdueDays: Number(overdueDays),
          paymentDate: paymentDate,
          comment: comment.trim()
        },
        'Visit Closed'
      );

      if (!result.ok) {
        setStatus({ type: 'error', msg: result.text });
        logAction('فشل إغلاق زيارة', `العميل: ${activeVisit.customerName} | ردّ الخادم: ${result.text}`);
        setIsWorking(false);
        return;
      }

      const closed: Visit = {
        ...activeVisit,
        endTime: getRealNetworkTime().toISOString(),
        endLatitude: coords.lat,
        endLongitude: coords.lng,
        answers: {
          overdueReason: resolvedReason,
          actualDebt: Number(actualDebt),
          overdueDays: Number(overdueDays),
          paymentDate,
          comment: comment.trim() || undefined
        },
        status: 'closed'
      };

      const nextRecent = [closed, ...recentVisits].slice(0, 5);
      setRecentVisits(nextRecent);
      writeLocal(RECENT_VISITS_KEY, nextRecent);

      setActiveVisit(null);
      localStorage.removeItem(ACTIVE_VISIT_KEY);
      resetAnswers();
      setSelectedCustomerId('');
      setSearch('');

      setStatus({ type: 'success', msg: `أُغلقت الزيارة عند ${closed.customerName} وسُجّلت إجاباتك بنجاح.` });
      logAction('إغلاق زيارة', `العميل: ${closed.customerName} (${closed.customerCode}), السبب: ${resolvedReason}, موعد السداد: ${paymentDate}`);
      onRefresh();
    } catch (err: any) {
      console.error('Close Visit Error:', err);
      const msg = describeError(err);
      setStatus({ type: 'error', msg });
      logAction('فشل إغلاق زيارة', `العميل: ${activeVisit.customerName} | السبب: ${msg}`);
    } finally {
      setIsWorking(false);
    }
  };

  // ======================================================
  //  العرض
  // ======================================================

  const selectedDistance = distanceTo(selectedCustomer);
  const selectedInRange =
    selectedCustomer !== null && selectedDistance !== null && selectedDistance <= radiusOf(selectedCustomer);

  const activeCustomer = activeVisit ? myCustomers.find((c) => c.code === activeVisit.customerCode) || null : null;
  const activeDistance = activeVisit
    ? distanceTo(
        activeCustomer ||
          ({ latitude: activeVisit.startLatitude, longitude: activeVisit.startLongitude } as Customer)
      )
    : null;

  const statusBox = status.type !== 'none' && (
    <div
      className={`p-4 rounded-2xl text-sm font-bold border flex items-center gap-3 ${
        status.type === 'success'
          ? 'bg-green-900/20 text-green-400 border-green-800/50'
          : 'bg-red-900/20 text-red-400 border-red-800/50'
      }`}
    >
      {status.type === 'error' ? <AlertCircle size={20} className="shrink-0" /> : <CheckCircle size={20} className="shrink-0" />}
      <span className="leading-relaxed">{status.msg}</span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-slate-800 rounded-3xl shadow-xl border border-slate-700 p-5 md:p-8 text-white relative overflow-hidden">
          {lastUpdated && (
            <div className="absolute left-4 top-6 flex flex-col items-end gap-2">
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                <Cloud size={11} /> <span style={{ direction: 'ltr' }}>{new Date(lastUpdated).toLocaleTimeString('en-US')}</span>
              </div>
            </div>
          )}

          {/* ===== الترويسة ===== */}
          <div className="text-center mb-8 pt-4">
            <h2 className="text-2xl md:text-3xl font-black text-white mb-2">أهلاً، {user.fullName.split(' ')[0]}</h2>
            <div className="bg-blue-900/30 px-5 py-1.5 rounded-xl text-blue-400 border border-blue-800/40 font-black text-xs inline-block">
              {user.jobTitle || 'موظف'} · توكيل {myAgency || 'غير محدد'}
            </div>
            <div className="text-4xl md:text-5xl font-black text-white mt-8 mb-2 drop-shadow-2xl" style={{ direction: 'ltr' }}>
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="text-slate-500 font-bold text-xs" style={{ direction: 'ltr' }}>
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>

          <div className="space-y-6 max-w-md mx-auto">
            {!googleSheetLink && (
              <div className="p-4 bg-red-900/40 border border-red-500/50 rounded-2xl flex items-center gap-3 text-red-200 text-sm font-bold leading-relaxed">
                <Cloud size={16} /> التطبيق غير مربوط بالسحابة - لن يتم الإرسال
              </div>
            )}

            {/* ================= زيارة مفتوحة ================= */}
            {activeVisit ? (
              <>
                <div className="rounded-2xl border border-amber-500/40 bg-amber-950/25 overflow-hidden">
                  <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-amber-300 font-black text-sm">
                      <DoorOpen size={17} /> زيارة مفتوحة
                    </div>
                    {activeDistance !== null && (
                      <span
                        className={`ut-chip ${
                          activeCustomer && activeDistance <= radiusOf(activeCustomer) ? 'ut-chip--ok' : 'ut-chip--warn'
                        }`}
                      >
                        <span className="ut-pulse" />
                        <span style={{ direction: 'ltr', fontWeight: 800 }}>{activeDistance}</span> م
                      </span>
                    )}
                  </div>

                  <div className="p-4 space-y-3">
                    <div>
                      <div className="text-lg font-black text-white leading-tight">{activeVisit.customerName}</div>
                      <div className="text-xs text-slate-400 font-bold mt-1">
                        كود <span style={{ direction: 'ltr' }}>{activeVisit.customerCode}</span> · بدأت{' '}
                        <span style={{ direction: 'ltr' }}>
                          {new Date(activeVisit.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>

                    {(activeVisit.repName || activeVisit.repCode) && (
                      <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 mb-1">
                          <UserRound size={12} /> مندوب العميل
                        </div>
                        <div className="text-sm font-black text-white">
                          {activeVisit.repName || '—'}
                          {activeVisit.repCode && (
                            <span className="text-slate-500 font-bold text-xs"> · <span style={{ direction: 'ltr' }}>{activeVisit.repCode}</span></span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 mb-1">
                          <Wallet size={12} /> إجمالي المديونية
                        </div>
                        <div className="text-base font-black text-white" style={{ direction: 'ltr' }}>
                          {money(activeVisit.totalDebtAtVisit)}
                        </div>
                      </div>
                      <div className="bg-slate-900 rounded-xl p-3 border border-red-900/40">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-300 mb-1">
                          <AlertTriangle size={12} /> الأوفر ديو
                        </div>
                        <div className="text-base font-black text-red-400" style={{ direction: 'ltr' }}>
                          {money(activeVisit.overdueDebtAtVisit)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ===== الأسئلة ===== */}
                <div className="space-y-4">
                  <div className="text-sm font-black text-white flex items-center gap-2">
                    <FileText size={16} className="text-blue-400" /> أجب على الأسئلة قبل الإغلاق
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400">أسباب تجاوز فترة الائتمان</label>
                    <select
                      value={reasonChoice}
                      onChange={(e) => setReasonChoice(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3.5 rounded-2xl font-bold outline-none cursor-pointer appearance-none focus:border-blue-500 transition-all text-right"
                    >
                      <option value="">-- اختر السبب --</option>
                      {visitReasons.map((r) => (
                        <option key={r.id} value={r.text}>{r.text}</option>
                      ))}
                      <option value={OTHER_REASON}>أخرى (اكتب السبب)</option>
                    </select>
                    {reasonChoice === OTHER_REASON && (
                      <textarea
                        value={otherReason}
                        onChange={(e) => setOtherReason(e.target.value)}
                        placeholder="اكتب السبب هنا..."
                        className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all text-right h-20 resize-none text-sm leading-relaxed placeholder:text-slate-500"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400">قيمة المديونية الفعلية لدى العميل</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={actualDebt}
                      onChange={(e) => setActualDebt(e.target.value)}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3.5 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all"
                      style={{ direction: 'ltr' }}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400">عدد أيام تجاوز فترة الائتمان</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={overdueDays}
                      onChange={(e) => setOverdueDays(e.target.value)}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3.5 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all"
                      style={{ direction: 'ltr' }}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                      <CalendarClock size={13} /> موعد السداد
                    </label>
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3.5 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all"
                      style={{ direction: 'ltr' }}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                      <MessageSquare size={13} /> ملاحظات إضافية <span className="text-slate-500 font-medium">(اختياري)</span>
                    </label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="أي ملاحظة عن الزيارة أو العميل…"
                      className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all text-right h-24 resize-none text-sm leading-relaxed placeholder:text-slate-500"
                    />
                  </div>
                </div>

                {statusBox}

                {!answersReady && (
                  <div className="text-xs font-bold text-amber-300/90 bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 leading-relaxed">
                    زر الإغلاق يعمل بعد الإجابة على الأسئلة الأربعة، ويشترط أن تكون في مكان العميل.
                  </div>
                )}

                {/* الإغلاق يأخذ عرضين والإلغاء عرضاً واحداً: الفجوة البصرية
                    بينهما مقصودة — الإلغاء إجراء مدمّر لا يُضغط بالخطأ. */}
                <div className="grid grid-cols-3 gap-3">
                  <button
                    disabled={isWorking || !answersReady}
                    onClick={handleCloseVisit}
                    className="col-span-2 py-6 rounded-2xl font-black text-lg text-white flex flex-col items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50"
                    style={{ backgroundImage: 'var(--grad-warn)', boxShadow: '0 8px 26px rgba(245,158,11,.35)' }}
                  >
                    <span className="flex items-center gap-2">
                      <DoorClosed size={22} /> إغلاق الزيارة
                    </span>
                    {isWorking && <span className="text-xs font-medium animate-pulse">جارٍ التحقق…</span>}
                  </button>

                  <button
                    disabled={isWorking}
                    onClick={handleCancelVisit}
                    className="py-6 rounded-2xl font-black text-sm text-red-300 flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 border border-red-800/60 bg-red-950/40"
                  >
                    <Ban size={20} />
                    <span>إلغاء الزيارة</span>
                  </button>
                </div>

                <div className="text-[11px] font-bold text-slate-500 text-center leading-relaxed">
                  الإلغاء لا يحتاج إجابة على الأسئلة، لكنه يشترط وجودك في مكان العميل مثل الإغلاق.
                </div>
              </>
            ) : (
              /* ================= اختيار عميل ================= */
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="text-xs font-bold text-slate-400">العميل المراد زيارته</label>

                    {geoError ? (
                      <button
                        type="button"
                        onClick={() => setStatus({ type: 'error', msg: geoError.help })}
                        className="ut-chip ut-chip--bad"
                        style={{ cursor: 'pointer', minHeight: 24 }}
                        title={geoError.help}
                      >
                        <AlertCircle size={11} /> {geoError.label} — اضغط للتفاصيل
                      </button>
                    ) : selectedCustomer && selectedDistance !== null ? (
                      <span
                        className={`ut-chip ${selectedInRange ? 'ut-chip--ok' : 'ut-chip--warn'}`}
                        title={
                          selectedInRange
                            ? `داخل نطاق ${selectedCustomer.name}`
                            : `خارج نطاق ${selectedCustomer.name} — الحد المسموح ${radiusOf(selectedCustomer)} م`
                        }
                      >
                        <span className="ut-pulse" />
                        <span style={{ direction: 'ltr', fontWeight: 800 }}>{selectedDistance}</span> م
                      </span>
                    ) : selectedCustomer ? (
                      <span className="ut-chip">
                        <MapPin size={11} /> تحديد الموقع…
                      </span>
                    ) : null}
                  </div>

                  {/* ===== قائمة منسدلة: مغلقة حتى يضغطها الموظف ===== */}
                  <div className="relative" ref={pickerRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setPickerOpen((o) => !o);
                        setStatus({ type: 'none', msg: '' });
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-4 rounded-2xl border text-right transition-all min-h-[60px] ${
                        pickerOpen ? 'bg-slate-900 border-blue-500' : 'bg-slate-900 border-slate-700'
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <Store size={18} className="text-slate-500 shrink-0" />
                        {selectedCustomer ? (
                          <span className="min-w-0">
                            <span className="block text-sm font-black text-white truncate">{selectedCustomer.name}</span>
                            <span className="block text-xs text-slate-400 font-bold mt-0.5">
                              كود <span style={{ direction: 'ltr' }}>{selectedCustomer.code}</span>
                              {selectedCustomer.repName && <span> · مندوب: {selectedCustomer.repName}</span>}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm font-bold text-slate-500">اضغط لاختيار العميل</span>
                        )}
                      </span>
                      <ChevronDown
                        size={20}
                        className={`text-slate-500 shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {pickerOpen && (
                      <div className="absolute z-40 mt-2 w-full bg-slate-900 border border-slate-600 rounded-2xl shadow-2xl overflow-hidden">
                        <div className="relative p-2.5 border-b border-slate-700">
                          <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            autoFocus
                            placeholder="اكتب كود العميل أو اسمه أو المندوب…"
                            className="w-full bg-slate-950 border border-slate-700 text-white pr-10 pl-3 py-3 rounded-xl font-bold outline-none focus:border-blue-500 transition-all text-right text-sm placeholder:text-slate-500"
                          />
                          <Search size={16} className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                        </div>

                        <div className="max-h-64 overflow-y-auto p-2 space-y-1.5">
                          {myCustomers.length === 0 ? (
                            <div className="text-center py-8 px-4">
                              <Store size={32} className="mx-auto opacity-20 mb-3" />
                              <div className="text-sm font-bold text-slate-300">لا يوجد عملاء مرتبطون بتوكيلك</div>
                              <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                                توكيلك المسجَّل: «{myAgency || 'غير محدد'}». راجع المسؤول.
                              </div>
                            </div>
                          ) : matchedCustomers.length === 0 ? (
                            <div className="text-center py-8 px-4">
                              <Search size={28} className="mx-auto opacity-20 mb-3" />
                              <div className="text-sm font-bold text-slate-300">لا نتائج لبحثك</div>
                              <div className="text-xs text-slate-500 mt-1">جرّب كود العميل، أو جزءاً من اسمه.</div>
                            </div>
                          ) : (
                            <>
                              {visibleCustomers.map((c) => {
                                const d = distanceTo(c);
                                const inRange = d !== null && d <= radiusOf(c);
                                const isSelected = c.id === selectedCustomerId;
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedCustomerId(c.id);
                                      setPickerOpen(false);
                                      setSearch('');
                                      setStatus({ type: 'none', msg: '' });
                                    }}
                                    className={`w-full text-right p-3 rounded-xl border transition-all min-h-[56px] ${
                                      isSelected ? 'bg-blue-600/15 border-blue-500' : 'bg-slate-950 border-slate-800'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-black text-white truncate">{c.name}</div>
                                        <div className="text-xs text-slate-400 font-bold mt-0.5 truncate">
                                          كود <span style={{ direction: 'ltr' }}>{c.code}</span>
                                          {c.repName && <span> · مندوب: {c.repName}</span>}
                                          {c.overdueDebt > 0 && (
                                            <span className="text-red-400"> · أوفر ديو <span style={{ direction: 'ltr' }}>{money(c.overdueDebt)}</span></span>
                                          )}
                                        </div>
                                      </div>
                                      {d !== null && (
                                        <span className={`ut-chip ${inRange ? 'ut-chip--ok' : 'ut-chip--warn'} shrink-0`}>
                                          <span style={{ direction: 'ltr', fontWeight: 800 }}>{d}</span> م
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}

                              {hiddenCount > 0 && (
                                <div className="text-center text-xs font-bold text-slate-500 py-2.5 leading-relaxed">
                                  {isSearching
                                    ? `و${hiddenCount} نتيجة أخرى — ضيّق بحثك.`
                                    : `و${hiddenCount} عميلاً آخر — اكتب في خانة البحث للوصول إليهم.`}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* بطاقة العميل المختار */}
                {selectedCustomer && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 mb-1">
                        <Wallet size={12} /> إجمالي المديونية
                      </div>
                      <div className="text-base font-black text-white" style={{ direction: 'ltr' }}>
                        {money(selectedCustomer.totalDebt)}
                      </div>
                    </div>
                    <div className="bg-slate-900 rounded-xl p-3 border border-red-900/40">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-300 mb-1">
                        <AlertTriangle size={12} /> الأوفر ديو
                      </div>
                      <div className="text-base font-black text-red-400" style={{ direction: 'ltr' }}>
                        {money(selectedCustomer.overdueDebt)}
                      </div>
                    </div>
                  </div>
                )}

                {statusBox}

                {selectedCustomer && selectedDistance !== null && !selectedInRange && (
                  <div className="text-xs font-bold text-amber-300/90 bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 leading-relaxed">
                    أنت على بعد {selectedDistance}م من {selectedCustomer.name}، والحد المسموح {radiusOf(selectedCustomer)}م.
                    اقترب من مكان العميل ليعمل زر فتح الزيارة.
                  </div>
                )}

                <button
                  disabled={isWorking || !selectedCustomer || !selectedInRange}
                  onClick={handleOpenVisit}
                  className="w-full py-6 rounded-2xl font-black text-lg text-white flex flex-col items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50"
                  style={{ backgroundImage: 'var(--grad-ok)', boxShadow: '0 8px 26px rgba(16,185,129,.38)' }}
                >
                  <span className="flex items-center gap-2">
                    <DoorOpen size={22} /> فتح زيارة
                  </span>
                  {isWorking && <span className="text-xs font-medium animate-pulse">جارٍ التحقق مع السيرفر…</span>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ================= آخر الزيارات ================= */}
      <div className="bg-slate-800 rounded-3xl p-5 md:p-6 border border-slate-700 shadow-xl text-white">
        <h3 className="font-black mb-6 border-b border-slate-700 pb-4 flex items-center gap-2 text-blue-400 text-sm">
          آخر الزيارات
        </h3>
        <div className="space-y-4">
          {recentVisits.length === 0 ? (
            <div className="text-center py-10">
              <Clock size={40} className="mx-auto opacity-20 mb-3" />
              <div className="text-sm font-bold text-slate-300">لا توجد زيارات بعد</div>
              <div className="text-xs text-slate-500 mt-1 leading-relaxed">ستظهر هنا الزيارات التي تُغلقها من هذا الجهاز</div>
            </div>
          ) : (
            recentVisits.map((v) => (
              <div key={v.id} className="p-4 bg-slate-900 rounded-2xl border border-slate-700/50 text-right">
                <div className="flex justify-between items-start gap-2 font-black text-sm mb-1.5">
                  <span className="text-slate-300 min-w-0 truncate">{v.customerName}</span>
                  <span className="text-green-400 shrink-0 text-xs">مغلقة</span>
                </div>
                <div className="text-xs text-slate-500 font-bold mb-1" style={{ direction: 'ltr', textAlign: 'right' }}>
                  {new Date(v.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  {v.endTime && ` → ${new Date(v.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
                </div>
                {v.answers && (
                  <div className="text-xs text-slate-400 font-bold bg-slate-800 p-2.5 rounded-lg border border-slate-700 leading-relaxed space-y-1">
                    <div>السبب: {v.answers.overdueReason}</div>
                    <div>
                      المديونية الفعلية: <span style={{ direction: 'ltr' }}>{money(v.answers.actualDebt)}</span> ·
                      التجاوز: <span style={{ direction: 'ltr' }}>{v.answers.overdueDays}</span> يوم
                    </div>
                    <div>موعد السداد: <span style={{ direction: 'ltr' }}>{v.answers.paymentDate}</span></div>
                    {v.answers.comment && <div className="pt-1 border-t border-slate-700">ملاحظة: {v.answers.comment}</div>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default UserDashboard;
