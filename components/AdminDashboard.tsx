
import React, { useState, useRef } from 'react';
import { Branch, AttendanceRecord, AppConfig, User, Job, ReportAccount, VisitPlan, Customer } from '../types';
import { MapPin, Table, Trash2, Shield, CloudUpload, Briefcase, RotateCcw, Globe, Users, Plus, FileSpreadsheet, Download, Share2, Smartphone, RefreshCw, Edit2, Check, X, Unlink, Key, Lock, Eye, EyeOff, Clock, Monitor, UserCheck, Calendar, Navigation, ArrowUp, ArrowDown, GripVertical, KeyRound, Loader2, Store, Search, Wallet, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import ReportsView from './ReportsView';

interface AdminDashboardProps {
  branches: Branch[];
  setBranches: React.Dispatch<React.SetStateAction<Branch[]>>;
  jobs: Job[];
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  records: AttendanceRecord[];
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  allUsers: User[];
  setAllUsers: React.Dispatch<React.SetStateAction<User[]>>;
  reportAccounts?: ReportAccount[];
  setReportAccounts?: React.Dispatch<React.SetStateAction<ReportAccount[]>>;
  visitPlans: VisitPlan[];
  setVisitPlans: React.Dispatch<React.SetStateAction<VisitPlan[]>>;
  customers: Customer[];
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  onRefresh: () => void;
  isSyncing: boolean;
  logAction: (action: string, details?: string) => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  branches, setBranches, jobs, setJobs, records, config, setConfig, allUsers, setAllUsers, 
  reportAccounts = [], setReportAccounts, visitPlans, setVisitPlans, customers, setCustomers,
  onRefresh, isSyncing, logAction
}) => {
  const [activeTab, setActiveTab] = useState<'branches' | 'jobs' | 'users' | 'customers' | 'report-access' | 'reports' | 'settings'>('branches');
  const [newBranch, setNewBranch] = useState<Partial<Branch>>({ code: '', name: '', latitude: 0, longitude: 0, radius: 100 });
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newHoliday, setNewHoliday] = useState('');
  const [isPushing, setIsPushing] = useState(false);
  
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserData, setEditUserData] = useState<Partial<User>>({});
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);

  /**
   * إعادة تعيين كلمة مرور موظف.
   *
   * يستدعي إجراء resetUserPassword الضيّق في الخادم، لا updateSystem —
   * فلا يُمسح شيت الموظفين ولا يُحذف من سجّل بعد آخر مزامنة.
   * وبلا no-cors ليُقرأ ردّ الخادم فعلاً ويُعرض سبب الفشل إن وقع.
   */
  const resetUserPassword = async (user: User) => {
    if (!config.syncUrl) { alert('يرجى ضبط رابط المزامنة أولاً'); return; }

    const newPass = prompt(
      `إعادة تعيين كلمة مرور: ${user.fullName}\n\n` +
      `اكتب كلمة المرور الجديدة (٦ خانات فأكثر، ولا تبدأ بصفر):`
    );
    if (newPass === null) return;

    const pass = newPass.trim();
    if (pass.length < 6) { alert('كلمة المرور يجب ألا تقل عن ٦ خانات.'); return; }
    if (pass.startsWith('0')) { alert('كلمة المرور لا يمكن أن تبدأ بصفر.'); return; }

    setResettingUserId(user.id);
    try {
      const response = await fetch(config.syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'resetUserPassword',
          adminUsername: config.adminUsername,
          adminPassword: config.adminPassword,
          userId: user.id,
          nationalId: user.nationalId,
          newPassword: pass
        })
      });

      const text = (await response.text()).trim();

      if (text.includes('Password Reset Successfully')) {
        alert(`تم تغيير كلمة مرور ${user.fullName} بنجاح.\n\nسلّمها له ليدخل بها.`);
        logAction('إعادة تعيين كلمة مرور موظف', `الموظف: ${user.fullName}`);
        onRefresh?.();
      } else {
        alert('تعذّر تغيير كلمة المرور:\n\n' + text.replace(/^Error:\s*/, ''));
        logAction('فشل إعادة تعيين كلمة مرور', `الموظف: ${user.fullName} | ${text}`);
      }
    } catch (err) {
      alert('تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول مجدداً.');
      logAction('فشل إعادة تعيين كلمة مرور', `الموظف: ${user.fullName} | خطأ اتصال`);
    } finally {
      setResettingUserId(null);
    }
  };

  const [newRepUser, setNewRepUser] = useState('');
  const [newRepPass, setNewRepPass] = useState('');
  const [selectedJobsForAcc, setSelectedJobsForAcc] = useState<string[]>([]);
  const [selectedUsersForAcc, setSelectedUsersForAcc] = useState<string[]>([]); // New state for selected employees
  

  const [showPass, setShowPass] = useState<string | null>(null);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [editReportData, setEditReportData] = useState<Partial<ReportAccount>>({});
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [editBranchData, setEditBranchData] = useState<Partial<Branch>>({});
  const [syncUrl, setSyncUrl] = useState(config.syncUrl || '');
  
  // State for Branch Bulk Delete
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
  const [draggedBranchIndex, setDraggedBranchIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobFileInputRef = useRef<HTMLInputElement>(null);
  const userFileInputRef = useRef<HTMLInputElement>(null);
  const customerFileInputRef = useRef<HTMLInputElement>(null);

  // ---------- العملاء ----------
  const emptyCustomer: Partial<Customer> = {
    code: '', name: '', repCode: '', repName: '', agencyCode: '', agencyName: '',
    totalDebt: 0, overdueDebt: 0, latitude: 0, longitude: 0
  };
  const [newCustomer, setNewCustomer] = useState<Partial<Customer>>(emptyCustomer);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [editCustomerData, setEditCustomerData] = useState<Partial<Customer>>({});
  const [customerSearch, setCustomerSearch] = useState('');

  const ADMIN_TABS = [
    { id: 'branches', label: 'الفروع', icon: MapPin },
    { id: 'jobs', label: 'الوظائف', icon: Briefcase },
    { id: 'users', label: 'الموظفون', icon: Users },
    { id: 'customers', label: 'العملاء', icon: Store },
    { id: 'report-access', label: 'صلاحيات التقارير', icon: Key },
    { id: 'reports', label: 'استعراض التقارير', icon: FileSpreadsheet },
    { id: 'settings', label: 'الإعدادات', icon: Monitor }
  ] as const;

  // وظيفة لتنسيق الوقت للعرض (AM/PM)

  const normalizeToTimeInput = (timeStr: string | undefined): string => {
    if (!timeStr) return "09:00";
    if (timeStr.includes('GMT') || timeStr.includes('1899')) {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) {
        return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      }
    }
    const match = timeStr.match(/(\d{2}:\d{2})/);
    return match ? match[1] : timeStr;
  };

  const pushToCloud = async (dataType?: string) => {
    if (!config.syncUrl) return alert("يرجى ضبط رابط المزامنة أولاً");
    setIsPushing(true);
    try {
      const payload: any = {
        action: 'updateSystem',
        adminUsername: config.adminUsername,
        adminPassword: config.adminPassword,
      };

      // تحديث انتقائي بناءً على نوع البيانات
      // Selective update based on dataType
      if (!dataType || dataType === 'branches' || dataType === 'jobs' || dataType === 'holidays') {
        payload.branches = branches;
        payload.jobs = jobs;
        payload.holidays = config.holidays || [];
      }
      
      if (!dataType || dataType === 'users') {
        payload.users = allUsers;
      }
      
      if (!dataType || dataType === 'reportAccounts') {
        payload.reportAccounts = reportAccounts;
      }
      
      if (!dataType || dataType === 'visitPlans') {
        payload.visitPlans = visitPlans;
      }

      if (!dataType || dataType === 'customers') {
        payload.customers = customers;
      }

      if (config.defaultCustomerRadius) {
        payload.customerRadius = config.defaultCustomerRadius;
      }

      // بلا no-cors عمداً.
      // كان يعمي الاستجابة فتظهر رسالة النجاح مهما ردّ الخادم — وبعد إضافة
      // المصادقة على updateSystem صار الرفض ممكناً، فكان المسؤول يرى «تم
      // بنجاح» ولم يُحفظ شيء. text/plain طلب بسيط لا يستدعي preflight،
      // وهو نفس ما يفعله مسار تسجيل الحضور الذي يقرأ الردّ بنجاح.
      const response = await fetch(config.syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = (await response.text()).trim();

      if (text.trim().startsWith('<')) {
        throw new Error('INVALID_RESPONSE');
      }

      if (text.startsWith('Error:')) {
        const reason = text.replace(/^Error:\s*/, '');
        logAction('فشل الحفظ في السحابة', `رفض الخادم: ${text}`);
        alert('لم يُحفظ شيء.\n\n' + reason);
        return;
      }

      logAction('حفظ في السحابة', `تحديث بيانات ${dataType || 'النظام'} في جوجل شيت`);
      alert('تم حفظ البيانات في السحابة بنجاح.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logAction('فشل الحفظ في السحابة', `الخطأ: ${msg}`);
      alert(
        msg === 'INVALID_RESPONSE'
          ? 'الرابط المسجل لا يؤدي إلى كود النظام. راجع رابط المزامنة.'
          : 'تعذّر الاتصال بالسحابة. تأكد من الإنترنت وحاول مجدداً.\n\nلم يُحفظ شيء.'
      );
    }
    finally { setIsPushing(false); }
  };

  const saveEditUser = (id: string) => {
    const user = allUsers.find(u => u.id === id);
    setAllUsers(prev => prev.map(u => u.id === id ? { ...u, ...editUserData } as User : u));
    logAction('تعديل بيانات موظف', `الموظف: ${user?.fullName}`);
    setEditingUserId(null);
  };

  const inputClasses = "px-4 py-3 rounded-xl border border-slate-600 bg-slate-900 text-white font-bold outline-none focus:border-blue-500 w-full transition-all";

  const downloadTemplate = (type: 'branches' | 'jobs' | 'users' | 'customers') => {
    let data: any[] = [];
    let fileName = "";

    if (type === 'customers') {
      // صفّان: الأول مملوء بالكامل، والثاني يبيّن أن النطاق اختياري
      data = [
        {
          "كود العميل": "C1001",
          "اسم العميل": "سوبر ماركت النور",
          "كود المندوب": "R-05",
          "اسم المندوب": "أحمد سعيد",
          "كود التوكيل": "AG-01",
          "اسم التوكيل": "توكيل سموحة",
          "إجمالي المديونية": 154300,
          "المديونية الأوفر ديو": 42000,
          "خط العرض": 31.200100,
          "خط الطول": 29.918700,
          "النطاق": 80
        },
        {
          "كود العميل": "C1002",
          "اسم العميل": "بقالة الأمانة",
          "كود المندوب": "R-05",
          "اسم المندوب": "أحمد سعيد",
          "كود التوكيل": "AG-01",
          "اسم التوكيل": "توكيل سموحة",
          "إجمالي المديونية": 9800,
          "المديونية الأوفر ديو": 0,
          "خط العرض": 31.250000,
          "خط الطول": 29.960000,
          "النطاق": ""
        }
      ];
      const wsC = XLSX.utils.json_to_sheet(data);
      const wbC = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wbC, wsC, "Customers");
      XLSX.writeFile(wbC, "template_customers.xlsx");
      return;
    }

    if (type === 'branches') {
      data = [{ "كود الفرع": "101", "اسم الفرع": "الفرع الرئيسي", "خط العرض": 30.05, "خط الطول": 31.23, "النطاق بالمتر": 100 }];
      fileName = "template_branches.xlsx";
    } else if (type === 'jobs') {
      data = [{ "اسم الوظيفة": "مهندس", "زيارة فروع متعددة": "نعم" }];
      fileName = "template_jobs.xlsx";
    } else if (type === 'users') {
      data = [{
        "الاسم بالكامل": "محمد احمد",
        "الرقم القومي": "29010101234567",
        "كلمة المرور": "123456",
        "الوظيفة": "مندوب تحصيل",
        "الفرع الافتراضي": "AG-01",
        "عدد الاجهزة": 1
      }];
      fileName = "template_users.xlsx";
    }
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, fileName);
  };

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>, type: 'branches' | 'jobs' | 'users' | 'customers') => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result; const wb = XLSX.read(bstr, { type: 'binary' }); const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

        if (type === 'customers') {
          // قراءة متسامحة: عناوين عربية أو إنجليزية، وفروق المسافات مُتجاهَلة
          const pick = (item: any, keys: string[]) => {
            for (const k of keys) {
              const found = Object.keys(item).find(x => x.toString().trim() === k);
              if (found !== undefined && item[found] !== undefined && item[found] !== '') return item[found];
            }
            return '';
          };
          const num = (v: any) => { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };

          let added = 0, updated = 0, skipped = 0;
          const merged = [...customers];

          data.forEach((item: any) => {
            const code = pick(item, ["كود العميل", "الكود", "Customer Code", "code"]).toString().trim();
            const name = pick(item, ["اسم العميل", "الاسم", "Customer Name", "name"]).toString().trim();
            // صفّ بلا كود لا يُستورد: الكود هو مفتاح المطابقة والبحث
            if (!code || !name) { skipped++; return; }

            const rawRadius = pick(item, ["النطاق", "نطاق", "Radius", "radius"]);
            const parsedRadius = parseInt(String(rawRadius));

            const record: Customer = {
              id: code,
              code,
              name,
              repCode:     pick(item, ["كود المندوب", "Rep Code", "repCode"]).toString().trim(),
              repName:     pick(item, ["اسم المندوب", "Rep Name", "repName"]).toString().trim(),
              agencyCode:  pick(item, ["كود التوكيل", "Agency Code", "agencyCode"]).toString().trim(),
              agencyName:  pick(item, ["اسم التوكيل", "Agency Name", "agencyName"]).toString().trim(),
              totalDebt:   num(pick(item, ["إجمالي المديونية", "اجمالي المديونية", "Total Debt", "totalDebt"])),
              overdueDebt: num(pick(item, ["المديونية الأوفر ديو", "المديونية الاوفر ديو", "الأوفر ديو", "Overdue Debt", "overdueDebt"])),
              latitude:    num(pick(item, ["خط العرض", "Latitude", "lat"])),
              longitude:   num(pick(item, ["خط الطول", "Longitude", "lng"])),
              radius: (!isNaN(parsedRadius) && parsedRadius > 0) ? parsedRadius : undefined
            };

            // الدمج بكود العميل: إعادة استيراد كشف محدّث من نظامك تُحدّث
            // المديونيات ولا تُنشئ نسخة ثانية من العميل نفسه.
            const at = merged.findIndex(c => c.code === code);
            if (at >= 0) { merged[at] = { ...merged[at], ...record }; updated++; }
            else { merged.push(record); added++; }
          });

          setCustomers(merged);
          logAction('استيراد عملاء', `أُضيف ${added}، حُدِّث ${updated}، تُخطّي ${skipped}`);
          alert(
            `تم استيراد بيانات العملاء:\n\n` +
            `• عملاء جدد: ${added}\n` +
            `• عملاء حُدِّثت بياناتهم: ${updated}\n` +
            (skipped > 0 ? `• صفوف تُخطّيت (بلا كود أو بلا اسم): ${skipped}\n` : '') +
            `\nاضغط «حفظ السحابة» لتأكيد التغييرات.`
          );
          if (e.target) e.target.value = '';
          return;
        }

        if (type === 'branches') {
          setBranches(prev => [...prev, ...data.map((item: any) => ({
            id: Math.random().toString(36).substr(2, 9),
            code: (item["كود الفرع"] || item["كود"] || item["Code"] || item["code"] || '').toString().trim(),
            name: item["اسم الفرع"] || 'فرع جديد',
            latitude: parseFloat(item["خط العرض"] || 0),
            longitude: parseFloat(item["خط الطول"] || 0),
            radius: parseInt(item["النطاق بالمتر"] || 100)
          }))]); 
          logAction('استيراد فروع', `تم استيراد ${data.length} فرع من ملف إكسل`);
        } else if (type === 'jobs') { 
          setJobs(prev => [...prev, ...data.map((item: any) => ({ id: Math.random().toString(36).substr(2, 9), title: item["اسم الوظيفة"] || 'موظف', canVisitMultipleBranches: item["زيارة فروع متعددة"] === "نعم" }))]); 
          logAction('استيراد وظائف', `تم استيراد ${data.length} وظيفة من ملف إكسل`);
        } else if (type === 'users') {
          const existingNids = new Set(allUsers.map(u => u.nationalId));
          let duplicateCount = 0;

          const newUsers = data.map((item: any) => {
             const nid = (item["الرقم القومي"] || "").toString();
             if (existingNids.has(nid)) {
               duplicateCount++;
               return null;
             }
             existingNids.add(nid);

             const rawBranch = (item["الفرع الافتراضي"] || "").toString().trim();
             const newUser: User = {
              id: Math.random().toString(36).substr(2, 9),
              fullName: item["الاسم بالكامل"] || "موظف جديد",
              nationalId: nid,
              password: (item["كلمة المرور"] || "123456").toString(),
              jobTitle: item["الوظيفة"] || "موظف",
              defaultBranchId: rawBranch,
              defaultBranch: rawBranch,
              role: 'employee',
              deviceId: "",
              deviceIds: [],
              allowedDeviceCount: parseInt(item["عدد الاجهزة"] || "1"),
              checkInTime: item["موعد الحضور"] || "09:00",
              checkOutTime: item["موعد الانصراف"] || "17:00",
              registrationDate: new Date().toISOString()
            };
            return newUser;
          }).filter((u) => u !== null) as User[];

          if (newUsers.length > 0) {
            setAllUsers(prev => [...prev, ...newUsers]);
            logAction('استيراد موظفين', `تم استيراد ${newUsers.length} موظف بنجاح`);
            let msg = `تم استيراد ${newUsers.length} موظف بنجاح.`;
            if (duplicateCount > 0) msg += ` تم تجاهل ${duplicateCount} موظف لوجودهم مسبقاً.`;
            msg += " يرجى النقر على 'حفظ في السحابة' لتأكيد التغييرات.";
            alert(msg);
          } else {
            alert("لم يتم استيراد أي موظف. جميع البيانات موجودة مسبقاً أو الملف فارغ.");
          }
        } else {
           logAction('استيراد بيانات', 'تم استيراد بيانات من ملف إكسل');
           alert("تم استيراد البيانات بنجاح! يرجى النقر على 'حفظ في السحابة' لتأكيد التغييرات.");
        }
      } catch (err) { 
        logAction('فشل استيراد إكسل', `النوع: ${type}, الخطأ: ${err instanceof Error ? err.message : String(err)}`);
        alert("خطأ في قراءة ملف الإكسل. تأكد من صحة البيانات."); 
      }
      if(e.target) e.target.value = '';
    }; reader.readAsBinaryString(file);
  };

  const saveEditBranch = (id: string) => { 
    const branch = branches.find(b => b.id === id);
    setBranches(prev => prev.map(b => b.id === id ? { ...b, ...editBranchData } as Branch : b)); 
    logAction('تعديل فرع', `الفرع: ${branch?.name}`);
    setEditingBranchId(null); 
  };

  const addReportAccount = () => {
    if (!newRepUser || !newRepPass || (selectedJobsForAcc.length === 0 && selectedUsersForAcc.length === 0)) return alert("يرجى ملء كافة البيانات واختيار وظيفة أو موظف واحد على الأقل");
    const newAcc: ReportAccount = { 
      id: Math.random().toString(36).substr(2, 9), 
      username: newRepUser, 
      password: newRepPass, 
      allowedJobs: selectedJobsForAcc,
      allowedEmployees: selectedUsersForAcc 
    };
    setReportAccounts?.([...reportAccounts, newAcc]); 
    logAction('إضافة حساب تقارير', `المستخدم: ${newRepUser}`);
    setNewRepUser(''); setNewRepPass(''); setSelectedJobsForAcc([]); setSelectedUsersForAcc([]);
  };

  const saveEditReportAcc = (id: string) => {
    if (!editReportData.username || !editReportData.password) { alert("يرجى التأكد من اسم المستخدم وكلمة المرور"); return; }
    // Ensure arrays are initialized if they were undefined in the edit state
    const updatedAcc = {
      ...editReportData,
      allowedJobs: editReportData.allowedJobs || [],
      allowedEmployees: editReportData.allowedEmployees || []
    };
    setReportAccounts?.(prev => prev.map(acc => acc.id === id ? { ...acc, ...updatedAcc } as ReportAccount : acc)); 
    logAction('تعديل حساب تقارير', `المستخدم: ${editReportData.username}`);
    setEditingReportId(null);
  };

  // Branch Bulk Actions
  const toggleSelectBranch = (id: string) => {
    const newSelected = new Set(selectedBranches);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedBranches(newSelected);
  };

  const toggleSelectAllBranches = () => {
    if (selectedBranches.size === branches.length) setSelectedBranches(new Set());
    else setSelectedBranches(new Set(branches.map(b => b.id)));
  };

  const deleteSelectedBranches = () => {
    if (window.confirm(`هل أنت متأكد من حذف ${selectedBranches.size} فرع؟`)) {
      setBranches(branches.filter(b => !selectedBranches.has(b.id)));
      logAction('حذف فروع (بالجملة)', `تم حذف ${selectedBranches.size} فرع`);
      setSelectedBranches(new Set());
    }
  };

  const changeBranchOrder = (currentIndex: number, targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= branches.length || currentIndex === targetIndex) return;
    const updatedBranches = [...branches];
    const [removed] = updatedBranches.splice(currentIndex, 1);
    updatedBranches.splice(targetIndex, 0, removed);
    setBranches(updatedBranches);
    logAction('تعديل ترتيب الفروع كلياً', `تم نقل فرع ${removed.name} من الترتيب ${currentIndex + 1} إلى الترتيب ${targetIndex + 1}`);
  };

  return (
    <div className="space-y-6">
      <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls" onChange={(e) => handleExcelImport(e, 'branches')} />
      <input type="file" ref={jobFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={(e) => handleExcelImport(e, 'jobs')} />
      <input type="file" ref={userFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={(e) => handleExcelImport(e, 'users')} />
      <input type="file" ref={customerFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={(e) => handleExcelImport(e, 'customers')} />

      <div className="admin-shell admin-shell--edge">
        {/* ===== الشريط الجانبي ===== */}
        <aside className="admin-side">
          <div className="admin-side__brand">
            <div className="admin-side__brand-icon"><Shield size={18} /></div>
            <div className="leading-none flex-1">
              <div className="admin-side__brand-name">لوحة الإدارة</div>
              <div className="admin-side__brand-sub">Uniteam Admin</div>
            </div>
          </div>

          <nav className="admin-side__nav">
            {ADMIN_TABS.map(tab => (
              <React.Fragment key={tab.id}>
                {tab.id === 'reports' && (
                  <div className="my-1.5 border-t border-slate-700/80 pt-1.5 px-1">
                    <div className="text-[10px] font-black text-slate-400 mb-1 flex items-center gap-1">
                      <FileSpreadsheet size={12} className="text-emerald-400" />
                      <span>قسم الاستعلام</span>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`admin-nav-item${activeTab === tab.id ? ' admin-nav-item--active' : ''} ${
                    tab.id === 'reports' 
                      ? activeTab === 'reports'
                        ? '!bg-emerald-600 !text-white !border-emerald-400 shadow-lg shadow-emerald-900/40 font-bold' 
                        : '!bg-emerald-950/30 !text-emerald-300 !border-emerald-800/60 hover:!bg-emerald-900/40'
                      : ''
                  }`}
                  title={tab.label}
                >
                  <tab.icon size={16} className={`admin-nav-item__icon ${tab.id === 'reports' ? 'text-emerald-400' : ''}`} />
                  <span className="admin-nav-item__label">{tab.label}</span>
                </button>
              </React.Fragment>
            ))}
            <div className="my-1 border-t border-slate-700/60 pt-1"></div>
            <button 
              onClick={() => pushToCloud()} 
              disabled={isPushing} 
              className="admin-nav-item admin-nav-item--cloud-save cursor-pointer"
              title="حفظ كافة البيانات في السحابة"
            >
              {isPushing ? <RotateCcw size={15} className="animate-spin text-orange-400" /> : <CloudUpload size={15} className="text-orange-400" />}
              <span className="admin-nav-item__label">حفظ السحابة</span>
            </button>
          </nav>
        </aside>

        {/* ===== المحتوى ===== */}
        <div className="admin-main">
      <div className="bg-slate-800 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden p-4 md:p-6 text-white min-h-[400px]">
        {activeTab === 'users' && (
           <div className="space-y-4 md:space-y-6">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 bg-slate-900/50 p-3 md:p-4 rounded-2xl border border-slate-700">
               <div className="flex items-center gap-2.5">
                 <Users size={18} className="text-blue-400 shrink-0" />
                 <h3 className="text-xs md:text-sm font-black text-white uppercase tracking-tighter">سجل الموظفين</h3>
               </div>
               <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                  <button onClick={() => { downloadTemplate('users'); logAction('تحميل نموذج', 'نموذج استيراد الموظفين'); }} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-[10px] font-black transition-all"><Download size={13}/> نموذج استيراد</button>
                  <button onClick={() => userFileInputRef.current?.click()} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-[10px] font-black transition-all"><FileSpreadsheet size={13}/> استيراد موظفين</button>
               </div>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-right md:min-w-[1000px]">
                 <thead>
                    <tr className="border-b border-slate-700 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">
                      <th className="py-4 px-2 text-right">الموظف والوظيفة</th>
                      <th className="py-4 px-2">الرقم القومي</th>
                      <th className="py-4 px-2">التوكيل</th>
                      <th className="py-4 px-2">الأجهزة المرتبطة</th>
                      <th className="py-4 px-2">إجراءات</th>
                    </tr>
                 </thead>
                 <tbody>
                  {allUsers.map(user => {
                   // Calculate device count properly considering both legacy and new array
                   const deviceCount = user.deviceIds ? user.deviceIds.length : (user.deviceId ? 1 : 0);
                   const allowedCount = user.allowedDeviceCount || 1;

                   return (
                   <tr key={user.id} className="border-b border-slate-700/50 hover:bg-slate-900/30 transition-all text-center">
                     <td data-label="الموظف والوظيفة" className="py-4 px-2 text-right">
                        {editingUserId === user.id ? (
                          <div className="space-y-1">
                            <input className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-white" value={editUserData.fullName || ''} onChange={e => setEditUserData({...editUserData, fullName: e.target.value})} />
                            <select className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-[10px] w-full text-white" value={editUserData.jobTitle || ''} onChange={e => setEditUserData({...editUserData, jobTitle: e.target.value})}>
                              {jobs.map(j => <option key={j.id} value={j.title}>{j.title}</option>)}
                            </select>
                          </div>
                        ) : (
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-white">{user.fullName}</span>
                            <span className="text-blue-400 text-[10px] font-black uppercase">{user.jobTitle}</span>
                          </div>
                        )}
                     </td>
                     <td data-label="الرقم القومي" className="py-4 px-2 text-slate-400 text-xs font-mono">
                        {editingUserId === user.id ? (
                          <input className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-center text-white" value={editUserData.nationalId || ''} onChange={e => setEditUserData({...editUserData, nationalId: e.target.value})} />
                        ) : user.nationalId}
                     </td>
                     <td data-label="التوكيل" className="py-4 px-2">
                        {editingUserId === user.id ? (
                          <select className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-[10px] w-full text-white" value={editUserData.defaultBranchId || ''} onChange={e => setEditUserData({...editUserData, defaultBranchId: e.target.value})}>
                            {branches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-300 font-bold">{user.defaultBranchId || user.defaultBranch || user.assignedBranch || user.branch || 'غير محدد'}</span>
                        )}
                     </td>
                     <td data-label="الأجهزة المرتبطة" className="py-4 px-2">
                        {editingUserId === user.id ? (
                           <div className="flex items-center gap-1 justify-center">
                             <span className="text-[10px] text-slate-500">الحد:</span>
                             <input type="number" min="1" max="10" className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-12 text-center text-white" value={editUserData.allowedDeviceCount || 1} onChange={e => setEditUserData({...editUserData, allowedDeviceCount: parseInt(e.target.value) || 1})} />
                           </div>
                        ) : (
                           <div className={`flex items-center justify-center gap-1 px-3 py-1 rounded-full text-[9px] font-black border mx-auto w-fit ${deviceCount > 0 ? 'bg-green-600/10 text-green-400 border-green-900/30' : 'bg-slate-900 text-slate-500 border-slate-700'}`}>
                             <Smartphone size={10} /> {deviceCount} / {allowedCount}
                           </div>
                        )}
                     </td>
                     <td data-label="إجراءات" className="py-4 px-2">
                        <div className="flex justify-center gap-2">
                           {editingUserId === user.id ? (
                             <>
                               <button onClick={() => saveEditUser(user.id)} className="text-green-500 hover:bg-green-900/20 p-1.5 rounded"><Check size={18}/></button>
                               <button onClick={() => setEditingUserId(null)} className="text-red-500 hover:bg-red-900/20 p-1.5 rounded"><X size={18}/></button>
                             </>
                           ) : (
                             <>
                               <button onClick={() => { 
                                 setEditingUserId(user.id); 
                                  setEditUserData({
                                    ...user,
                                    checkInTime: normalizeToTimeInput(user.checkInTime),
                                    checkOutTime: normalizeToTimeInput(user.checkOutTime),
                                    allowedDeviceCount: user.allowedDeviceCount || 1
                                  });
                                }} className="text-blue-400 hover:bg-blue-900/20 p-1.5 rounded"><Edit2 size={16}/></button>

                                <button
                                  onClick={() => resetUserPassword(user)}
                                  disabled={resettingUserId === user.id}
                                  className="text-amber-400 hover:bg-amber-900/20 p-1.5 rounded cursor-pointer disabled:opacity-50"
                                  title="إعادة تعيين كلمة المرور"
                                >
                                  {resettingUserId === user.id
                                    ? <Loader2 size={16} className="animate-spin" />
                                    : <KeyRound size={16} />}
                                </button>

                                {deviceCount > 0 && (
                                  <button onClick={() => {
                                    if(confirm('هل أنت متأكد من فك ارتباط جميع الأجهزة لهذا الموظف؟')) {
                                      setAllUsers(allUsers.map(u => u.id === user.id ? {...u, deviceId: "", deviceIds: []} : u));
                                      logAction('فك ارتباط أجهزة', `الموظف: ${user.fullName}`);
                                    }
                                  }} className="text-orange-400 hover:bg-orange-900/20 p-1.5 rounded" title="فك ارتباط جميع الأجهزة"><Unlink size={16}/></button>
                                )}
                                
                                <button onClick={() => { 
                                  if(confirm('حذف الموظف؟')) {
                                    setAllUsers(allUsers.filter(u => u.id !== user.id));
                                    logAction('حذف موظف', `الموظف: ${user.fullName}`);
                                  }
                                }} className="text-slate-500 hover:text-red-400 p-1.5"><Trash2 size={16}/></button>
                              </>
                            )}
                         </div>
                      </td>
                    </tr>
                   );
                   })}</tbody>
                </table>
              </div>
            </div>
         )}
         {activeTab === 'branches' && (
           <div className="space-y-4 md:space-y-6">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 bg-slate-900/50 p-3 md:p-4 rounded-2xl border border-slate-700">
               <div className="flex items-center gap-2.5">
                 <MapPin size={18} className="text-blue-400 shrink-0" />
                 <h3 className="text-xs md:text-sm font-black text-white uppercase tracking-tighter">إدارة الفروع والمواقع</h3>
               </div>
               <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                 <button onClick={() => { downloadTemplate('branches'); logAction('تحميل نموذج', 'نموذج استيراد الفروع'); }} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-[10px] font-black transition-all"><Download size={13}/> نموذج استيراد</button>
                 <button onClick={() => fileInputRef.current?.click()} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-[10px] font-black transition-all"><FileSpreadsheet size={13}/> استيراد فروع</button>
               </div>
             </div>
             
             <div className="bg-slate-900/50 p-3.5 md:p-5 rounded-2xl border border-slate-700 space-y-3">
               <div className="text-xs font-black text-slate-300 flex items-center gap-1.5">
                 <Plus size={15} className="text-blue-400" /> إضافة فرع جديد
               </div>
               <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                 <input type="text" placeholder="كود الفرع" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white col-span-1" value={newBranch.code || ''} onChange={e => setNewBranch({...newBranch, code: e.target.value})} />
                 <input type="text" placeholder="اسم الفرع" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs outline-none text-white col-span-2 sm:col-span-1" value={newBranch.name} onChange={e => setNewBranch({...newBranch, name: e.target.value})} />
                 <input type="number" step="0.000001" placeholder="Lat (العرض)" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white col-span-1" value={newBranch.latitude || ''} onChange={e => setNewBranch({...newBranch, latitude: parseFloat(e.target.value)})} />
                 <input type="number" step="0.000001" placeholder="Lng (الطول)" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white col-span-1" value={newBranch.longitude || ''} onChange={e => setNewBranch({...newBranch, longitude: parseFloat(e.target.value)})} />
                 <input type="number" placeholder="النطاق (متر)" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs outline-none text-white col-span-1" value={newBranch.radius || ''} onChange={e => setNewBranch({...newBranch, radius: parseInt(e.target.value)})} />
                 <button onClick={() => {
                   if (newBranch.name) {
                     setBranches([...branches, { ...newBranch, id: Math.random().toString(36).substr(2, 9), radius: newBranch.radius || 100 } as Branch]);
                     logAction('إضافة فرع جديد', `الفرع: ${newBranch.name} (${newBranch.code || 'بدون كود'})`);
                     setNewBranch({ code: '', name: '', latitude: 0, longitude: 0, radius: 100 });
                   }
                 }} className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black py-2 px-4 text-xs flex items-center justify-center gap-1.5 transition-all col-span-2 sm:col-span-1 shadow-md">
                   <Plus size={16}/> إضافة فرع
                 </button>
               </div>
             </div>

             <div className="flex justify-between items-center">
                <h4 className="text-sm font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">الفروع الحالية</h4>
                <div className="flex gap-2">
                   {selectedBranches.size > 0 && (
                      <button onClick={deleteSelectedBranches} className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-[10px] font-black animate-pulse">
                         <Trash2 size={13}/> حذف المحدد ({selectedBranches.size})
                      </button>
                   )}
                </div>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-right md:min-w-[700px]">
                 <thead><tr className="border-b border-slate-700 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                   <th className="py-4 px-2 w-10 text-center"><input type="checkbox" checked={selectedBranches.size === branches.length && branches.length > 0} onChange={toggleSelectAllBranches} className="accent-blue-600 cursor-pointer" /></th>
                   <th className="py-4 px-2 text-center w-28">الترتيب</th>
                   <th className="py-4 px-2 text-center">كود الفرع</th>
                   <th className="py-4 px-2">اسم الفرع</th><th className="py-4 px-2">إحداثيات (Lat, Lng)</th><th className="py-4 px-2 text-center">النطاق</th><th className="py-4 px-2 text-center">إجراءات</th></tr></thead>
                                   <tbody>{branches.map((b, idx) => (
                    <tr 
                      key={b.id} 
                      draggable={editingBranchId !== b.id}
                      onDragStart={(e) => {
                        setDraggedBranchIndex(idx);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedBranchIndex !== null && draggedBranchIndex !== idx) {
                          changeBranchOrder(draggedBranchIndex, idx);
                        }
                        setDraggedBranchIndex(null);
                      }}
                      onDragEnd={() => setDraggedBranchIndex(null)}
                      className={`border-b border-slate-700/50 hover:bg-slate-900/30 transition-colors ${draggedBranchIndex === idx ? 'opacity-40 bg-blue-900/20' : ''}`}
                    >
                      <td data-label="تحديد" className="py-4 px-2 text-center"><input type="checkbox" checked={selectedBranches.has(b.id)} onChange={() => toggleSelectBranch(b.id)} className="accent-blue-600 cursor-pointer" /></td>
                      <td data-label="الترتيب" className="py-4 px-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <div 
                            title="اسحب لتغيير الترتيب" 
                            className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-blue-400 p-1 rounded hover:bg-slate-800 transition-colors"
                          >
                            <GripVertical size={14} />
                          </div>
                          <select 
                            value={idx} 
                            onChange={(e) => {
                              const targetIdx = parseInt(e.target.value);
                              changeBranchOrder(idx, targetIdx);
                            }}
                            className="bg-slate-900 border border-slate-700 hover:border-blue-500 rounded px-1.5 py-1 text-[11px] text-blue-400 font-bold outline-none cursor-pointer text-center"
                            title="اختر الترتيب المباشر"
                          >
                            {branches.map((_, i) => (
                              <option key={i} value={i} className="bg-slate-950 text-white font-mono">
                                {i + 1}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td data-label="كود الفرع" className="py-4 px-2 text-center font-mono text-xs font-bold text-amber-400">{editingBranchId === b.id ? (<input className="bg-slate-900 border border-blue-500 rounded px-2 py-1.5 text-xs font-mono w-full outline-none text-white text-center" placeholder="كود" value={editBranchData.code || ''} onChange={e => setEditBranchData({...editBranchData, code: e.target.value})} />) : (b.code || '--')}</td>
                      <td data-label="اسم الفرع" className="py-4 px-2 font-black">{editingBranchId === b.id ? (<input className="bg-slate-900 border border-blue-500 rounded px-3 py-1.5 text-xs w-full outline-none text-white" value={editBranchData.name || ''} onChange={e => setEditBranchData({...editBranchData, name: e.target.value})} />) : (<span className="text-emerald-400">{b.name}</span>)}</td>
                      <td data-label="إحداثيات (Lat, Lng)" className="py-4 px-2">{editingBranchId === b.id ? (<div className="flex gap-1"><input type="number" step="0.000001" className="bg-slate-900 border border-blue-500 rounded px-2 py-1.5 text-[10px] w-full font-mono outline-none text-white" placeholder="Lat" value={editBranchData.latitude || ''} onChange={e => setEditBranchData({...editBranchData, latitude: parseFloat(e.target.value)})} /><input type="number" step="0.000001" className="bg-slate-900 border border-blue-500 rounded px-2 py-1.5 text-[10px] w-full font-mono outline-none text-white" placeholder="Lng" value={editBranchData.longitude || ''} onChange={e => setEditBranchData({...editBranchData, longitude: parseFloat(e.target.value)})} /></div>) : (<span className="text-[10px] text-slate-400 font-mono">{b.latitude.toFixed(6)}, {b.longitude.toFixed(6)}</span>)}</td>
                      <td data-label="النطاق" className="py-4 px-2 text-center">{editingBranchId === b.id ? (<input type="number" className="bg-slate-900 border border-blue-500 rounded px-2 py-1.5 text-xs w-20 text-center outline-none text-white" value={editBranchData.radius || ''} onChange={e => setEditBranchData({...editBranchData, radius: parseInt(e.target.value)})} />) : (<span className="text-blue-400 font-black text-xs">{b.radius}م</span>)}</td>
                      <td data-label="إجراءات" className="py-4 px-2 text-center"><div className="flex justify-center gap-2">{editingBranchId === b.id ? (<><button onClick={() => saveEditBranch(b.id)} className="text-green-500 hover:bg-green-500/10 p-2 rounded-lg transition-all"><Check size={18}/></button><button onClick={() => setEditingBranchId(null)} className="text-red-500 hover:bg-red-500/10 p-2 rounded-lg transition-all"><X size={18}/></button></>) : (<><button onClick={() => { setEditingBranchId(b.id); setEditBranchData(b); }} className="text-blue-400 hover:bg-blue-400/10 p-2 rounded-lg transition-all" title="تعديل"><Edit2 size={16}/></button><button onClick={() => { if(confirm('حذف الفرع؟')) { setBranches(branches.filter(x => x.id !== b.id)); logAction('حذف فرع', `الفرع: ${b.name}`); } }} className="text-slate-500 hover:text-red-400 hover:bg-red-400/10 p-2 rounded-lg transition-all" title="حذف"><Trash2 size={16}/></button></>)}</div></td>
                    </tr>
                  ))}</tbody>
               </table>
             </div>
          </div>
         )}
         {activeTab === 'jobs' && (
          <div className="space-y-4 md:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 bg-slate-900/50 p-3 md:p-4 rounded-2xl border border-slate-700">
              <div className="flex items-center gap-2.5">
                <Briefcase size={18} className="text-blue-400 shrink-0" />
                <h3 className="text-xs md:text-sm font-black text-white uppercase tracking-tighter">المسميات الوظيفية</h3>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                <button onClick={() => { downloadTemplate('jobs'); logAction('تحميل نموذج', 'نموذج استيراد الوظائف'); }} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-[10px] font-black transition-all"><Download size={13}/> نموذج استيراد</button>
                <button onClick={() => jobFileInputRef.current?.click()} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-[10px] font-black transition-all"><FileSpreadsheet size={13}/> استيراد وظائف</button>
              </div>
            </div>

            <div className="bg-slate-900/50 p-3.5 md:p-5 rounded-2xl border border-slate-700 space-y-3">
               <div className="text-xs font-black text-slate-300 flex items-center gap-1.5">
                 <Plus size={15} className="text-blue-400" /> إضافة وظيفة جديدة
               </div>
               <div className="flex flex-col sm:flex-row gap-2">
                  <input type="text" placeholder="عنوان الوظيفة الجديد" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs outline-none text-white flex-1 min-w-0" value={newJobTitle} onChange={e => setNewJobTitle(e.target.value)} />
                  <button onClick={() => { if(newJobTitle.trim()) { setJobs([...jobs, { id: Math.random().toString(36).substr(2, 9), title: newJobTitle, workingDays: [0, 1, 2, 3, 4, 6] }]); logAction('إضافة وظيفة جديدة', `الوظيفة: ${newJobTitle}`); setNewJobTitle(''); } }} className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-2 text-xs font-black flex items-center justify-center gap-1.5 transition-all shrink-0 shadow-md"><Plus size={16}/> إضافة وظيفة</button>
               </div>
            </div>

            <div className="flex justify-between items-center">
               <h4 className="text-sm font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">الوظائف المتاحة ({jobs.length})</h4>
            </div>

            <div className="overflow-x-auto bg-slate-900/50 rounded-2xl border border-slate-700">
              <table className="w-full text-right md:min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-700 text-[10px] sm:text-xs font-black text-slate-500 uppercase tracking-widest text-center">
                    <th className="py-4 px-3 md:px-4 text-right">المسمى الوظيفي</th>
                    <th className="py-4 px-3 md:px-4 text-center">صلاحية التنقل</th>
                    <th className="py-4 px-3 md:px-4 text-center">أيام العمل الأسبوعية</th>
                    <th className="py-4 px-3 md:px-4 text-center w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(j => {
                    const DAYS = [
                      { id: 0, label: 'ح' },
                      { id: 1, label: 'ن' },
                      { id: 2, label: 'ث' },
                      { id: 3, label: 'ر' },
                      { id: 4, label: 'خ' },
                      { id: 5, label: 'ج' },
                      { id: 6, label: 'س' }
                    ];
                    const toggleJobDay = (jobId: string, dayId: number) => {
                      setJobs(jobs.map(job => {
                        if (job.id === jobId) {
                          const currentDays = job.workingDays || [0, 1, 2, 3, 4, 6];
                          const newDays = currentDays.includes(dayId) ? currentDays.filter(d => d !== dayId) : [...currentDays, dayId];
                          logAction('تعديل أيام عمل الوظيفة', `الوظيفة: ${job.title}, اليوم: ${DAYS.find(d => d.id === dayId)?.label}`);
                          return { ...job, workingDays: newDays };
                        }
                        return job;
                      }));
                    };

                    return (
                      <tr key={j.id} className="border-b border-slate-700/50 hover:bg-slate-900/30 transition-all text-center">
                        <td data-label="المسمى الوظيفي" className="py-4 px-3 md:px-4 text-right">
                          <span className="font-bold text-xs sm:text-sm text-white">{j.title}</span>
                        </td>
                        <td data-label="صلاحية التنقل" className="py-4 px-3 md:px-4 text-center">
                          <button
                            onClick={() => {
                              setJobs(jobs.map(job => job.id === j.id ? { ...job, canVisitMultipleBranches: !job.canVisitMultipleBranches } : job));
                              logAction('تعديل صلاحية التنقل', `الوظيفة: ${j.title}`);
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                              j.canVisitMultipleBranches
                                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'
                            }`}
                            title="اضغط لتغيير الصلاحية"
                          >
                            <Navigation size={13} className="shrink-0" />
                            <span>{j.canVisitMultipleBranches ? 'مسموح بزيارة فروع متعددة' : 'فرع واحد فقط'}</span>
                          </button>
                        </td>
                        <td data-label="أيام العمل الأسبوعية" className="py-4 px-3 md:px-4 text-center">
                          <div className="flex items-center justify-center gap-1 sm:gap-1.5">
                            {DAYS.map(d => {
                              const isSelected = (j.workingDays || [0, 1, 2, 3, 4, 6]).includes(d.id);
                              return (
                                <button
                                  key={d.id}
                                  onClick={() => toggleJobDay(j.id, d.id)}
                                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg text-xs font-black transition-all flex items-center justify-center cursor-pointer ${
                                    isSelected
                                      ? 'bg-blue-600 text-white shadow-xs'
                                      : 'bg-slate-800 text-slate-500 border border-slate-700/60 hover:bg-slate-700 hover:text-slate-300'
                                  }`}
                                  title={`يوم ${d.label}`}
                                >
                                  {d.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td data-label="إجراءات" className="py-4 px-3 md:px-4 text-center">
                          <button
                            onClick={() => {
                              if (confirm('حذف الوظيفة؟')) {
                                setJobs(jobs.filter(x => x.id !== j.id));
                                logAction('حذف وظيفة', `الوظيفة: ${j.title}`);
                              }
                            }}
                            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer"
                            title="حذف الوظيفة"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'customers' && (
          <div className="space-y-4 md:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 bg-slate-900/50 p-3 md:p-4 rounded-2xl border border-slate-700">
              <div className="flex items-center gap-2.5">
                <Store size={18} className="text-blue-400 shrink-0" />
                <div>
                  <h3 className="text-xs md:text-sm font-black text-white">سجل العملاء</h3>
                  <p className="text-[11px] text-slate-400 font-bold">{customers.length} عميل · الموظف يرى عملاء توكيله وحده</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                <button onClick={() => { downloadTemplate('customers'); logAction('تحميل نموذج', 'نموذج استيراد العملاء'); }} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-black transition-all"><Download size={13}/> نموذج استيراد</button>
                <button onClick={() => customerFileInputRef.current?.click()} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-black transition-all"><FileSpreadsheet size={13}/> استيراد العملاء</button>
                <button onClick={() => { if (confirm(`حذف جميع العملاء (${customers.length})؟\n\nلن يُحذفوا من السحابة إلا بعد الضغط على «حفظ السحابة».`)) { setCustomers([]); logAction('مسح جميع العملاء', `تم مسح ${customers.length} عميل`); } }} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600/10 text-red-400 border border-red-900/30 rounded-lg text-xs font-black transition-all"><Trash2 size={13}/> مسح الكل</button>
              </div>
            </div>

            <div className="bg-blue-950/25 border border-blue-800/40 rounded-2xl p-3.5 text-xs text-blue-200/90 font-bold leading-relaxed">
              الاستيراد يدمج بكود العميل: الكود الموجود تُحدَّث بياناته، والجديد يُضاف — فإعادة رفع كشف محدّث لا تُكرّر العملاء.
              وعمود «النطاق» اختياري، ومن يتركه فارغاً يأخذ الافتراضي ({config.defaultCustomerRadius || 100} م).
            </div>

            <div className="bg-slate-900/50 p-3.5 md:p-4 rounded-2xl border border-slate-700 space-y-2.5">
               <h4 className="text-xs font-black text-blue-400 flex items-center gap-1.5"><Plus size={15}/> إضافة عميل يدوياً</h4>
               <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  <input type="text" placeholder="كود العميل" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white" value={newCustomer.code || ''} onChange={e => setNewCustomer({...newCustomer, code: e.target.value})} />
                  <input type="text" placeholder="اسم العميل" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs outline-none text-white col-span-2 sm:col-span-1" value={newCustomer.name || ''} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} />
                  <input type="text" placeholder="كود المندوب" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white" value={newCustomer.repCode || ''} onChange={e => setNewCustomer({...newCustomer, repCode: e.target.value})} />
                  <input type="text" placeholder="اسم المندوب" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs outline-none text-white" value={newCustomer.repName || ''} onChange={e => setNewCustomer({...newCustomer, repName: e.target.value})} />
                  <input type="text" placeholder="كود التوكيل" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white" value={newCustomer.agencyCode || ''} onChange={e => setNewCustomer({...newCustomer, agencyCode: e.target.value})} />
                  <input type="text" placeholder="اسم التوكيل" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs outline-none text-white" value={newCustomer.agencyName || ''} onChange={e => setNewCustomer({...newCustomer, agencyName: e.target.value})} />
                  <input type="number" placeholder="إجمالي المديونية" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white" value={newCustomer.totalDebt || ''} onChange={e => setNewCustomer({...newCustomer, totalDebt: parseFloat(e.target.value) || 0})} />
                  <input type="number" placeholder="الأوفر ديو" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white" value={newCustomer.overdueDebt || ''} onChange={e => setNewCustomer({...newCustomer, overdueDebt: parseFloat(e.target.value) || 0})} />
                  <input type="number" step="0.000001" placeholder="خط العرض" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white" value={newCustomer.latitude || ''} onChange={e => setNewCustomer({...newCustomer, latitude: parseFloat(e.target.value) || 0})} />
                  <input type="number" step="0.000001" placeholder="خط الطول" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white" value={newCustomer.longitude || ''} onChange={e => setNewCustomer({...newCustomer, longitude: parseFloat(e.target.value) || 0})} />
                  <input type="number" placeholder="النطاق (اختياري)" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono outline-none text-white" value={newCustomer.radius || ''} onChange={e => setNewCustomer({...newCustomer, radius: parseInt(e.target.value) || undefined})} />
                  <button
                    onClick={() => {
                      const code = (newCustomer.code || '').trim();
                      const name = (newCustomer.name || '').trim();
                      if (!code || !name) { alert('كود العميل واسمه إلزاميان.'); return; }
                      if (customers.some(c => c.code === code)) { alert(`الكود ${code} مستعمل بالفعل لعميل آخر.`); return; }
                      setCustomers([...customers, { ...newCustomer, id: code, code, name } as Customer]);
                      logAction('إضافة عميل', `العميل: ${name} (${code})`);
                      setNewCustomer(emptyCustomer);
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black py-2 px-4 text-xs flex items-center justify-center gap-1.5 transition-all col-span-2 sm:col-span-1 shadow-md"
                  >
                    <Plus size={16}/> إضافة عميل
                  </button>
               </div>
            </div>

            <div className="relative">
              <input
                type="text"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                placeholder="ابحث بكود العميل أو باسمه أو بالمندوب أو بالتوكيل…"
                className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl pr-10 pl-4 py-2.5 text-xs outline-none text-white"
              />
              <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right md:min-w-[980px]">
                <thead>
                  <tr className="border-b border-slate-700 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">
                    <th className="py-4 px-2 text-right">العميل</th>
                    <th className="py-4 px-2">المندوب</th>
                    <th className="py-4 px-2">التوكيل</th>
                    <th className="py-4 px-2">إجمالي المديونية</th>
                    <th className="py-4 px-2">الأوفر ديو</th>
                    <th className="py-4 px-2">الإحداثيات</th>
                    <th className="py-4 px-2">النطاق</th>
                    <th className="py-4 px-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const q = customerSearch.trim().toLowerCase();
                    const shown = q
                      ? customers.filter(c =>
                          c.code.toLowerCase().includes(q) ||
                          c.name.toLowerCase().includes(q) ||
                          (c.repCode || '').toLowerCase().includes(q) ||
                          (c.repName || '').toLowerCase().includes(q) ||
                          c.agencyCode.toLowerCase().includes(q) ||
                          c.agencyName.toLowerCase().includes(q))
                      : customers;

                    if (shown.length === 0) {
                      return (
                        <tr>
                          <td colSpan={8} className="py-12 text-center">
                            <Store size={36} className="mx-auto opacity-20 mb-3" />
                            <div className="text-sm font-bold text-slate-300">
                              {customers.length === 0 ? 'لا يوجد عملاء بعد' : 'لا نتائج لبحثك'}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {customers.length === 0
                                ? 'حمّل نموذج الاستيراد، املأه ببيانات عملائك، ثم استورده.'
                                : 'جرّب كود العميل بدل الاسم، أو جزءاً منه.'}
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return shown.map(c => {
                      const isEditing = editingCustomerId === c.id;
                      const missingGeo = !c.latitude || !c.longitude;
                      return (
                        <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-900/30 transition-all text-center">
                          <td data-label="العميل" className="py-4 px-2 text-right">
                            {isEditing ? (
                              <input className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-white" value={editCustomerData.name || ''} onChange={e => setEditCustomerData({...editCustomerData, name: e.target.value})} />
                            ) : (
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-white">{c.name}</span>
                                <span className="text-amber-400 text-xs font-black font-mono">{c.code}</span>
                              </div>
                            )}
                          </td>
                          <td data-label="المندوب" className="py-4 px-2">
                            {isEditing ? (
                              <div className="flex gap-1">
                                <input className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-white font-mono" placeholder="كود" value={editCustomerData.repCode || ''} onChange={e => setEditCustomerData({...editCustomerData, repCode: e.target.value})} />
                                <input className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-white" placeholder="اسم" value={editCustomerData.repName || ''} onChange={e => setEditCustomerData({...editCustomerData, repName: e.target.value})} />
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                <span className="text-xs text-slate-300 font-bold">{c.repName || '—'}</span>
                                <span className="text-[11px] text-slate-500 font-mono">{c.repCode}</span>
                              </div>
                            )}
                          </td>
                          <td data-label="التوكيل" className="py-4 px-2">
                            {isEditing ? (
                              <div className="flex gap-1">
                                <input className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-white font-mono" placeholder="كود" value={editCustomerData.agencyCode || ''} onChange={e => setEditCustomerData({...editCustomerData, agencyCode: e.target.value})} />
                                <input className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-white" placeholder="اسم" value={editCustomerData.agencyName || ''} onChange={e => setEditCustomerData({...editCustomerData, agencyName: e.target.value})} />
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                <span className="text-xs text-slate-300 font-bold">{c.agencyName || '—'}</span>
                                <span className="text-[11px] text-slate-500 font-mono">{c.agencyCode}</span>
                              </div>
                            )}
                          </td>
                          <td data-label="إجمالي المديونية" className="py-4 px-2">
                            {isEditing ? (
                              <input type="number" className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-24 text-center text-white font-mono" value={editCustomerData.totalDebt ?? ''} onChange={e => setEditCustomerData({...editCustomerData, totalDebt: parseFloat(e.target.value) || 0})} />
                            ) : (
                              <span className="text-xs font-black text-white font-mono">{(c.totalDebt || 0).toLocaleString('en-US')}</span>
                            )}
                          </td>
                          <td data-label="الأوفر ديو" className="py-4 px-2">
                            {isEditing ? (
                              <input type="number" className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-24 text-center text-white font-mono" value={editCustomerData.overdueDebt ?? ''} onChange={e => setEditCustomerData({...editCustomerData, overdueDebt: parseFloat(e.target.value) || 0})} />
                            ) : (
                              <span className={`text-xs font-black font-mono ${c.overdueDebt > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                                {(c.overdueDebt || 0).toLocaleString('en-US')}
                              </span>
                            )}
                          </td>
                          <td data-label="الإحداثيات" className="py-4 px-2">
                            {isEditing ? (
                              <div className="flex gap-1">
                                <input type="number" step="0.000001" className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-[11px] w-full font-mono text-white" placeholder="Lat" value={editCustomerData.latitude ?? ''} onChange={e => setEditCustomerData({...editCustomerData, latitude: parseFloat(e.target.value) || 0})} />
                                <input type="number" step="0.000001" className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-[11px] w-full font-mono text-white" placeholder="Lng" value={editCustomerData.longitude ?? ''} onChange={e => setEditCustomerData({...editCustomerData, longitude: parseFloat(e.target.value) || 0})} />
                              </div>
                            ) : missingGeo ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-black text-red-400 bg-red-900/20 border border-red-900/40 px-2 py-1 rounded-lg">
                                <AlertTriangle size={11} /> بلا موقع
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 font-mono">{c.latitude.toFixed(6)}, {c.longitude.toFixed(6)}</span>
                            )}
                          </td>
                          <td data-label="النطاق" className="py-4 px-2">
                            {isEditing ? (
                              <input type="number" className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-20 text-center text-white font-mono" value={editCustomerData.radius ?? ''} onChange={e => setEditCustomerData({...editCustomerData, radius: parseInt(e.target.value) || undefined})} />
                            ) : (
                              <span className="text-xs font-bold text-blue-400 font-mono">
                                {c.radius ? `${c.radius}م` : `${config.defaultCustomerRadius || 100}م`}
                              </span>
                            )}
                          </td>
                          <td data-label="إجراءات" className="py-4 px-2">
                            <div className="flex items-center justify-center gap-2">
                              {isEditing ? (
                                <>
                                  <button onClick={() => {
                                    setCustomers(customers.map(x => x.id === c.id ? { ...x, ...editCustomerData } as Customer : x));
                                    logAction('تعديل عميل', `العميل: ${c.name} (${c.code})`);
                                    setEditingCustomerId(null); setEditCustomerData({});
                                  }} className="text-green-500 hover:bg-green-500/10 p-2 rounded-lg transition-all"><Check size={18}/></button>
                                  <button onClick={() => { setEditingCustomerId(null); setEditCustomerData({}); }} className="text-red-500 hover:bg-red-500/10 p-2 rounded-lg transition-all"><X size={18}/></button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => { setEditingCustomerId(c.id); setEditCustomerData(c); }} className="text-blue-400 hover:bg-blue-400/10 p-2 rounded-lg transition-all" title="تعديل"><Edit2 size={16}/></button>
                                  <button onClick={() => { if(confirm(`حذف العميل ${c.name}؟`)) { setCustomers(customers.filter(x => x.id !== c.id)); logAction('حذف عميل', `العميل: ${c.name} (${c.code})`); } }} className="text-slate-500 hover:text-red-400 hover:bg-red-400/10 p-2 rounded-lg transition-all" title="حذف"><Trash2 size={16}/></button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'report-access' && (
          <div className="space-y-4 md:space-y-6">
            <div className="bg-slate-900/50 p-3 md:p-4 rounded-2xl border border-slate-700 flex items-center gap-2.5">
              <Key size={18} className="text-blue-400 shrink-0" />
              <h3 className="text-xs md:text-sm font-black text-white uppercase tracking-tighter">حسابات متابعة التقارير</h3>
            </div>

            <div className="bg-slate-900/50 p-3.5 md:p-5 rounded-2xl border border-slate-700 space-y-3">
              <h4 className="text-xs font-black text-blue-400 flex items-center gap-1.5 uppercase tracking-widest"><Key size={16}/> إنشاء حساب جديد لمتابعة التقارير</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="text" placeholder="اسم المستخدم" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs outline-none text-white" value={newRepUser} onChange={e => setNewRepUser(e.target.value)} />
                <input type="password" placeholder="كلمة المرور" className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs outline-none text-white" value={newRepPass} onChange={e => setNewRepPass(e.target.value)} />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center mr-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1"><Briefcase size={12}/> الوظائف المسموح بمتابعتها</label>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedJobsForAcc(jobs.map(j => j.title))} className="text-[9px] text-blue-400 hover:text-blue-300 font-black">تحديد الكل</button>
                    <button onClick={() => setSelectedJobsForAcc([])} className="text-[9px] text-slate-500 hover:text-slate-400 font-black">إلغاء الكل</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 p-4 bg-slate-900 border border-slate-700 rounded-xl h-24 overflow-y-auto scrollbar-hide">
                  {jobs.map(j => (
                    <button key={j.id} onClick={() => { if (selectedJobsForAcc.includes(j.title)) { setSelectedJobsForAcc(selectedJobsForAcc.filter(t => t !== j.title)); } else { setSelectedJobsForAcc([...selectedJobsForAcc, j.title]); } }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border ${selectedJobsForAcc.includes(j.title) ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'}`}>
                      {j.title}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center mr-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1"><UserCheck size={12}/> الموظفين المسموح بمتابعتهم (تحديد خاص)</label>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedUsersForAcc(allUsers.filter(u => u.role !== 'admin').map(u => u.fullName))} className="text-[9px] text-green-400 hover:text-green-300 font-black">تحديد الكل</button>
                    <button onClick={() => setSelectedUsersForAcc([])} className="text-[9px] text-slate-500 hover:text-slate-400 font-black">إلغاء الكل</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 p-4 bg-slate-900 border border-slate-700 rounded-xl h-24 overflow-y-auto scrollbar-hide">
                  {allUsers.filter(u => u.role !== 'admin').map(u => (
                    <button key={u.id} onClick={() => { if (selectedUsersForAcc.includes(u.fullName)) { setSelectedUsersForAcc(selectedUsersForAcc.filter(t => t !== u.fullName)); } else { setSelectedUsersForAcc([...selectedUsersForAcc, u.fullName]); } }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border ${selectedUsersForAcc.includes(u.fullName) ? 'bg-green-600 text-white border-green-500' : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'}`}>
                      {u.fullName}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={addReportAccount} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all"><Plus size={20} /> إنشاء الحساب</button>
            </div>
            <div className="overflow-x-auto mt-6">
              <table className="w-full text-right">
                <thead>
                  <tr className="border-b border-slate-700 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <th className="py-4 px-2">اسم المستخدم</th>
                    <th className="py-4 px-2">كلمة المرور</th>
                    <th className="py-4 px-2">الوظائف المسموح بها</th>
                    <th className="py-4 px-2">الموظفين المسموح بهم</th>
                    <th className="py-4 px-2 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {reportAccounts.map(acc => (
                    <tr key={acc.id} className="border-b border-slate-700/50 hover:bg-slate-900/30 transition-all">
                      <td data-label="اسم المستخدم" className="py-4 px-2 font-bold text-sm text-white">
                        {editingReportId === acc.id ? (
                          <input className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-white" value={editReportData.username || ''} onChange={e => setEditReportData({...editReportData, username: e.target.value})} />
                        ) : acc.username}
                      </td>
                      <td data-label="كلمة المرور" className="py-4 px-2 font-mono text-xs text-slate-400">
                        {editingReportId === acc.id ? (
                          <input type="text" className="bg-slate-900 border border-blue-500 rounded px-2 py-1 text-xs w-full text-white" value={editReportData.password || ''} onChange={e => setEditReportData({...editReportData, password: e.target.value})} />
                        ) : (
                          <div className="flex items-center gap-2">
                            {showPass === acc.id ? acc.password : '••••••••'}
                            <button onClick={() => setShowPass(showPass === acc.id ? null : acc.id)} className="text-slate-600 hover:text-blue-400">
                              {showPass === acc.id ? <EyeOff size={14}/> : <Eye size={14}/>}
                            </button>
                          </div>
                        )}
                      </td>
                      <td data-label="الوظائف المسموح بها" className="py-4 px-2">
                        {editingReportId === acc.id ? (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center px-1">
                              <button onClick={() => setEditReportData({...editReportData, allowedJobs: jobs.map(j => j.title)})} className="text-[8px] text-blue-400 font-black">الكل</button>
                              <button onClick={() => setEditReportData({...editReportData, allowedJobs: []})} className="text-[8px] text-slate-500 font-black">إلغاء</button>
                            </div>
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {jobs.map(j => (
                                <button key={j.id} onClick={() => { 
                                  const current = editReportData.allowedJobs || []; 
                                  if (current.includes(j.title)) { 
                                    setEditReportData({...editReportData, allowedJobs: current.filter(t => t !== j.title)}); 
                                  } else { 
                                    setEditReportData({...editReportData, allowedJobs: [...current, j.title]}); 
                                  } 
                                }} className={`px-1.5 py-0.5 rounded text-[8px] font-black border ${editReportData.allowedJobs?.includes(j.title) ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                                  {j.title}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {acc.allowedJobs.map((j, i) => <span key={i} className="px-2 py-0.5 bg-blue-900/30 text-blue-400 text-[9px] font-black rounded border border-blue-800/30">{j}</span>)}
                          </div>
                        )}
                      </td>
                      <td data-label="الموظفين المسموح بهم" className="py-4 px-2">
                        {editingReportId === acc.id ? (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center px-1">
                              <button onClick={() => setEditReportData({...editReportData, allowedEmployees: allUsers.filter(u => u.role !== 'admin').map(u => u.fullName)})} className="text-[8px] text-green-400 font-black">الكل</button>
                              <button onClick={() => setEditReportData({...editReportData, allowedEmployees: []})} className="text-[8px] text-slate-500 font-black">إلغاء</button>
                            </div>
                            <div className="flex flex-wrap gap-1 max-w-[200px] max-h-32 overflow-y-auto">
                              {allUsers.filter(u => u.role !== 'admin').map(u => (
                                <button key={u.id} onClick={() => { 
                                  const current = editReportData.allowedEmployees || []; 
                                  if (current.includes(u.fullName)) { 
                                    setEditReportData({...editReportData, allowedEmployees: current.filter(t => t !== u.fullName)}); 
                                  } else { 
                                    setEditReportData({...editReportData, allowedEmployees: [...current, u.fullName]}); 
                                  } 
                                }} className={`px-1.5 py-0.5 rounded text-[8px] font-black border ${editReportData.allowedEmployees?.includes(u.fullName) ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                                  {u.fullName}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                            {acc.allowedEmployees && acc.allowedEmployees.length > 0 ? acc.allowedEmployees.map((e, i) => <span key={i} className="px-2 py-0.5 bg-green-900/30 text-green-400 text-[9px] font-black rounded border border-green-800/30">{e}</span>) : <span className="text-[9px] text-slate-600">الكل (حسب الوظيفة)</span>}
                          </div>
                        )}
                      </td>
                      <td data-label="إجراءات" className="py-4 px-2 text-center">
                        <div className="flex justify-center gap-2">
                          {editingReportId === acc.id ? (
                            <>
                              <button onClick={() => saveEditReportAcc(acc.id)} className="text-green-500"><Check size={18}/></button>
                              <button onClick={() => setEditingReportId(null)} className="text-red-500"><X size={18}/></button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingReportId(acc.id); setEditReportData(acc); }} className="text-blue-400 hover:bg-blue-900/20 p-1.5 rounded"><Edit2 size={16}/></button>
                              <button onClick={() => { if(confirm('حذف حساب التقارير؟')) { setReportAccounts?.(reportAccounts.filter(x => x.id !== acc.id)); logAction('حذف حساب تقارير', `المستخدم: ${acc.username}`); } }} className="text-slate-500 hover:text-red-400 p-1.5"><Trash2 size={16}/></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'reports' && (
          <div className="space-y-4 md:space-y-6">
            <div className="bg-slate-900/50 p-3 md:p-4 rounded-2xl border border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet size={20} className="text-emerald-400 shrink-0" />
                <div>
                  <h3 className="text-xs md:text-sm font-black text-white">التقارير المباشرة</h3>
                  <p className="text-[10px] text-slate-400 font-bold">عرض وتصفية وتصدير البيانات من نفس الشاشة</p>
                </div>
              </div>
            </div>
            <div className="pt-2">
              <ReportsView 
                syncUrl={config.syncUrl} 
                adminConfig={config} 
                onUpdateConfig={(cfg) => setConfig(prev => ({ ...prev, ...cfg }))} 
                logAction={logAction} 
                autoLoginAdmin={true}
              />
            </div>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="space-y-4 md:space-y-6">
            <div className="bg-slate-900/50 p-3 md:p-4 rounded-2xl border border-slate-700 flex items-center gap-2.5">
              <Monitor size={18} className="text-blue-400 shrink-0" />
              <h3 className="text-xs md:text-sm font-black text-white uppercase tracking-tighter">إعدادات النظام</h3>
            </div>
            <h4 className="text-sm font-black text-blue-400 flex items-center gap-2 uppercase tracking-widest"><Monitor size={20}/> إعدادات النظام المتقدمة</h4>
            <div className="bg-slate-900/50 p-4 md:p-6 rounded-3xl border border-slate-700 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1">رابط ملف سجل المراقبة (Audit Log Sheet ID)</label>
                <input 
                  type="text" 
                  placeholder="اتركه فارغاً لاستخدام نفس الملف الحالي، أو ضع ID لملف آخر" 
                  className={inputClasses} 
                  value={config.auditLogUrl || ''} 
                  onChange={e => setConfig({...config, auditLogUrl: e.target.value})} 
                />
                <p className="text-[9px] text-slate-500 font-bold italic">ملاحظة: إذا كنت تريد استخدام ملف منفصل، قم بإنشاء ملف Google Sheet جديد وانسخ الـ ID الخاص به وضعه هنا.</p>
              </div>

              <div className="space-y-2 pt-4 border-t border-slate-700">
                <label className="text-xs font-black text-slate-400 flex items-center gap-1.5">
                  <MapPin size={13} /> النطاق الافتراضي حول العميل (بالمتر)
                </label>
                <input
                  type="number"
                  min="10"
                  placeholder="100"
                  className={inputClasses}
                  value={config.defaultCustomerRadius || ''}
                  onChange={e => setConfig({ ...config, defaultCustomerRadius: parseInt(e.target.value) || undefined })}
                />
                <p className="text-[11px] text-slate-500 font-bold leading-relaxed">
                  يُطبَّق على كل عميل تُرك عمود «النطاق» فارغاً عنده. الموظف لا يستطيع فتح زيارة أو إغلاقها خارج هذه المسافة.
                  اضغط «حفظ السحابة» بعد التغيير ليصل الخادم.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-700">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1">اسم مستخدم المسؤول (Admin Username)</label>
                  <input 
                    type="text" 
                    className={inputClasses} 
                    value={config.adminUsername || ''} 
                    onChange={e => setConfig({...config, adminUsername: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1">كلمة مرور المسؤول (Admin Password)</label>
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-400 font-bold leading-relaxed">
                    تواصل مع المسؤل لمعرفة كلمة المرور .
                  </div>
                </div>
              </div>
              
              <div className="pt-4 border-t border-slate-700">
                <button 
                  onClick={() => {
                    const { adminPassword, ...configToSave } = config;
                    localStorage.setItem('attendance_config', JSON.stringify(configToSave));
                    alert('تم حفظ الإعدادات بنجاح');
                    logAction('تحديث إعدادات النظام', 'تغيير إعدادات سجل المراقبة');
                  }} 
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all"
                >
                  <Check size={20} /> حفظ الإعدادات
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
