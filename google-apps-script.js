
/**
 * كود جوجل شيت (Google Apps Script) — Uniteam Cust Follow
 *
 * ⚠️ بعد لصق هذا الإصدار: Deploy ← Manage deployments ← عدّل النشر القائم
 *    (لا New deployment) — وانشره قبل رفع ملفات الموقع.
 *
 * البيانات لا تخرج إلا بمصادقة:
 *   login / getMyData  الموظف (رقم قومي + كلمة مرور + جهاز مربوط) ← بياناته وعملاء توكيله فقط
 *   getAdminData       المسؤول ← البيانات كاملة
 *   getData            أُلغي (كان يُسلّم كل شيء لأي طالب)
 *   registerUser       للمسؤول وحده
 *   updateUserDevice   أُلغي (ربط الجهاز داخل login)
 *
 * - التحقق من وجود الموظف (User Existence Check)
 * - التحقق من وجود الموظف (User Existence Check) - NEW
 * - التحقق من الموقع الجغرافي داخل السيرفر (Server-Side Geo-Validation)
 * - عدم الثقة في بيانات العميل (No Client Trust)
 * - فرض توقيت السيرفر (Server Timestamp)
 * - كشف الانتقال المستحيل (Impossible Travel Detection)
 */

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "لا توجد بيانات مُرسلة (No post data received). تنبيه: لا تقم بتشغيل الدالة doPost يدويًا من محرر Apps Script، بل يتم استدعاؤها تلقائيًا عند إرسال بيانات من التطبيق."
    })).setMimeType(ContentService.MimeType.JSON);
  }
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // ======================================================
  // 1. تحديث النظام (Update System Configuration)
  // ======================================================
  if (data.action === 'updateSystem') {
    // ------------------------------------------------------
    // مصادقة إلزامية قبل أي كتابة.
    // بدونها كان أي شخص يعرف الرابط (وهو مشحون في حزمة JS العلنية)
    // يستطيع استبدال كلمة مرور المسؤول أو مسح شيت الموظفين بطلب واحد.
    // ------------------------------------------------------
    if (!isAdminRequest(ss, data.adminUsername, data.adminPassword)) {
      return ContentService.createTextOutput("Error: Unauthorized. Admin credentials required.");
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);

      // 1. تحديث إعدادات النظام (Config Sheet)
      // يتم التحديث فقط إذا تم إرسال الفروع أو الوظائف أو الإجازات
      if (data.branches || data.jobs || data.customerRadius || (data.adminUsername && data.adminPassword)) {
        var configSheet = getOrCreateSheet(ss, "Config");
        var configData = configSheet.getDataRange().getValues();
        var configMap = {};
        for (var i = 1; i < configData.length; i++) {
          configMap[configData[i][0]] = configData[i][1];
        }

        // تحديث القيم المرسلة فقط والحفاظ على الباقي
        if (data.branches) configMap["branches"] = JSON.stringify(data.branches);
        if (data.jobs) configMap["jobs"] = JSON.stringify(data.jobs);
        if (data.adminUsername) configMap["admin_user"] = data.adminUsername;
        if (data.adminPassword) configMap["admin_pass"] = data.adminPassword;
        if (data.customerRadius && !isNaN(parseInt(data.customerRadius))) {
          configMap["customer_radius"] = parseInt(data.customerRadius);
        }

        configSheet.clear();
        configSheet.appendRow(["Key", "Value"]);
        for (var key in configMap) {
          configSheet.appendRow([key, configMap[key]]);
        }
      }
      
      // 2. تحديث حسابات التقارير
      if (data.reportAccounts) {
        var reportAccSheet = getOrCreateSheet(ss, "ReportAccounts");
        reportAccSheet.clear();
        reportAccSheet.appendRow(["ID", "Username", "Password", "Allowed Jobs", "Allowed Employees"]);
        data.reportAccounts.forEach(function(acc) {
          reportAccSheet.appendRow([
            acc.id, 
            acc.username, 
            acc.password, 
            JSON.stringify(acc.allowedJobs || []),
            JSON.stringify(acc.allowedEmployees || [])
          ]);
        });
      }

      // 3. تحديث الموظفين
      if (data.users) {
        var userSheet = getOrCreateSheet(ss, "Users");

        // موظف بلا رقم تسلسلي (مستورَد من Excel مثلاً) يأخذ رقماً هنا.
        // الرقم يميّز صاحب الزيارة المفتوحة، وخلوّه كان يجعل كل الموظفين
        // بلا رقم «شخصاً واحداً» في فحص الزيارة المفتوحة.
        var serialSource = userSheet.getDataRange().getValues();
        var takenSerials = {};
        data.users.forEach(function(u) {
          var s = u.serialNumber ? u.serialNumber.toString().trim() : "";
          if (s !== "") takenSerials[s] = true;
        });
        data.users.forEach(function(u) {
          var s = u.serialNumber ? u.serialNumber.toString().trim() : "";
          if (s === "") {
            u.serialNumber = nextSerialNumber(serialSource, takenSerials);
            takenSerials[u.serialNumber] = true;
          }
        });

        // قبل المسح: نحتفظ بآخر موقع وآخر تحديث لكل موظف بمفتاح الرقم القومي.
        // هذان العمودان يكتبهما الخادم وحده عند التسجيل ولا يعرفهما التطبيق،
        // فتصفيرهما كان يمسح ذاكرة «كشف الانتقال المستحيل» عند كل مزامنة.
        var previousState = {};
        var oldRows = userSheet.getDataRange().getValues();
        for (var pr = 1; pr < oldRows.length; pr++) {
          var oldNid = oldRows[pr][2] ? oldRows[pr][2].toString().trim() : "";
          if (oldNid) {
            previousState[oldNid] = {
              lastUpdate: oldRows[pr][9] || "",
              lastGPS: oldRows[pr][13] || ""
            };
          }
        }

        userSheet.clear();
        userSheet.appendRow(["ID", "Full Name", "National ID", "Serial Number", "Job Title", "Device ID", "Password", "Agency", "Reg Date", "Last Update", "Reserved1", "Reserved2", "AllowedDeviceCount", "LastGPS"]);
        data.users.forEach(function(u) {
          var deviceStorage = "";
          if (u.deviceIds && Array.isArray(u.deviceIds)) {
            deviceStorage = JSON.stringify(u.deviceIds);
          } else if (u.deviceId) {
            deviceStorage = u.deviceId.toString();
          }

          var nidKey = u.nationalId ? u.nationalId.toString().trim() : "";
          var prev = previousState[nidKey] || { lastUpdate: "", lastGPS: "" };

          userSheet.appendRow([
            u.id ? u.id.toString() : "",
            u.fullName ? u.fullName.toString() : "",
            u.nationalId ? u.nationalId.toString() : "",
            u.serialNumber ? u.serialNumber.toString() : "",
            u.jobTitle ? u.jobTitle.toString() : "",
            deviceStorage,
            u.password ? u.password.toString() : "",
            u.defaultBranchId ? u.defaultBranchId.toString() : "",
            u.registrationDate ? u.registrationDate : new Date(),
            prev.lastUpdate || new Date(),
            // عمودان محجوزان — يُبقيان بقية الأعمدة في مواضعها المتوقّعة
            "",
            "",
            u.allowedDeviceCount || 1,
            prev.lastGPS
          ]);
        });
      }

      // 4. تحديث العملاء
      //
      // المسح ثم الكتابة كما في بقية الأقسام — لوحة الإدارة ترسل القائمة
      // كاملةً دائماً، ولا يكتب التطبيق في هذه الصفحة إلا من هنا.
      if (data.customers) {
        var custSheet = getOrCreateSheet(ss, "Customers");
        custSheet.clear();
        custSheet.appendRow([
          "كود العميل", "اسم العميل", "كود المندوب", "اسم المندوب",
          "كود التوكيل", "اسم التوكيل",
          "إجمالي المديونية", "المديونية الأوفر ديو",
          "خط العرض", "خط الطول", "النطاق"
        ]);
        data.customers.forEach(function (c) {
          custSheet.appendRow([
            c.code ? c.code.toString() : "",
            c.name ? c.name.toString() : "",
            c.repCode ? c.repCode.toString() : "",
            c.repName ? c.repName.toString() : "",
            c.agencyCode ? c.agencyCode.toString() : "",
            c.agencyName ? c.agencyName.toString() : "",
            isNaN(parseFloat(c.totalDebt)) ? 0 : parseFloat(c.totalDebt),
            isNaN(parseFloat(c.overdueDebt)) ? 0 : parseFloat(c.overdueDebt),
            isNaN(parseFloat(c.latitude)) ? 0 : parseFloat(c.latitude),
            isNaN(parseFloat(c.longitude)) ? 0 : parseFloat(c.longitude),
            (c.radius && !isNaN(parseInt(c.radius))) ? parseInt(c.radius) : ""
          ]);
        });
      }

      // 5. أسباب تجاوز فترة الائتمان
      if (data.visitReasons) {
        var vrSheet = getOrCreateSheet(ss, "VisitReasons");
        vrSheet.clear();
        vrSheet.appendRow(["السبب"]);
        data.visitReasons.forEach(function (r) {
          var txt = r && r.text ? r.text.toString().trim() : "";
          if (txt !== "") vrSheet.appendRow([txt]);
        });
      }

      return ContentService.createTextOutput("System Updated Successfully");

    } catch (e) {
      return ContentService.createTextOutput("Error: Server Busy or Update Failed");
    } finally {
      lock.releaseLock();
    }
  }

  // ======================================================
  // 2.ب فتح زيارة عميل (Start Visit)
  // ======================================================
  // يُكتب الصفّ فور الفتح لا عند الإغلاق: فلو انطفأ هاتف الموظف أو
  // ضاع، يبقى على الشيت دليل أنه كان عند العميل وفي أي وقت.
  if (data.action === 'startVisit') {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);

      var check = validateVisitRequest(ss, data);
      if (check.error) return ContentService.createTextOutput(check.error);

      var visitSheet = getOrCreateSheet(ss, "Visits");
      var visitRows = visitSheet.getDataRange().getValues();

      // ---- فحص التكرار ----
      // إلغاء الطلب من الهاتف لا يُلغي عمل الخادم: قد يكون الصفّ كُتب
      // ثم انقطع الردّ، فيعيد التطبيق الإرسال بنفس المعرّف. لو لم نفحص
      // هنا لظهرت «لديك زيارة مفتوحة بالفعل» في وجه الموظف على زيارته هو،
      // أو لتكرّر الصفّ. المعرّف يميّز الطلب، فإعادته ليست طلباً جديداً.
      var incomingId = data.visitId ? data.visitId.toString().trim() : "";
      if (incomingId !== "") {
        for (var dup = 1; dup < visitRows.length; dup++) {
          if (visitRows[dup][1] && visitRows[dup][1].toString().trim() === incomingId) {
            return ContentService.createTextOutput("Visit Started");
          }
        }
      }

      // زيارة مفتوحة واحدة في المرة. بدون هذا الفحص يستطيع الموظف
      // فتح زيارات عند عدة عملاء ويتركها كلها معلّقة.
      for (var v = 1; v < visitRows.length; v++) {
        var rowStatus = visitRows[v][23] ? visitRows[v][23].toString().trim() : "";
        var rowSerial = visitRows[v][3] ? visitRows[v][3].toString().trim() : "";
        if (rowStatus === "open" && rowSerial === check.serialNumber) {
          return ContentService.createTextOutput(
            "Error: لديك زيارة مفتوحة بالفعل عند " + (visitRows[v][8] || "عميل آخر") +
            ". أغلقها أو ألغِها أولاً قبل فتح زيارة جديدة."
          );
        }
      }

      var startNow = new Date();
      var cust = check.customer;

      visitSheet.appendRow([
        startNow,                                   // 1  تاريخ السجل
        data.visitId ? data.visitId.toString() : "",// 2  معرّف الزيارة
        check.userName,                             // 3  اسم الموظف
        check.serialNumber,                         // 4  الرقم التسلسلي
        check.jobTitle,                             // 5  الوظيفة
        cust.agencyCode,                            // 6  كود التوكيل
        cust.agencyName,                            // 7  اسم التوكيل
        cust.code,                                  // 8  كود العميل
        cust.name,                                  // 9  اسم العميل
        cust.repCode,                               // 10 كود المندوب
        cust.repName,                               // 11 اسم المندوب
        startNow.toISOString(),                     // 12 وقت الفتح
        check.lat + "," + check.lng,                // 13 إحداثيات الفتح
        "",                                         // 14 وقت الإغلاق
        "",                                         // 15 إحداثيات الإغلاق
        "",                                         // 16 مدة الزيارة
        "",                                         // 17 سبب التجاوز
        "",                                         // 18 المديونية الفعلية
        "",                                         // 19 أيام التجاوز
        "",                                         // 20 موعد السداد
        "",                                         // 21 ملاحظات الموظف
        cust.totalDebt,                             // 22 إجمالي المديونية وقت الزيارة
        cust.overdueDebt,                           // 23 الأوفر ديو وقت الزيارة
        "open"                                      // 24 الحالة
      ]);

      userSheetTouch(ss, check.userRowIndex, startNow, check.lat, check.lng);

      return ContentService.createTextOutput("Visit Started");

    } catch (e) {
      return ContentService.createTextOutput("Error: Server processing failed. " + e.message);
    } finally {
      lock.releaseLock();
    }
  }

  // ======================================================
  // 2.ج إغلاق زيارة عميل (Close Visit)
  // ======================================================
  // يُعاد فحص الموقع هنا أيضاً: الفتح عند العميل لا يعني أن الإغلاق عنده.
  if (data.action === 'closeVisit') {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);

      var check = validateVisitRequest(ss, data);
      if (check.error) return ContentService.createTextOutput(check.error);

      var visitId = data.visitId ? data.visitId.toString().trim() : "";
      if (visitId === "") {
        return ContentService.createTextOutput("Error: معرّف الزيارة مفقود.");
      }

      var visitSheet = getOrCreateSheet(ss, "Visits");
      var visitRows = visitSheet.getDataRange().getValues();
      var targetRow = -1;

      for (var r = 1; r < visitRows.length; r++) {
        if (visitRows[r][1] && visitRows[r][1].toString().trim() === visitId) {
          targetRow = r + 1; // 1-based
          break;
        }
      }

      if (targetRow === -1) {
        return ContentService.createTextOutput("Error: لم يُعثر على هذه الزيارة على الخادم.");
      }

      var rowData = visitRows[targetRow - 1];

      // الزيارة تُغلق بيد صاحبها وحده
      var ownerSerial = rowData[3] ? rowData[3].toString().trim() : "";
      if (ownerSerial !== check.serialNumber) {
        return ContentService.createTextOutput("Security Alert: هذه الزيارة ليست باسمك.");
      }

      var currentStatus = rowData[23] ? rowData[23].toString().trim() : "";

      // مغلقة بالفعل = إعادة إرسال لنفس الأمر بعد انقطاع الردّ، لا خطأ.
      // الإغلاق انتقال يحدث مرة واحدة، فتكراره بنفس المعرّف لا يعني شيئاً
      // سوى أن الطلب الأول وصل. نُعيد النجاح لا الخطأ.
      if (currentStatus === "closed")    return ContentService.createTextOutput("Visit Closed");
      if (currentStatus === "cancelled") return ContentService.createTextOutput("Error: هذه الزيارة ملغاة.");

      // الأسئلة إلزامية — الواجهة تمنع الإرسال بدونها، والخادم لا يثق بها
      var reason = data.overdueReason ? data.overdueReason.toString().trim() : "";
      var paymentDate = data.paymentDate ? data.paymentDate.toString().trim() : "";
      if (reason === "" || paymentDate === "") {
        return ContentService.createTextOutput("Error: يجب الإجابة على جميع الأسئلة قبل إغلاق الزيارة.");
      }

      var endNow = new Date();
      var startMs = rowData[11] ? new Date(rowData[11]).getTime() : endNow.getTime();
      var durationMin = Math.max(0, Math.round((endNow.getTime() - startMs) / 60000));

      visitSheet.getRange(targetRow, 14).setValue(endNow.toISOString());
      visitSheet.getRange(targetRow, 15).setValue(check.lat + "," + check.lng);
      visitSheet.getRange(targetRow, 16).setValue(durationMin);
      visitSheet.getRange(targetRow, 17).setValue(reason);
      visitSheet.getRange(targetRow, 18).setValue(data.actualDebt !== undefined ? data.actualDebt : "");
      visitSheet.getRange(targetRow, 19).setValue(data.overdueDays !== undefined ? data.overdueDays : "");
      visitSheet.getRange(targetRow, 20).setValue(paymentDate);
      visitSheet.getRange(targetRow, 21).setValue(data.comment ? data.comment.toString().trim() : "");
      visitSheet.getRange(targetRow, 24).setValue("closed");

      userSheetTouch(ss, check.userRowIndex, endNow, check.lat, check.lng);

      return ContentService.createTextOutput("Visit Closed");

    } catch (e) {
      return ContentService.createTextOutput("Error: Server processing failed. " + e.message);
    } finally {
      lock.releaseLock();
    }
  }

  // ======================================================
  // 2.د إلغاء زيارة (Cancel Visit)
  // ======================================================
  // الصفّ يبقى ويُعلَّم cancelled: تكرار الفتح والإلغاء عند عميل بعينه
  // مؤشّر لا يظهر إطلاقاً لو مُحي الصفّ.
  //
  // فحص الموقع مطلوب هنا أيضاً — بدونه يصير الإلغاء مهرباً من فحص النطاق:
  // يفتح الزيارة عند العميل ثم يمشي ويلغيها من أي مكان.
  if (data.action === 'cancelVisit') {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);

      var check = validateVisitRequest(ss, data);
      if (check.error) return ContentService.createTextOutput(check.error);

      var visitId = data.visitId ? data.visitId.toString().trim() : "";
      if (visitId === "") {
        return ContentService.createTextOutput("Error: معرّف الزيارة مفقود.");
      }

      var visitSheet = getOrCreateSheet(ss, "Visits");
      var visitRows = visitSheet.getDataRange().getValues();
      var targetRow = -1;

      for (var cr = 1; cr < visitRows.length; cr++) {
        if (visitRows[cr][1] && visitRows[cr][1].toString().trim() === visitId) {
          targetRow = cr + 1;
          break;
        }
      }

      if (targetRow === -1) {
        return ContentService.createTextOutput("Error: لم يُعثر على هذه الزيارة على الخادم.");
      }

      var cRow = visitRows[targetRow - 1];

      var cOwner = cRow[3] ? cRow[3].toString().trim() : "";
      if (cOwner !== check.serialNumber) {
        return ContentService.createTextOutput("Security Alert: هذه الزيارة ليست باسمك.");
      }

      var cStatus = cRow[23] ? cRow[23].toString().trim() : "";
      if (cStatus === "closed")    return ContentService.createTextOutput("Error: هذه الزيارة مغلقة ولا يمكن إلغاؤها.");
      // ملغاة بالفعل = إعادة إرسال لنفس الأمر، لا خطأ (انظر closeVisit)
      if (cStatus === "cancelled") return ContentService.createTextOutput("Visit Cancelled");

      var cancelNow = new Date();
      var cStartMs = cRow[11] ? new Date(cRow[11]).getTime() : cancelNow.getTime();

      visitSheet.getRange(targetRow, 14).setValue(cancelNow.toISOString());
      visitSheet.getRange(targetRow, 15).setValue(check.lat + "," + check.lng);
      visitSheet.getRange(targetRow, 16).setValue(Math.max(0, Math.round((cancelNow.getTime() - cStartMs) / 60000)));
      visitSheet.getRange(targetRow, 21).setValue(data.comment ? data.comment.toString().trim() : "");
      visitSheet.getRange(targetRow, 24).setValue("cancelled");

      userSheetTouch(ss, check.userRowIndex, cancelNow, check.lat, check.lng);

      return ContentService.createTextOutput("Visit Cancelled");

    } catch (e) {
      return ContentService.createTextOutput("Error: Server processing failed. " + e.message);
    } finally {
      lock.releaseLock();
    }
  }

  // ======================================================
  // 2.هـ دخول الموظف (Login) — التحقق وربط الجهاز في الخادم
  // ======================================================
  // كان التطبيق ينزّل قائمة الموظفين كلها بكلمات مرورها وأجهزتها ثم يتحقّق
  // على الهاتف. الآن يرسل الموظف بياناته فقط، والخادم يتحقّق ويربط الجهاز
  // ويُعيد له بياناته هو وعملاء توكيله وحدهم.
  //
  // آمن للإعادة: لو انقطع الردّ بعد ربط الجهاز، فالمحاولة الثانية تجد
  // الجهاز مربوطاً فتنجح دون أن تستهلك خانة جهاز ثانية.
  if (data.action === 'login') {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);

      var sheet = getOrCreateSheet(ss, "Users");
      var rows = sheet.getDataRange().getValues();

      var nid = data.nationalId ? data.nationalId.toString().trim() : "";
      var pass = data.password ? data.password.toString().trim() : "";
      var device = data.deviceId ? data.deviceId.toString().trim() : "";

      if (nid === "" || pass === "") {
        return jsonOut({ status: "error", code: "BAD_CREDENTIALS",
          message: "أدخل الرقم القومي وكلمة المرور." });
      }
      if (device === "") {
        return jsonOut({ status: "error", code: "NO_DEVICE",
          message: "تعذّر قراءة معرّف هذا الجهاز. أعد فتح التطبيق وحاول مجدداً." });
      }

      var idx = findUserRowIndex(rows, nid);
      var storedPass = idx === -1 ? "" : (rows[idx][6] !== null && rows[idx][6] !== undefined ? rows[idx][6].toString().trim() : "");
      // رسالة واحدة للحالتين حتى لا يُكشف أي رقم قومي مسجَّل
      if (idx === -1 || storedPass === "" || storedPass !== pass) {
        return jsonOut({ status: "error", code: "BAD_CREDENTIALS",
          message: "بيانات الدخول غير صحيحة، تأكد من الرقم القومي وكلمة المرور." });
      }

      // جهاز واحد = موظف واحد
      for (var o = 1; o < rows.length; o++) {
        if (o === idx) continue;
        if (parseDeviceIds(rows[o][5]).indexOf(device) !== -1) {
          return jsonOut({ status: "error", code: "DEVICE_TAKEN",
            message: "عذراً، هذا الهاتف مسجل باسم موظف آخر (" + (rows[o][1] || "") + ")." });
        }
      }

      var devices = parseDeviceIds(rows[idx][5]);
      var maxDevices = (rows[idx][12] && !isNaN(rows[idx][12])) ? parseInt(rows[idx][12]) : 1;
      var linkedNow = false;

      if (devices.indexOf(device) === -1) {
        if (devices.length >= maxDevices) {
          return jsonOut({ status: "error", code: "DEVICE_LIMIT",
            message: "عذراً، لقد تجاوزت الحد المسموح من الأجهزة (" + devices.length + "/" + maxDevices +
                     "). يرجى التواصل مع المسؤول." });
        }
        devices.push(device);
        sheet.getRange(idx + 1, 6).setValue(JSON.stringify(devices));
        rows[idx][5] = JSON.stringify(devices);
        linkedNow = true;
      }

      ensureSerialNumber(sheet, rows, idx);

      var payload = buildEmployeePayload(ss, rows[idx]);
      payload.linkedNow = linkedNow;
      return jsonOut(payload);

    } catch (e) {
      return jsonOut({ status: "error", code: "SERVER", message: "الخادم مشغول. حاول مجدداً بعد لحظات." });
    } finally {
      lock.releaseLock();
    }
  }

  // ======================================================
  // 2.و بيانات الموظف (Get My Data) — بديل getData للموظف
  // ======================================================
  // لا تُسلَّم البيانات إلا لموظف كلمة مروره صحيحة **وجهازه مربوط** بحسابه.
  // فمن عرف كلمة مرور غيره لا يقرأ بها من هاتف آخر دون أن يستهلك خانة جهاز
  // عبر login — وهذا يظهر للمسؤول في عدّاد الأجهزة.
  if (data.action === 'getMyData') {
    try {
      var auth = authenticateEmployee(ss, data);
      if (auth.error) return jsonOut(auth.error);

      if (!auth.rows[auth.idx][3] || auth.rows[auth.idx][3].toString().trim() === "") {
        // حساب قديم بلا رقم تسلسلي — يُكمَّل مرة واحدة تحت القفل
        var serialLock = LockService.getScriptLock();
        try {
          serialLock.waitLock(10000);
          var fresh = getOrCreateSheet(ss, "Users").getDataRange().getValues();
          var fIdx = findUserRowIndex(fresh, auth.nid);
          if (fIdx !== -1) {
            ensureSerialNumber(auth.sheet, fresh, fIdx);
            auth.rows = fresh; auth.idx = fIdx;
          }
        } finally {
          serialLock.releaseLock();
        }
      }

      return jsonOut(buildEmployeePayload(ss, auth.rows[auth.idx]));
    } catch (e) {
      return jsonOut({ status: "error", code: "SERVER", message: "الخادم مشغول. حاول مجدداً بعد لحظات." });
    }
  }

  // ======================================================
  // 2.ز بيانات لوحة الإدارة (Get Admin Data)
  // ======================================================
  // البيانات الكاملة — الموظفون بكلمات مرورهم وأجهزتهم وكل العملاء — لا تخرج
  // إلا بمصادقة المسؤول. لوحة الإدارة تحتاجها كاملة لأن «حفظ السحابة»
  // يُعيد كتابة شيت الموظفين من القائمة التي بيدها.
  if (data.action === 'getAdminData') {
    if (!isAdminRequest(ss, data.adminUsername, data.adminPassword)) {
      return jsonOut({ status: "error", code: "UNAUTHORIZED",
        message: "بيانات دخول المسؤول غير صحيحة." });
    }
    try {
      return jsonOut(buildAdminPayload(ss));
    } catch (e) {
      return jsonOut({ status: "error", code: "SERVER", message: "تعذّرت قراءة البيانات: " + e.message });
    }
  }

  // ======================================================
  // 3. تسجيل موظف جديد (Register User) — للمسؤول وحده
  // ======================================================
  // كان أي شخص يستطيع إنشاء حساب واختيار أي توكيل فيرى عملاءه ومديونياتهم.
  // الآن يُنشئ المسؤول الحسابات فقط، ويُربط هاتف الموظف عند أول دخول له.
  if (data.action === 'registerUser') {
    if (!isAdminRequest(ss, data.adminUsername, data.adminPassword)) {
      return ContentService.createTextOutput("Error: Unauthorized. إنشاء الحسابات متاح للمسؤول فقط.");
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      var sheet = getOrCreateSheet(ss, "Users");
      var rows = sheet.getDataRange().getValues();
      var nationalIdStr = data.nationalId ? data.nationalId.toString().trim() : "";
      var fullNameStr = data.fullName ? data.fullName.toString().trim() : "";

      if (nationalIdStr === "" || fullNameStr === "") {
        return ContentService.createTextOutput("Error: الاسم والرقم القومي مطلوبان.");
      }
      var regPwError = validateNewPassword(data.password);
      if (regPwError !== "") return ContentService.createTextOutput(regPwError);

      if (findUserRowIndex(rows, nationalIdStr) !== -1) {
        return ContentService.createTextOutput("Error: National ID Already Registered");
      }

      var newSerialNumber = nextSerialNumber(rows, {});

      var now = new Date();
      sheet.appendRow([
        data.id ? data.id.toString() : Utilities.getUuid(),
        fullNameStr,
        nationalIdStr,
        newSerialNumber,
        data.jobTitle ? data.jobTitle.toString() : "",
        "",   // لا جهاز — يُربط هاتف الموظف عند أول دخول له
        data.password.toString().trim(),
        data.defaultBranchId ? data.defaultBranchId.toString() : "",
        now,
        now,
        "",
        "",
        (data.allowedDeviceCount && !isNaN(data.allowedDeviceCount)) ? parseInt(data.allowedDeviceCount) : 1,
        "" // LastGPS
      ]);

      return ContentService.createTextOutput("User Registered Successfully|" + newSerialNumber);

    } catch (e) {
      return ContentService.createTextOutput("Error: Server Busy, try again");
    } finally {
      lock.releaseLock();
    }
  }

  // ======================================================
  // 4. استعادة كلمة المرور — الطبقة أ: بيد المسؤول
  // ======================================================
  // إجراء ضيّق عمداً: يكتب عمود كلمة المرور وحده ولا يمرّ بـ updateSystem،
  // فلا يمسّ بقية الصفوف ولا يحذف موظفاً سجّل بعد آخر مزامنة للمسؤول.
  if (data.action === 'resetUserPassword') {
    if (!isAdminRequest(ss, data.adminUsername, data.adminPassword)) {
      return ContentService.createTextOutput("Error: Unauthorized. Admin credentials required.");
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      var pwError = validateNewPassword(data.newPassword);
      if (pwError !== "") return ContentService.createTextOutput(pwError);

      var sheet = getOrCreateSheet(ss, "Users");
      var rows = sheet.getDataRange().getValues();
      var nid = data.nationalId ? data.nationalId.toString().trim() : "";
      var uid = data.userId ? data.userId.toString().trim() : "";

      for (var i = 1; i < rows.length; i++) {
        var rowNid = rows[i][2] ? rows[i][2].toString().trim() : "";
        var rowUid = rows[i][0] ? rows[i][0].toString().trim() : "";
        if ((nid && rowNid === nid) || (uid && rowUid === uid)) {
          sheet.getRange(i + 1, 7).setValue(data.newPassword.toString());
          logPasswordReset(ss, rows[i][1], "إعادة تعيين بيد المسؤول",
                           "المسؤول: " + (data.adminUsername || ""));
          return ContentService.createTextOutput("Password Reset Successfully");
        }
      }
      return ContentService.createTextOutput("Error: User Not Found");

    } catch (e) {
      return ContentService.createTextOutput("Error: Server Busy, try again");
    } finally {
      lock.releaseLock();
    }
  }

  // ======================================================
  // 5. استعادة كلمة المرور — الطبقة ب: ذاتية بالجهاز المربوط
  // ======================================================
  // عاملان مجتمعان: الرقم القومي + جهاز مسجَّل مسبقاً لهذا الرقم بالذات.
  //
  // أُسقط شرط الرقم التسلسلي عمداً: يولّده الخادم ولا يراه الموظف إلا داخل
  // شاشته بعد الدخول، فمن نسي كلمة مروره لا يستطيع قراءته أصلاً — كان
  // الشرط يُبطل هذا المسار كلّه. ولا يضيف أماناً يُذكر: من يملك الهاتف
  // المربوط يفتح التطبيق بالجلسة المحفوظة ويقرأ الرقم من الشاشة.
  //
  // الحماية الفعلية هي الجهاز: لا تُقبل الاستعادة إلا من هاتف سبق ربطه.
  if (data.action === 'resetPasswordSelf') {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      var sheet = getOrCreateSheet(ss, "Users");
      var rows = sheet.getDataRange().getValues();

      var nid = data.nationalId ? data.nationalId.toString().trim() : "";
      var device = data.deviceId ? data.deviceId.toString().trim() : "";

      if (nid === "" || device === "") {
        return ContentService.createTextOutput("Error: بيانات ناقصة. يلزم الرقم القومي.");
      }

      for (var i = 1; i < rows.length; i++) {
        var rowNid = rows[i][2] ? rows[i][2].toString().trim() : "";
        if (rowNid !== nid) continue;

        // ١) الجهاز المربوط
        var allowed = parseDeviceIds(rows[i][5]);
        if (allowed.indexOf(device) === -1) {
          logPasswordReset(ss, rows[i][1], "فشل استعادة ذاتية", "جهاز غير مسجّل");
          return ContentService.createTextOutput(
            "Error: هذا الجهاز غير مسجّل لحسابك. راجع المسؤول لإعادة تعيين كلمة المرور."
          );
        }

        // ٢) الخطوة الأولى تتحقّق فقط ولا تكتب شيئاً
        if (!data.newPassword) {
          return ContentService.createTextOutput("Verified: " + (rows[i][1] || ""));
        }

        var selfPwError = validateNewPassword(data.newPassword);
        if (selfPwError !== "") return ContentService.createTextOutput(selfPwError);

        sheet.getRange(i + 1, 7).setValue(data.newPassword.toString());
        logPasswordReset(ss, rows[i][1], "استعادة ذاتية بالجهاز المربوط", "الجهاز: " + device);
        return ContentService.createTextOutput("Password Reset Successfully");
      }

      // رسالة واحدة لكل حالات عدم التطابق حتى لا تكشف أي رقم قومي مسجَّل
      return ContentService.createTextOutput("Error: البيانات غير صحيحة. راجع المسؤول.");

    } catch (e) {
      return ContentService.createTextOutput("Error: Server Busy, try again");
    } finally {
      lock.releaseLock();
    }
  }

  // updateUserDevice أُلغي عمداً.
  // كان يكتب قائمة أجهزة أي موظف بلا أي مصادقة — يكفي معرفة رقمه القومي
  // لاستبدال أجهزته بجهاز آخر. ربط الجهاز صار داخل login بعد التحقق من
  // كلمة المرور، وفكّ الربط بيد المسؤول من لوحة الإدارة.
  if (data.action === 'updateUserDevice') {
    return ContentService.createTextOutput("Error: هذا الإجراء أُلغي. حدّث التطبيق ثم سجّل الدخول من جديد.");
  }

  if (data.action === 'logAudit') {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      var targetSS = ss;
      if (data.spreadsheetId && data.spreadsheetId !== "") {
        try {
          targetSS = SpreadsheetApp.openById(data.spreadsheetId);
        } catch(e) {
          // Fallback to current if ID is invalid
        }
      }
      var auditSheet = getOrCreateSheet(targetSS, "AuditLog");
      auditSheet.appendRow([
        new Date(),
        data.user || "Unknown",
        data.auditAction || "Unknown",
        data.details || "",
        data.deviceInfo || ""
      ]);
      return ContentService.createTextOutput("Audit Logged");
    } catch (e) {
      return ContentService.createTextOutput("Error Logging Audit: " + e.message);
    } finally {
      lock.releaseLock();
    }
  }

  // إجراء غير معروف: ردّ صريح بدل ردّ فارغ يفسّره التطبيق كـ«كود سيرفر قديم»
  return ContentService.createTextOutput("Error: Unknown action '" + (data.action || "") + "'.");
}

/**
 * التحقق من أن الطلب صادر عن المسؤول.
 * يقرأ admin_user/admin_pass من شيت Config.
 * ملاحظة: إن لم تكن مضبوطة بعد (شيت جديد) يُسمح بالطلب الأول لتهيئتها،
 * وإلا تعذّر ضبط النظام من الصفر.
 */
/**
 * قواعد كلمة المرور — مطابقة لما يفرضه التطبيق في Login.tsx:78,84
 * حتى لا تُقبل من الخادم كلمة يرفضها التطبيق عند الدخول.
 * تُرجع رسالة الخطأ، أو "" إن كانت سليمة.
 */
function validateNewPassword(pw) {
  var p = pw ? pw.toString() : "";
  if (p.length < 6) return "Error: كلمة المرور يجب ألا تقل عن ٦ خانات.";
  if (p.charAt(0) === "0") return "Error: كلمة المرور لا يمكن أن تبدأ بصفر.";
  return "";
}

/**
 * قراءة قائمة الأجهزة المسموحة من خانة واحدة.
 * الخانة تحمل إما مصفوفة JSON (الصيغة الحالية) أو معرّفاً واحداً (صيغة قديمة).
 */
function parseDeviceIds(cell) {
  var raw = cell ? cell.toString().trim() : "";
  if (raw === "") return [];
  if (raw.charAt(0) === "[" && raw.charAt(raw.length - 1) === "]") {
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [raw];
    } catch (e) {
      return [raw];
    }
  }
  return [raw];
}

/**
 * تسجيل كل محاولة استعادة — ناجحة أو فاشلة — في AuditLog.
 * إعادة تعيين كلمة مرور حدث حسّاس يجب أن يترك أثراً يُراجَع.
 */
function logPasswordReset(ss, userName, action, details) {
  try {
    var auditSheet = getOrCreateSheet(ss, "AuditLog");
    auditSheet.appendRow([
      new Date(),
      userName ? userName.toString() : "غير معروف",
      action,
      details || "",
      "استعادة كلمة المرور"
    ]);
  } catch (e) {
    // فشل التسجيل لا يُبطل العملية نفسها
  }
}

function isAdminRequest(ss, username, password) {
  var configSheet = getOrCreateSheet(ss, "Config");
  var rows = configSheet.getDataRange().getValues();
  var adminUser = "", adminPass = "";
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === "admin_user") adminUser = rows[i][1] ? rows[i][1].toString() : "";
    if (rows[i][0] === "admin_pass") adminPass = rows[i][1] ? rows[i][1].toString() : "";
  }

  // تهيئة أولى: لا مسؤول مضبوط بعد
  if (adminUser === "" && adminPass === "") return true;

  var u = username ? username.toString() : "";
  var p = password ? password.toString() : "";
  return u === adminUser && p === adminPass;
}

// ======================================================
// المصادقة وبناء ردود البيانات
// ======================================================

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** فهرس صفّ الموظف (0 = العناوين) بالرقم القومي، أو -1 */
function findUserRowIndex(rows, nid) {
  var target = nid ? nid.toString().trim() : "";
  if (target === "") return -1;
  for (var i = 1; i < rows.length; i++) {
    var rowNid = rows[i][2] !== null && rows[i][2] !== undefined ? rows[i][2].toString().trim() : "";
    if (rowNid === target) return i;
  }
  return -1;
}

/**
 * الرقم التسلسلي التالي: السنة الحالية + (أكبر تسلسل مستعمل فيها + ١).
 * نفس الصيغة التي كان registerUser يولّدها. taken أرقام محجوزة لم تُكتب بعد.
 */
function nextSerialNumber(rows, taken) {
  var year = new Date().getFullYear().toString();
  var maxSeq = 0;
  var consider = function(sn) {
    sn = sn ? sn.toString().trim() : "";
    if (sn.indexOf(year) !== 0) return;
    var n = parseInt(sn.substring(year.length));
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  };
  for (var i = 1; i < rows.length; i++) consider(rows[i][3]);
  for (var k in (taken || {})) consider(k);
  return year + (maxSeq + 1);
}

/** يكتب رقماً تسلسلياً لصفّ خالٍ منه. يُستدعى تحت القفل. */
function ensureSerialNumber(sheet, rows, idx) {
  var current = rows[idx][3] ? rows[idx][3].toString().trim() : "";
  if (current !== "") return current;
  var sn = nextSerialNumber(rows, {});
  sheet.getRange(idx + 1, 4).setValue(sn);
  rows[idx][3] = sn;
  return sn;
}

/**
 * التحقق من موظف لطلب قراءة: الرقم القومي + كلمة المرور + جهاز مربوط.
 * @returns {error} ردّ جاهز عند الرفض، أو {sheet, rows, idx, nid}
 */
function authenticateEmployee(ss, data) {
  var sheet = getOrCreateSheet(ss, "Users");
  var rows = sheet.getDataRange().getValues();
  var nid = data.nationalId ? data.nationalId.toString().trim() : "";
  var pass = data.password ? data.password.toString().trim() : "";
  var device = data.deviceId ? data.deviceId.toString().trim() : "";

  var idx = findUserRowIndex(rows, nid);
  var storedPass = idx === -1 ? "" : (rows[idx][6] !== null && rows[idx][6] !== undefined ? rows[idx][6].toString().trim() : "");
  if (idx === -1 || pass === "" || storedPass !== pass) {
    return { error: { status: "error", code: "AUTH_FAILED",
      message: "انتهت صلاحية الدخول: الحساب غير موجود أو تغيّرت كلمة المرور. سجّل الدخول من جديد." } };
  }
  if (device === "" || parseDeviceIds(rows[idx][5]).indexOf(device) === -1) {
    return { error: { status: "error", code: "DEVICE_NOT_LINKED",
      message: "هذا الجهاز لم يعد مربوطاً بحسابك. سجّل الدخول من جديد لربطه." } };
  }
  return { sheet: sheet, rows: rows, idx: idx, nid: nid };
}

/** صفّ شيت Users ← كائن موظف بالشكل الذي يفهمه التطبيق */
function userRowToObject(row) {
  var deviceIds = parseDeviceIds(row[5]);
  return {
    id: row[0] !== null && row[0] !== undefined ? row[0].toString() : "",
    fullName: row[1] ? row[1].toString() : "",
    nationalId: row[2] !== null && row[2] !== undefined ? row[2].toString() : "",
    serialNumber: row[3] ? row[3].toString() : "",
    jobTitle: row[4] ? row[4].toString() : "",
    deviceId: deviceIds.length > 0 ? deviceIds[0] : "",
    deviceIds: deviceIds,
    password: row[6] !== null && row[6] !== undefined ? row[6].toString() : "",
    defaultBranchId: row[7] ? row[7].toString() : "",
    registrationDate: row[8] ? row[8].toString() : "",
    allowedDeviceCount: (row[12] && !isNaN(row[12])) ? parseInt(row[12]) : 1,
    role: 'employee'
  };
}

/**
 * هل العميل من توكيل الموظف؟
 * نفس قاعدة الشاشة: كود التوكيل أو اسمه، بلا حساسية للمسافات وحالة الأحرف.
 */
function customerInAgency(customer, agency) {
  var target = agency ? agency.toString().trim().toLowerCase() : "";
  if (target === "") return false;
  return (customer.agencyCode || "").toString().trim().toLowerCase() === target ||
         (customer.agencyName || "").toString().trim().toLowerCase() === target;
}

/** الزيارات المفتوحة — كلها، أو لرقم تسلسلي واحد */
function readOpenVisits(ss, serialFilter) {
  var list = [];
  var filter = serialFilter === undefined || serialFilter === null ? null : serialFilter.toString().trim();
  var vRows = getOrCreateSheet(ss, "Visits").getDataRange().getValues();
  for (var ov = 1; ov < vRows.length; ov++) {
    if ((vRows[ov][23] ? vRows[ov][23].toString().trim() : "") !== "open") continue;
    var serial = vRows[ov][3] ? vRows[ov][3].toString().trim() : "";
    if (filter !== null && (filter === "" || serial !== filter)) continue;
    list.push({
      id:                 vRows[ov][1]  ? vRows[ov][1].toString()  : "",
      userName:           vRows[ov][2]  ? vRows[ov][2].toString()  : "",
      serialNumber:       serial,
      agencyCode:         vRows[ov][5]  ? vRows[ov][5].toString()  : "",
      agencyName:         vRows[ov][6]  ? vRows[ov][6].toString()  : "",
      customerCode:       vRows[ov][7]  ? vRows[ov][7].toString()  : "",
      customerName:       vRows[ov][8]  ? vRows[ov][8].toString()  : "",
      repCode:            vRows[ov][9]  ? vRows[ov][9].toString()  : "",
      repName:            vRows[ov][10] ? vRows[ov][10].toString() : "",
      startTime:          vRows[ov][11] ? vRows[ov][11].toString() : "",
      totalDebtAtVisit:   parseFloat(vRows[ov][21]) || 0,
      overdueDebtAtVisit: parseFloat(vRows[ov][22]) || 0,
      status: 'open'
    });
  }
  return list;
}

/**
 * ما يصل هاتف الموظف — لا شيء غيره:
 * سجلّه هو · عملاء توكيله · زيارته المفتوحة · أسباب التجاوز · النطاق.
 * لا قائمة موظفين، ولا كلمات مرور غيره، ولا حسابات التقارير.
 */
function buildEmployeePayload(ss, userRow) {
  var user = userRowToObject(userRow);
  var agency = user.defaultBranchId;

  var customers = [];
  try {
    var all = readCustomers(ss);
    for (var i = 0; i < all.length; i++) {
      if (customerInAgency(all[i], agency)) customers.push(all[i]);
    }
  } catch (e) { customers = []; }

  var reasons = [];
  try { reasons = readVisitReasons(ss); } catch (e) { reasons = []; }

  var radius = 100;
  try { radius = getDefaultCustomerRadius(ss); } catch (e) { radius = 100; }

  var openVisits = [];
  try { openVisits = readOpenVisits(ss, user.serialNumber); } catch (e) { openVisits = []; }

  return {
    status: "ok",
    user: user,
    customers: customers,
    visitReasons: reasons,
    openVisits: openVisits,
    customerRadius: radius
  };
}

/** البيانات الكاملة للوحة الإدارة — بنفس شكل getData القديم */
function buildAdminPayload(ss) {
  var result = {
    status: "ok",
    branches: [], jobs: [], users: [], reportAccounts: [],
    customers: [], visitReasons: [], openVisits: [], customerRadius: 100
  };

  var configRows = getOrCreateSheet(ss, "Config").getDataRange().getValues();
  for (var i = 1; i < configRows.length; i++) {
    if (configRows[i][0] === "branches") {
      try { result.branches = JSON.parse(configRows[i][1]); } catch (e) { result.branches = []; }
    }
    if (configRows[i][0] === "jobs") {
      try { result.jobs = JSON.parse(configRows[i][1]); } catch (e) { result.jobs = []; }
    }
  }

  var userRows = getOrCreateSheet(ss, "Users").getDataRange().getValues();
  // كل الصفوف بلا استثناء — «حفظ السحابة» يُعيد كتابة الشيت من هذه القائمة،
  // فأي صفّ يُسقَط هنا يُحذف من الشيت عند أول حفظ.
  for (var j = 1; j < userRows.length; j++) {
    result.users.push(userRowToObject(userRows[j]));
  }

  var reportAccRows = getOrCreateSheet(ss, "ReportAccounts").getDataRange().getValues();
  for (var k = 1; k < reportAccRows.length; k++) {
    var parsedJobs = [], parsedEmps = [];
    try { parsedJobs = JSON.parse(reportAccRows[k][3]); } catch (e) { parsedJobs = []; }
    try { parsedEmps = reportAccRows[k][4] ? JSON.parse(reportAccRows[k][4]) : []; } catch (e) { parsedEmps = []; }
    result.reportAccounts.push({
      id: reportAccRows[k][0],
      username: reportAccRows[k][1],
      password: reportAccRows[k][2],
      allowedJobs: parsedJobs,
      allowedEmployees: parsedEmps
    });
  }

  try { result.customers      = readCustomers(ss); }           catch (e) { result.customers = []; }
  try { result.visitReasons   = readVisitReasons(ss); }        catch (e) { result.visitReasons = []; }
  try { result.customerRadius = getDefaultCustomerRadius(ss); } catch (e) { result.customerRadius = 100; }
  try { result.openVisits     = readOpenVisits(ss, null); }    catch (e) { result.openVisits = []; }

  return result;
}

// ======================================================
// دالة حساب المسافة (Haversine Formula) - Server Side
// ======================================================
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  var R = 6371e3; // نصف قطر الأرض بالمتر
  var toRad = function(v) { return v * Math.PI / 180; };
  
  var φ1 = toRad(lat1);
  var φ2 = toRad(lat2);
  var Δφ = toRad(lat2 - lat1);
  var Δλ = toRad(lon2 - lon1);

  var a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // المسافة بالمتر
}

// ======================================================
// متابعة العملاء — دوال مساعدة
// ======================================================

/** النطاق الافتراضي حول العميل بالمتر، من Config أو ١٠٠ */
function getDefaultCustomerRadius(ss) {
  try {
    var rows = getOrCreateSheet(ss, "Config").getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === "customer_radius") {
        var val = parseInt(rows[i][1]);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  } catch (e) {}
  return 100;
}

/**
 * قراءة شيت العملاء بلا تكرار.
 * الأعمدة: كود العميل · اسمه · كود المندوب · اسمه · كود التوكيل · اسمه ·
 *          إجمالي المديونية · الأوفر ديو · خط العرض · خط الطول · النطاق
 */
function readCustomers(ss) {
  var sheet = getOrCreateSheet(ss, "Customers");
  var rows = sheet.getDataRange().getValues();
  var list = [];
  // إزالة التكرار بكود العميل: صفّان بنفس الكود (استيراد فوق استيراد، أو
  // كود بمسافة زائدة) كانا يُخرجان العميل نفسه مرّتين في قائمة الموظف.
  // الصفّ الأحدث يغلب لأنه الأسفل في الشيت.
  var seen = {};
  for (var i = 1; i < rows.length; i++) {
    var code = rows[i][0] ? rows[i][0].toString().trim() : "";
    if (code === "") continue; // صفّ فارغ في وسط الشيت لا يُنشئ عميلاً وهمياً
    var key = code.toLowerCase();
    var radius = parseInt(rows[i][10]);
    if (seen[key] !== undefined) list[seen[key]] = null; // يُسقَط أدناه
    seen[key] = list.length;
    list.push({
      id: code,
      code: code,
      name: rows[i][1] ? rows[i][1].toString().trim() : "",
      repCode: rows[i][2] ? rows[i][2].toString().trim() : "",
      repName: rows[i][3] ? rows[i][3].toString().trim() : "",
      agencyCode: rows[i][4] ? rows[i][4].toString().trim() : "",
      agencyName: rows[i][5] ? rows[i][5].toString().trim() : "",
      totalDebt: parseFloat(rows[i][6]) || 0,
      overdueDebt: parseFloat(rows[i][7]) || 0,
      latitude: parseFloat(rows[i][8]) || 0,
      longitude: parseFloat(rows[i][9]) || 0,
      radius: (!isNaN(radius) && radius > 0) ? radius : null
    });
  }

  // إسقاط الصفوف التي غلبها صفّ أحدث بنفس الكود
  var unique = [];
  for (var u = 0; u < list.length; u++) {
    if (list[u] !== null) unique.push(list[u]);
  }
  return unique;
}

/** قائمة أسباب تجاوز الائتمان الجاهزة — عمود واحد في شيت VisitReasons */
function readVisitReasons(ss) {
  var sheet = getOrCreateSheet(ss, "VisitReasons");
  var rows = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var txt = rows[i][0] ? rows[i][0].toString().trim() : "";
    if (txt !== "") list.push({ id: "r" + i, text: txt });
  }
  return list;
}

function findCustomerByCode(ss, code) {
  var target = code ? code.toString().trim() : "";
  if (target === "") return null;
  var all = readCustomers(ss);
  for (var i = 0; i < all.length; i++) {
    if (all[i].code === target) return all[i];
  }
  return null;
}

/**
 * تحقّق مشترك بين فتح الزيارة وإغلاقها.
 *
 * ثلاث بوابات بالترتيب: الموظف مسجَّل · الجهاز مصرَّح · الموقع داخل نطاق
 * العميل. تُعاد كلها في الإغلاق أيضاً — الفتح عند العميل لا يضمن الإغلاق عنده.
 *
 * @returns كائن فيه error نصّي عند الرفض، أو بيانات الموظف والعميل عند القبول
 */
function validateVisitRequest(ss, data) {
  var userSheet = getOrCreateSheet(ss, "Users");
  var userRows = userSheet.getDataRange().getValues();
  var userRowIndex = -1;
  var targetNID = data.nationalId ? data.nationalId.toString() : "";

  for (var k = 1; k < userRows.length; k++) {
    if (userRows[k][2].toString() === targetNID) { userRowIndex = k + 1; break; }
  }
  if (userRowIndex === -1) {
    return { error: "Error: Access Denied. حسابك لم يعد مسجلاً في النظام." };
  }

  var allowedDeviceIds = parseDeviceIds(userRows[userRowIndex - 1][5]);
  var incomingDeviceId = data.deviceId ? data.deviceId.toString() : "";
  if (allowedDeviceIds.indexOf(incomingDeviceId) === -1) {
    return { error: "Security Alert: عفواً، هذا الجهاز غير مسجل أو غير مصرح لك باستخدامه." };
  }

  var customer = findCustomerByCode(ss, data.customerCode);
  if (!customer) {
    return { error: "Security Error: كود العميل غير موجود في قائمة العملاء." };
  }

  var lat = parseFloat(data.latitude);
  var lng = parseFloat(data.longitude);
  if (isNaN(lat) || isNaN(lng)) {
    return { error: "Error: إحداثيات الموقع غير صالحة." };
  }

  var distance = calculateHaversineDistance(lat, lng, customer.latitude, customer.longitude);
  var allowedRadius = customer.radius || getDefaultCustomerRadius(ss);

  // هامش ١٥م — يستوعب تذبذب GPS قرب المباني
  if (distance > (allowedRadius + 15)) {
    return {
      error: "Security Alert: أنت خارج نطاق العميل. المسافة المحسوبة: " +
             Math.round(distance) + "م، والحد المسموح " + allowedRadius + "م."
    };
  }

  return {
    userRowIndex: userRowIndex,
    userName:     userRows[userRowIndex - 1][1] ? userRows[userRowIndex - 1][1].toString() : "",
    serialNumber: userRows[userRowIndex - 1][3] ? userRows[userRowIndex - 1][3].toString() : "",
    jobTitle:     userRows[userRowIndex - 1][4] ? userRows[userRowIndex - 1][4].toString() : "",
    customer: customer,
    lat: lat,
    lng: lng,
    distance: distance
  };
}

/** تحديث آخر وقت وموقع للموظف — يغذّي كشف الانتقال المستحيل */
function userSheetTouch(ss, userRowIndex, when, lat, lng) {
  try {
    var userSheet = getOrCreateSheet(ss, "Users");
    userSheet.getRange(userRowIndex, 10).setValue(when);
    userSheet.getRange(userRowIndex, 14).setValue(lat + "," + lng);
  } catch (e) {}
}

function doGet(e) {
  if (!e || !e.parameter) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "لا توجد معاملات مُرسلة (No parameter received). تنبيه: لا تقم بتشغيل الدالة doGet يدويًا من محرر Apps Script."
    })).setMimeType(ContentService.MimeType.JSON);
  }
  var action = e.parameter.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // getData القديم كان يُسلّم أي طالب — بلا أي مصادقة — كل الموظفين بكلمات
  // مرورهم وأجهزتهم، وكل العملاء بمديونياتهم، وحسابات التقارير. أُلغي.
  // البديل: getMyData للموظف و getAdminData للمسؤول (POST بمصادقة).
  if (action === 'getData') {
    return jsonOut({
      status: "error",
      code: "RETIRED",
      message: "هذه النسخة من التطبيق قديمة. أغلق التطبيق وافتحه من جديد لتحميل التحديث."
    });
  }

  if (action === 'getReportData') {
    var user = e.parameter.user;
    var pass = e.parameter.pass;
    var configSheet = getOrCreateSheet(ss, "Config");
    var configRows = configSheet.getDataRange().getValues();
    var adminUser = "", adminPass = "", allSystemJobs = [], jobsData = [], branches = [];
    for (var c = 1; c < configRows.length; c++) {
      if (configRows[c][0] === "admin_user") adminUser = configRows[c][1];
      if (configRows[c][0] === "admin_pass") adminPass = configRows[c][1];
      if (configRows[c][0] === "branches") {
        try { branches = JSON.parse(configRows[c][1]); } catch(e) { branches = []; }
      }
      if (configRows[c][0] === "jobs") {
        try { 
          jobsData = JSON.parse(configRows[c][1]);
          allSystemJobs = jobsData.map(function(j) { return j.title; }); 
        } catch(e) {} 
      }
    }
    var allowedJobs = [];
    var allowedEmployees = [];
    var isAuthorized = false;

    if (user === adminUser && pass === adminPass && adminUser !== "") { 
      allowedJobs = allSystemJobs;
      isAuthorized = true;
    } else {
       var reportAccSheet = getOrCreateSheet(ss, "ReportAccounts");
       var reportAccRows = reportAccSheet.getDataRange().getValues();
       for (var i = 1; i < reportAccRows.length; i++) {
         if (reportAccRows[i][1] === user && reportAccRows[i][2] === pass) { 
           isAuthorized = true;
           try {
             allowedJobs = JSON.parse(reportAccRows[i][3]); 
             if (!Array.isArray(allowedJobs)) allowedJobs = [];
           } catch(e) { allowedJobs = []; }

           if (reportAccRows[i][4]) {
             try {
                allowedEmployees = JSON.parse(reportAccRows[i][4]);
                if (!Array.isArray(allowedEmployees)) allowedEmployees = [];
             } catch(e) { allowedEmployees = []; }
           }
           break; 
         }
       }
    }
    
    if (!isAuthorized) return ContentService.createTextOutput(JSON.stringify({error: "Invalid login"})).setMimeType(ContentService.MimeType.JSON);
    
    var isAdmin = (user === adminUser && pass === adminPass);

    // ---------- الزيارات ----------
    // نفس نموذج الصلاحيات السابق: المسؤول يرى الكل، وحساب التقارير يرى
    // موظفيه المحدّدين أو أصحاب الوظائف المسموح بها.
    var visitSheet = getOrCreateSheet(ss, "Visits");
    var visitRows = visitSheet.getDataRange().getValues();
    var filteredVisits = [];

    for (var j = 1; j < visitRows.length; j++) {
      var vEmp = (visitRows[j][2] || "").toString();
      var vJob = (visitRows[j][4] || "").toString();
      if (vEmp === "") continue;

      var include = false;
      if (isAdmin) {
        include = true;
      } else if (allowedEmployees.length > 0) {
        if (allowedEmployees.indexOf(vEmp) !== -1) include = true;
      } else {
        if (allowedJobs.indexOf(vJob) !== -1) include = true;
      }
      if (!include) continue;

      filteredVisits.push({
        logDate:       visitRows[j][0],
        id:            (visitRows[j][1]  || "").toString(),
        employeeName:  vEmp,
        serialNumber:  (visitRows[j][3]  || "").toString(),
        job:           vJob,
        agencyCode:    (visitRows[j][5]  || "").toString(),
        agencyName:    (visitRows[j][6]  || "").toString(),
        customerCode:  (visitRows[j][7]  || "").toString(),
        customerName:  (visitRows[j][8]  || "").toString(),
        repCode:       (visitRows[j][9]  || "").toString(),
        repName:       (visitRows[j][10] || "").toString(),
        startTime:     (visitRows[j][11] || "").toString(),
        startGps:      (visitRows[j][12] || "").toString(),
        endTime:       (visitRows[j][13] || "").toString(),
        endGps:        (visitRows[j][14] || "").toString(),
        durationMin:   visitRows[j][15] === "" || visitRows[j][15] === null ? null : Number(visitRows[j][15]),
        overdueReason: (visitRows[j][16] || "").toString(),
        actualDebt:    visitRows[j][17] === "" || visitRows[j][17] === null ? null : Number(visitRows[j][17]),
        overdueDays:   visitRows[j][18] === "" || visitRows[j][18] === null ? null : Number(visitRows[j][18]),
        paymentDate:   (visitRows[j][19] || "").toString(),
        comment:       (visitRows[j][20] || "").toString(),
        totalDebt:     Number(visitRows[j][21]) || 0,
        overdueDebt:   Number(visitRows[j][22]) || 0,
        status:        (visitRows[j][23] || "open").toString()
      });
    }

    var userSheet = getOrCreateSheet(ss, "Users");
    var userRows = userSheet.getDataRange().getValues();
    var authorizedUsers = [];

    for (var k = 1; k < userRows.length; k++) {
      var uName = (userRows[k][1] || "").toString();
      var uJob = (userRows[k][4] || "").toString();
      var uBranch = userRows[k][7];
      var uSerial = userRows[k][3];

      var includeUser = false;
      if (isAdmin) {
        includeUser = true;
      } else if (allowedEmployees.length > 0) {
         if (allowedEmployees.indexOf(uName) !== -1) includeUser = true;
      } else {
         if (allowedJobs.indexOf(uJob) !== -1) includeUser = true;
      }

      if (includeUser) {
        // حُذفت هنا كتلة كانت تطابق التوكيل بقائمة الفروع لتُخرج
        // defaultBranch وbranchCode جاهزين. شاشة التقارير لا تقرأ أياً
        // منهما (صفر إشارة)، فكانت حسابات تُجرى لكل موظف بلا مستهلك.
        authorizedUsers.push({
          fullName: uName,
          jobTitle: uJob,
          defaultBranch: uBranch ? uBranch.toString().trim() : "",
          serialNumber: uSerial
        });
      }
    }

    var reportCustomers = [];
    try { reportCustomers = readCustomers(ss); } catch (e) { reportCustomers = []; }

    return ContentService.createTextOutput(JSON.stringify({
      isAdmin: isAdmin,
      visits: filteredVisits,
      users: authorizedUsers,
      jobs: jobsData,
      branches: branches,
      customers: reportCustomers
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // إجراء غير معروف: ردّ صريح بدل ردّ فارغ
  return ContentService.createTextOutput(JSON.stringify({
    error: "Unknown action '" + (action || "") + "'."
  })).setMimeType(ContentService.MimeType.JSON);
}

// ======================================================
// تهيئة الشيت — تُشغَّل مرة واحدة بيدك من محرر Apps Script
// ======================================================
/**
 * ينشئ كل الصفحات التي يحتاجها النظام بعناوينها الصحيحة.
 *
 * كيف تشغّلها:
 *   ١) افتح شيت جوجل الجديد ← الإضافات ← Apps Script
 *   ٢) الصق هذا الملف كاملاً
 *   ٣) اختر setupSheets من قائمة الدوال أعلى المحرر ثم اضغط Run
 *   ٤) اقبل صلاحيات الوصول للشيت حين تُطلب منك
 *
 * آمنة للتكرار: تتخطّى أي صفحة موجودة ولا تمسّ صفّاً واحداً من بياناتك،
 * فيمكنك تشغيلها مجدداً بعد أي تحديث لإضافة ما استُجدّ من صفحات.
 */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var needed = [
    "Config",        // إعدادات النظام (مفتاح/قيمة)
    "Users",         // الموظفون
    "Customers",     // العملاء — تملؤه أنت أو تستورده من التطبيق
    "VisitReasons",  // أسباب تجاوز فترة الائتمان
    "Visits",        // الزيارات — يكتبه التطبيق تلقائياً
    "AuditLog",      // سجلّ التدقيق
    "ReportAccounts" // حسابات متابعة التقارير
  ];

  var created = [];
  var existed = [];

  for (var i = 0; i < needed.length; i++) {
    if (ss.getSheetByName(needed[i])) {
      existed.push(needed[i]);
    } else {
      getOrCreateSheet(ss, needed[i]);
      created.push(needed[i]);
    }
  }

  // ---------- بذور الإعدادات ----------
  // لا تُكتب إلا إن كان المفتاح غائباً، فلا تُدهس قيمة ضبطتَها بنفسك.
  var seededConfig = [];
  seededConfig = seededConfig.concat(seedConfigKey(ss, "admin_user", "admin"));
  seededConfig = seededConfig.concat(seedConfigKey(ss, "admin_pass", "Ba522129"));
  seededConfig = seededConfig.concat(seedConfigKey(ss, "customer_radius", "100"));

  // ---------- بذور أسباب التجاوز ----------
  // أمثلة تُعدَّل وتُحذف بحرّية — وجودها يمنع قائمة فارغة أمام الموظف
  // في أول تشغيل، وهي أسوأ ما يواجهه في الميدان.
  var reasonSheet = getOrCreateSheet(ss, "VisitReasons");
  var seededReasons = 0;
  if (reasonSheet.getLastRow() < 2) {
    var samples = [
      "العميل مسافر",
      "خلاف على فاتورة",
      "ضائقة مالية لدى العميل",
      "تأخر تحصيل من السوق",
      "المسؤول عن السداد غير موجود",
      "بضاعة مرتجعة لم تُسوَّ"
    ];
    for (var r = 0; r < samples.length; r++) reasonSheet.appendRow([samples[r]]);
    seededReasons = samples.length;
  }

  // ---------- التقرير ----------
  var lines = [];
  lines.push("انتهت التهيئة بنجاح.");
  lines.push("");
  lines.push("صفحات أُنشئت (" + created.length + "): " + (created.join("، ") || "لا شيء"));
  lines.push("صفحات كانت موجودة (" + existed.length + "): " + (existed.join("، ") || "لا شيء"));
  lines.push("إعدادات أُضيفت: " + (seededConfig.join("، ") || "لا شيء"));
  lines.push("أسباب تجاوز أُضيفت: " + seededReasons);
  lines.push("");
  lines.push("الخطوات التالية:");
  lines.push("١) املأ صفحة Customers ببيانات عملائك (أو استوردها من لوحة الإدارة).");
  lines.push("٢) في صفحة Users، ضع كود التوكيل أو اسمه في عمود Agency لكل موظف.");
  lines.push("٣) انشر السكربت: Deploy ← New deployment ← Web app ← Execute as: Me ← Who has access: Anyone.");
  lines.push("٤) انسخ رابط النشر وضعه في public/server-config.json.");
  lines.push("");
  lines.push("تنبيه أمني: غيّر كلمة مرور المسؤول (admin_pass) في صفحة Config فوراً.");
  lines.push("التطبيق لم يعد يحملها — الخادم وحده يتحقّق منها، فتغييرها هنا يكفي.");

  var report = lines.join("\n");
  Logger.log(report);

  // محاولة عرض الرسالة في الشيت — تفشل بصمت إن شُغّلت بلا واجهة
  try {
    SpreadsheetApp.getUi().alert("تهيئة Uniteam", report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}

  return report;
}

/** يكتب مفتاح إعدادات إن لم يكن موجوداً. يُعيد اسمه إن كتبه، وإلا مصفوفة فارغة. */
function seedConfigKey(ss, key, value) {
  var sheet = getOrCreateSheet(ss, "Config");
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].toString().trim() === key) return [];
  }
  sheet.appendRow([key, value]);
  return [key];
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === "Config") {
      sheet.appendRow(["Key", "Value"]);
    } else if (name === "Users") {
      // العمودان 11 و12 محجوزان (كانا CheckIn/CheckOut) — يُبقيان
      // AllowedDeviceCount و LastGPS في موضعيهما المقروءين بفهارس ثابتة.
      sheet.appendRow(["ID", "Full Name", "National ID", "Serial Number", "Job Title", "Device ID", "Password", "Agency", "Reg Date", "Last Update", "Reserved1", "Reserved2", "AllowedDeviceCount", "LastGPS"]);
    } else if (name === "ReportAccounts") {
      sheet.appendRow(["ID", "Username", "Password", "Allowed Jobs", "Allowed Employees"]);
    } else if (name === "AuditLog") {
      sheet.appendRow(["Timestamp", "User", "Action", "Details", "Device Info"]);
    } else if (name === "Customers") {
      sheet.appendRow([
        "كود العميل", "اسم العميل", "كود المندوب", "اسم المندوب",
        "كود التوكيل", "اسم التوكيل",
        "إجمالي المديونية", "المديونية الأوفر ديو",
        "خط العرض", "خط الطول", "النطاق"
      ]);
    } else if (name === "VisitReasons") {
      sheet.appendRow(["السبب"]);
    } else if (name === "Visits") {
      // ٢٤ عموداً — الترتيب مربوط بأرقام الأعمدة في startVisit و closeVisit
      // و cancelVisit، فلا تُدرج عموداً في الوسط ولا تُعِد ترتيبها.
      sheet.appendRow([
        "تاريخ السجل", "معرّف الزيارة", "اسم الموظف", "الرقم التسلسلي", "الوظيفة",
        "كود التوكيل", "اسم التوكيل", "كود العميل", "اسم العميل",
        "كود المندوب", "اسم المندوب",
        "وقت الفتح", "إحداثيات الفتح", "وقت الإغلاق", "إحداثيات الإغلاق", "مدة الزيارة (دقيقة)",
        "سبب تجاوز الائتمان", "المديونية الفعلية", "أيام التجاوز", "موعد السداد",
        "ملاحظات الموظف",
        "إجمالي المديونية وقت الزيارة", "الأوفر ديو وقت الزيارة", "الحالة"
      ]);
    }
  } else {
    var lastCol, headers;
    if (name === "Users") {
       lastCol = sheet.getLastColumn();
       headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
       // التأكد من وجود LastGPS — يُضاف في النهاية فلا يزيح فهرساً
       if (headers.indexOf("LastGPS") === -1) {
          sheet.getRange(1, lastCol + 1).setValue("LastGPS");
       }
    }
  }
  return sheet;
}
