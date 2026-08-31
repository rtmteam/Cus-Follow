
export interface Branch {
  id: string;
  code?: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

export interface Job {
  id: string;
  title: string;
  workingDays?: number[];
  canVisitMultipleBranches?: boolean; // New: Allow this job to have visit plans
}

export interface VisitPlan {
  id: string;
  userId: string;
  userName: string;
  userSerial?: string; // New: Serial number for easier matching
  branchId: string;
  branchName: string;
  date: string; // ISO date string (YYYY-MM-DD)
}

export interface User {
  id: string;
  fullName: string;
  nationalId: string;
  serialNumber?: string; // الرقم التسلسلي الجديد (السنة + الترتيب)
  password?: string;
  employeeId?: string;
  role: 'employee' | 'admin';
  deviceId?: string; // Legacy support
  deviceIds?: string[]; // New: Array of linked device IDs
  allowedDeviceCount?: number; // New: Limit of devices per user
  jobTitle?: string;
  defaultBranchId?: string; 
  defaultBranch?: string;
  assignedBranch?: string;
  branch?: string;
  registrationDate?: string; 
  checkInTime?: string; 
  checkOutTime?: string; 
}

export interface ReportAccount {
  id: string;
  username: string;
  password?: string;
  allowedJobs: string[];
  allowedEmployees?: string[]; // New: Allow specific employees access
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  userJob?: string;
  serialNumber?: string; // الرقم التسلسلي للسجل
  branchId: string;
  branchName: string;
  type: 'check-in' | 'check-out';
  timestamp: string;
  latitude: number;
  longitude: number;
  reason?: string; 
  timeDiff?: string; 
}

export interface AppConfig {
  googleSheetLink: string;
  syncUrl: string;
  auditLogUrl?: string; // New: URL for the audit log sheet (optional if same as syncUrl)
  adminUsername: string;
  adminPassword?: string;
  lastUpdated?: string;
  holidays?: string[];
  /** النطاق الافتراضي حول العميل بالمتر — يُستعمل حين يترك عمود النطاق فارغاً */
  defaultCustomerRadius?: number;
}

/* ==========================================================================
   متابعة العملاء
   ========================================================================== */

/**
 * عميل تابع لتوكيل.
 *
 * يُقرأ من شيت Customers. الموظف يرى عملاء توكيله وحده — المطابقة
 * بكود التوكيل أو باسمه، بتسامح مع فروق المسافات وحالة الأحرف.
 */
export interface Customer {
  id: string;
  /** كود العميل — يبحث به الموظف */
  code: string;
  name: string;
  /** المندوب المسؤول عن حساب العميل — غير الموظف الزائر */
  repCode: string;
  repName: string;
  /** كود التوكيل الذي يتبعه العميل */
  agencyCode: string;
  agencyName: string;
  /** إجمالي المديونية كما في الشيت */
  totalDebt: number;
  /** المديونية المتجاوزة لفترة الائتمان */
  overdueDebt: number;
  latitude: number;
  longitude: number;
  /** النطاق المسموح بالمتر — فارغ يعني الافتراضي من الإعدادات */
  radius?: number;
}

/** سبب جاهز لتجاوز فترة الائتمان — يُقرأ من شيت VisitReasons */
export interface VisitReason {
  id: string;
  text: string;
}

/** إجابات الموظف التي تُطلب قبل إغلاق الزيارة */
export interface VisitAnswers {
  /** السبب المختار من القائمة، أو ما كُتب في خانة «أخرى» */
  overdueReason: string;
  /** المديونية الفعلية التي أقرّ بها العميل */
  actualDebt: number;
  /** عدد أيام تجاوز فترة الائتمان */
  overdueDays: number;
  /** موعد السداد المتفق عليه — YYYY-MM-DD */
  paymentDate: string;
  /** ملاحظة حرّة من الموظف — اختيارية */
  comment?: string;
}

/**
 * زيارة عميل.
 *
 * تُكتب على الخادم مرتين: صفّ ناقص عند الفتح، ويُكمَّل عند الإغلاق.
 * فالزيارة المفتوحة لها أثر على الشيت ولو انطفأ هاتف الموظف.
 */
export interface Visit {
  /** معرّف تولّده الشاشة ويُطابَق به الصفّ عند الإغلاق */
  id: string;
  userId: string;
  userName: string;
  userJob?: string;
  serialNumber?: string;

  customerId: string;
  customerCode: string;
  customerName: string;
  /** مندوب العميل وقت الزيارة — لقطة، فقد يتغيّر في الشيت بعدها */
  repCode: string;
  repName: string;
  agencyCode: string;
  agencyName: string;

  /** لقطة من مديونية العميل وقت الفتح — الشيت قد يتغيّر بعدها */
  totalDebtAtVisit: number;
  overdueDebtAtVisit: number;

  startTime: string;      // ISO
  startLatitude: number;
  startLongitude: number;

  endTime?: string;       // ISO
  endLatitude?: number;
  endLongitude?: number;

  answers?: VisitAnswers;

  /**
   * `cancelled` تعني أن الموظف تراجع عن الزيارة.
   * الصفّ يبقى على الشيت عمداً: تكرار الفتح والإلغاء عند عميل بعينه
   * مؤشّر لا يظهر إطلاقاً لو مُحي الصفّ.
   */
  status: 'open' | 'closed' | 'cancelled';
}
