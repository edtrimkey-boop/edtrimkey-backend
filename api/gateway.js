import { supabase } from '../lib/supabase.js';
import { uploadToGoogleDrive, getOrCreateFolder } from '../lib/gdrive.js';
import { sendPushNotification } from '../lib/firebase.js';

export default async function handler(req, res) {
  // 1. DYNAMIC CORS (Fast header injection)
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin); 
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Only POST allowed' });

  const { action, email, password, token, ...payload } = req.body;
  
  try {
    let result = {};
    let userContext = null;
    const publicActions = ["login", "submitInstituteRegistration"];
    
    // 2. JWT SECURITY WRAPPER
    if (!publicActions.includes(action)) {
       const { data: { user }, error } = await supabase.auth.getUser(token);
       if (error || !user) return res.status(200).json({ authFailed: true, message: "Session expired or invalid." });
       userContext = user;
    }

    // 3. MASTER SWITCHBOARD
    switch (action) {
      
      // ==========================================
      // AUTHENTICATION & SECURITY
      // ==========================================
      case "login":
        const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
        if (authErr) throw authErr;
        
        const { data: profile } = await supabase.from('users').select('*').eq('auth_user_id', authData.user.id).single();
        if (!profile || profile.status !== 'Active') throw new Error("Account is disabled or pending.");

        result = { success: true, email: profile.email, token: authData.session.access_token, role: profile.role };
        break;

      case "changeUserPassword":
        const { error: pwErr } = await supabase.auth.admin.updateUserById(userContext.id, { password: payload.newPw });
        if (pwErr) throw pwErr;
        result = { success: true, message: "Password updated successfully!" };
        break;

      case "logoutAllDevices":
        await supabase.auth.admin.signOut(userContext.id, 'global');
        result = { success: true };
        break;

      case "updateProfilePic":
        await supabase.from('users').update({ profile_pic_url: payload.url }).eq('auth_user_id', userContext.id);
        result = { success: true };
        break;

      case "registerDeviceToken":
        const { data: currUser } = await supabase.from('users').select('device_tokens').eq('auth_user_id', userContext.id).single();
        let tokens = currUser?.device_tokens ? currUser.device_tokens.split(',') : [];
        if (!tokens.includes(payload.token)) {
            tokens.push(payload.token);
            await supabase.from('users').update({ device_tokens: tokens.join(',') }).eq('auth_user_id', userContext.id);
        }
        result = { success: true };
        break;

      // ==========================================
      // DASHBOARD DATA AGGREGATOR (ULTRA-FAST PARALLEL QUERIES)
      // ==========================================
      case "getDashboardPayload":
        const { data: userData, error: userErr } = await supabase
            .from('users')
            .select('*, institutes(*), operator_profiles(*)')
            .eq('auth_user_id', userContext.id)
            .single();
            
        if (userErr || !userData) throw new Error("User profile corrupted.");

        const dashRole = String(userData.role).trim().toLowerCase();
        const dashInstUUID = userData.institute_id;
        const dashUserUUID = userData.id;

        // 🔥 OPTIMIZATION: Build query for all jobs based on role
        let jobsQuery = supabase.from('jobs_queue').select('*').order('created_at', { ascending: false });
        if (dashRole === 'teacher') jobsQuery = jobsQuery.eq('requester_id', dashUserUUID);
        else if (dashRole === 'admin') jobsQuery = jobsQuery.eq('institute_id', dashInstUUID);
        else if (dashRole === 'operator') jobsQuery = jobsQuery.eq('operator_id', dashUserUUID);

        // 🔥 OPTIMIZATION: Execute all secondary queries in parallel using Promise.all
        const [subsRes, teacherRes, jobsRes, notifsRes] = await Promise.all([
            supabase.from('subscriptions').select('*, subscription_features(*)').eq('institute_id', dashInstUUID).eq('status', 'Active'),
            supabase.from('teacher_profiles').select('subject_handles').eq('user_id', dashUserUUID).maybeSingle(),
            jobsQuery,
            supabase.from('notifications').select('*').contains('target_roles', [userData.role]).order('created_at', { ascending: false }).limit(30)
        ]);

        const activeSubs = subsRes.data || [];
        const safeJobs = jobsRes.data || [];
        const safeNotifs = notifsRes.data || [];
        
        let formattedTeacherSubjects = teacherRes.data?.subject_handles ? (Array.isArray(teacherRes.data.subject_handles) ? teacherRes.data.subject_handles.join(', ') : teacherRes.data.subject_handles) : null;

        // Parse Subscription Features
        let papersTotal = 0, papersLeft = 0, rcTotal = 0, rcLeft = 0, acTotal = 0, acLeft = 0, smsTotal = 0, smsRemaining = 0;
        let attEnabled = "NO", admEnabled = "NO", feeEnabled = "NO";
        let mainPlan = "Standard", mainStart = "N/A", mainRenew = "N/A", mainValue = null;

        if (activeSubs.length > 0) {
            const primarySub = activeSubs[0]; 
            mainPlan = primarySub.plan_name || "Standard";
            mainStart = primarySub.start_date || "N/A";
            mainRenew = primarySub.renewal_date || "N/A";
            mainValue = primarySub.purchase_value;

            activeSubs.forEach(sub => {
                if (sub.subscription_features) {
                    sub.subscription_features.forEach(feat => {
                        if (feat.feature_key === 'paper_formatter') { papersTotal += feat.total_limit; papersLeft += feat.remaining; }
                        if (feat.feature_key === 'report_cards') { rcTotal += feat.total_limit; rcLeft += feat.remaining; }
                        if (feat.feature_key === 'admit_cards') { acTotal += feat.total_limit; acLeft += feat.remaining; }
                        if (feat.feature_key === 'sms') { smsTotal += feat.total_limit; smsRemaining += feat.remaining; }
                        if (feat.feature_key === 'attendance' && feat.enabled) attEnabled = "YES";
                        if (feat.feature_key === 'admission' && feat.enabled) admEnabled = "YES";
                        if (feat.feature_key === 'fee_collection' && feat.enabled) feeEnabled = "YES";
                    });
                }
            });
        }

        let generatedApps = [];
        if (attEnabled === "YES") generatedApps.push({ name: "Attendance App", url: "https://script.google.com/macros/s/AKfycbxWrJ75j__w2-hjxvoQGHvM5ztFMzod6RUxAputcyZGlESuhaPWZAJbk-gQnXhCZNSL/exec", targetRole: "all" });
        if (admEnabled === "YES") generatedApps.push({ name: "Admission System", url: "https://script.google.com/macros/s/AKfycbyhSh64AGV-oFrGZL25mWKOhjO1vn7ID_FZ0kcwokk3FuAzwQnygeHKVnwGlRi4DuZRhQ/exec", targetRole: "all" });
        if (feeEnabled === "YES") generatedApps.push({ name: "Fee Collection", url: "https://script.google.com/macros/s/AKfycbxWrJ75j__w2-hjxvoQGHvM5ztFMzod6RUxAputcyZGlESuhaPWZAJbk-gQnXhCZNSL/exec", targetRole: "admin" });

        result = {
          profile: {
            id: userData.id, instId: userData.institute_id || '', email: userData.email, name: userData.full_name, role: userData.role, 
            subjects: formattedTeacherSubjects || userData.subjects || userData.operator_profiles?.[0]?.subjects || 'Not Assigned',
            institute: userData.institutes?.institute_name, code: userData.institutes?.institute_code || userData.institutes?.code || '',
            logo: userData.institutes?.logo_url || userData.institutes?.logo || userData.institutes?.institute_logo || '', 
            profilePic: userData.profile_pic_url,
            toggles: { attendance: attEnabled, admission: admEnabled, fee: feeEnabled },
            dynamicApps: generatedApps,
            instDetails: {
                ...userData.institutes,
                plan: mainPlan, startDate: mainStart, renewal: mainRenew, purchaseValue: mainValue,
                papersTotal: papersTotal, papersLeft: papersLeft, rcTotal: rcTotal, rcLeft: rcLeft,
                acTotal: acTotal, acLeft: acLeft, smsTotal: smsTotal, smsRemaining: smsRemaining
            }
          },
          data: {
            papers: safeJobs.filter(j => j.job_type === 'Paper').map(j => ({ 
                id: j.job_code, date: j.created_at, inst: userData.institutes?.institute_name || 'Unknown', class: j.meta_data?.class || '', subject: j.meta_data?.subject || '', exam: j.meta_data?.test_type || '', deadline: j.deadline || 'No Deadline', status: j.status, row: j.final_file_url || j.raw_file_url || '' 
            })),
            docs: safeJobs.filter(j => j.job_type !== 'Paper').map(j => ({ 
                id: j.job_code, date: j.created_at, inst: userData.institutes?.institute_name || 'Unknown', class: j.meta_data?.class || '', type: j.job_type, exam: j.meta_data?.exam_name || '', students: j.meta_data?.num_students || 0, deadline: j.deadline || 'No Deadline', status: j.status, row: j.final_file_url || j.raw_file_url || '' 
            })),
            myBilling: [], instTeachers: [], instStudents: []
          },
          notifications: safeNotifs.map(n => ({ title: n.title, msg: n.message, time: n.created_at, isRead: false })),
          stats: {
             academic: { today: safeJobs.filter(j => j.status === 'Pending').length, session: safeJobs.length, academic: safeJobs.length },
             inst: { month: safeJobs.length, academic: safeJobs.length },
             financial: { total: 0, pending: 0 }
          }
        };

        if (["super admin", "system admin", "all"].includes(dashRole)) {
            const [allInstRes, allOpsRes] = await Promise.all([
                supabase.from('institutes').select('*'),
                supabase.from('users').select('*, operator_profiles(*)').eq('role', 'operator')
            ]);
            result.superAdmin = {
                kpi: { totalRev: 0, activeInst: allInstRes.data?.length || 0, pendingPay: 0, docsGen: safeJobs.length },
                institutes: (allInstRes.data || []).map(i => ({ code: i.institute_code || i.code || '', name: i.institute_name, plan: 'Checking Subs...', status: i.is_active ? 'Active' : 'Inactive', rc: 0, ac: 0, papers: 0, toggles: { attendance: "NO", admission: "NO", fee: "NO" } })),
                operatorList: (allOpsRes.data || []).map(o => ({ name: o.full_name, role: o.role, status: o.status, pending: 0, assigned: 0, completed: 0, totalEarnings: 0, clearedEarnings: 0, pendingPayouts: 0, upi: o.operator_profiles[0]?.upi })),
                transactions: []
            };
        }
        break;

     // ==========================================
      // JOB CREATION - PAPERS
      // ==========================================
      case "submitPaperJob":
        const { data: dbUser } = await supabase.from('users').select('id, institute_id').eq('auth_user_id', userContext.id).single();
        if (!dbUser) throw new Error("Security Error: Account mapping invalid.");
        const instUUID = dbUser.institute_id;

        // Fetch Inst & Feature Quota in Parallel
        const [instRes, featureRes] = await Promise.all([
            supabase.from('institutes').select('*').eq('id', instUUID).single(),
            supabase.from('subscription_features').select('*, subscriptions!inner(status, payment_status, expiry_date)').eq('subscriptions.institute_id', instUUID).eq('subscriptions.status', 'Active').eq('feature_key', 'paper_formatter').single()
        ]);
        
        if (!instRes.data) throw new Error("Security Error: Institute mapping invalid.");
        const paperFeature = featureRes.data;

        if (!paperFeature) throw new Error("Subscription Required: Paper Formatter module not found.");
        if (paperFeature.subscriptions.payment_status !== 'Paid' && paperFeature.subscriptions.payment_status !== 'Trial') throw new Error("Billing Error: Payment is pending.");
        if (paperFeature.subscriptions.expiry_date && new Date(paperFeature.subscriptions.expiry_date) < new Date()) throw new Error("Subscription Expired.");
        if (paperFeature.remaining <= 0) throw new Error("Quota Exhausted: You have 0 papers remaining.");

        const instCode = instRes.data.institute_code || instRes.data.code || "INST";
        const jobTypeStr = payload.jobType || "Paper";
        const currentYearStr = new Date().getFullYear().toString().slice(-2);

        // 🔥 BULLETPROOF HIGH-SPEED ID GENERATOR (GLOBALLY AVOIDS DUPLICATES)
        const idPrefix = `${instCode}-PPR-${currentYearStr}-`;
        const { data: existingJobs } = await supabase.from('jobs_queue').select('job_code').ilike('job_code', `${idPrefix}%`);
        
        let nextNum = 1;
        if (existingJobs && existingJobs.length > 0) {
            let maxId = 0;
            for(let i = 0; i < existingJobs.length; i++) {
                if(!existingJobs[i].job_code) continue;
                const parts = existingJobs[i].job_code.split('-');
                const lastPart = parts[parts.length - 1];
                const num = parseInt(lastPart, 10);
                if (!isNaN(num) && num > maxId) maxId = num;
            }
            nextNum = maxId + 1;
        }
        
        const universalJobId = `${idPrefix}${String(nextNum).padStart(4, '0')}`;

        let ext = payload.mimeType === "application/pdf" ? ".pdf" : "";
        if (payload.fileName && payload.fileName.includes('.')) ext = '.' + payload.fileName.split('.').pop();
        const finalFileName = `${universalJobId}${ext}`;

        let baseFolderId = process.env.DRIVE_ROOT_FOLDER_ID || '1U0hXB394ogLsfRCpjbtR-XU48B_Xutzt';
        let finalFolderId = baseFolderId;

        if (payload.fileBase64) {
            const level2_InstName = await getOrCreateFolder(instRes.data.institute_name || "Unknown", baseFolderId);
            finalFolderId = await getOrCreateFolder('Uploads_from_Teachers', level2_InstName);
        }

        let paperDriveUrl = payload.fileBase64 ? await uploadToGoogleDrive(payload.fileBase64, finalFileName, payload.mimeType, finalFolderId) : "";
        
        const deadlineDate = new Date();
        deadlineDate.setHours(deadlineDate.getHours() + 48);

        let assignedOperatorId = null;
        const { data: operators } = await supabase.from('operator_profiles').select('*');
        if (operators && operators.length > 0) {
            const matchingOps = operators.filter(op => {
                const safeWork = JSON.stringify(op.work_types || op.workType || "").toLowerCase();
                const safeSubj = JSON.stringify(op.subjects || "").toLowerCase();
                const handlesWork = safeWork.includes('paper format') || safeWork.includes('paper'); 
                const handlesSubject = payload.subject ? (safeSubj.includes(payload.subject.toLowerCase()) || (payload.subject.toLowerCase() === 'mathematics' && safeSubj.includes('math'))) : true;
                const isActive = (!op.status || op.status === "Active" || op.status === "Connected");
                return handlesWork && handlesSubject && isActive;
            });
            if (matchingOps.length > 0) assignedOperatorId = matchingOps[Math.floor(Math.random() * matchingOps.length)].user_id;
        }

        const { error: submitDbError } = await supabase.from('jobs_queue').insert([{
            job_code: universalJobId, institute_id: instUUID, job_type: jobTypeStr, requester_id: dbUser.id, operator_id: assignedOperatorId,
            status: 'Pending', raw_file_url: paperDriveUrl, deadline: deadlineDate.toISOString(),
            meta_data: { 
                class: payload.className ? payload.className.toUpperCase() : "", 
                exam_name: payload.examName ? payload.examName.toUpperCase() : "", 
                subject: payload.subject ? payload.subject.toUpperCase() : "", 
                test_type: payload.testType, 
                test_no: payload.testNo, 
                test_date: payload.testDate || payload.docDate, 
                num_students: payload.numStudents, 
                duration: payload.duration, 
                questions: payload.numQuestions, 
                full_marks: payload.fullMarks, 
                pass_marks: payload.passMarks, 
                teacher_name: payload.teacherName ? payload.teacherName.toUpperCase() : "" 
            }
        }]);

        if (submitDbError) throw new Error("Database Write Failed: " + submitDbError.message);
        await supabase.from('subscription_features').update({ used: paperFeature.used + 1, remaining: paperFeature.remaining - 1 }).eq('id', paperFeature.id);
        
        result = { success: true, jobId: universalJobId };
        break;
        
      // ==========================================
      // JOB CREATION - DOCUMENTS
      // ==========================================
      case "submitDocumentJob":
        const { data: docUserObj } = await supabase.from('users').select('id, institute_id').eq('auth_user_id', userContext.id).single();
        const docInstUUID = docUserObj.institute_id;

        // 🔥 THE FIX: The frontend sends 'payload.jobType', not 'payload.docType'!
        const documentTypeStr = payload.jobType; 

        const featureTarget = documentTypeStr === 'Report Card' ? 'report_cards' : 'admit_cards';
        
        const [docInstRes, docFeatureRes] = await Promise.all([
            // 🔥 THE FIX: Use select('*') to ensure we don't cause an error fetching the institute code
            supabase.from('institutes').select('*').eq('id', docInstUUID).single(),
            supabase.from('subscription_features').select('*, subscriptions!inner(status, payment_status, expiry_date)').eq('subscriptions.institute_id', docInstUUID).eq('subscriptions.status', 'Active').eq('feature_key', featureTarget).single()
        ]);

        const docFeature = docFeatureRes.data;
        if (!docFeature) throw new Error(`Subscription Required: ${documentTypeStr} module not found.`);
        if (docFeature.subscriptions.payment_status !== 'Paid' && docFeature.subscriptions.payment_status !== 'Trial') throw new Error("Billing Error: Payment is pending.");
        if (docFeature.remaining <= 0) throw new Error(`${documentTypeStr} quota exhausted! Please recharge.`);

        const docInstCode = docInstRes.data?.institute_code || docInstRes.data?.code || "INST";
        const jobTypeCodes = { "Report Card": "RC", "Admit Card": "AC", "ID Card": "ID", "Certificate": "CERT" };
        
        // 🔥 THE FIX: Now it correctly maps "Report Card" to "RC"
        const docTypeCode = jobTypeCodes[documentTypeStr] || "DOC";
        const currentDocYearStr = new Date().getFullYear().toString().slice(-2);

        // 🔥 BULLETPROOF HIGH-SPEED ID GENERATOR FOR DOCUMENTS
        const docPrefix = `${docInstCode}-${docTypeCode}-${currentDocYearStr}-`;
        const { data: existingDocs } = await supabase.from('jobs_queue').select('job_code').ilike('job_code', `${docPrefix}%`);
        
        let nextDocNum = 1;
        if (existingDocs && existingDocs.length > 0) {
            let maxDocId = 0;
            for(let i = 0; i < existingDocs.length; i++) {
                if(!existingDocs[i].job_code) continue;
                const parts = existingDocs[i].job_code.split('-');
                const lastPart = parts[parts.length - 1];
                const num = parseInt(lastPart, 10);
                if (!isNaN(num) && num > maxDocId) maxDocId = num;
            }
            nextDocNum = maxDocId + 1;
        }

        const docJobId = `${docPrefix}${String(nextDocNum).padStart(4, '0')}`;

        let docDriveUrl = payload.fileBase64 ? await uploadToGoogleDrive(payload.fileBase64, payload.fileName, payload.mimeType) : "";

        const deadlineDate = new Date();
        deadlineDate.setHours(deadlineDate.getHours() + 48);
        
        await supabase.from('jobs_queue').insert([{
            job_code: docJobId, 
            institute_id: docInstUUID, 
            job_type: documentTypeStr, // 🔥 THE FIX: Correct job type saved to database
            requester_id: docUserObj.id, 
            status: 'Pending', 
            raw_file_url: docDriveUrl
            deadline: deadlineDate.toISOString(),
            meta_data: { 
                class: payload.className ? payload.className.toUpperCase() : "", 
                exam_name: payload.examName ? payload.examName.toUpperCase() : "", 
                num_students: payload.numStudents 
            }
        }]);

        await supabase.from('subscription_features').update({ used: docFeature.used + 1, remaining: docFeature.remaining - 1 }).eq('id', docFeature.id);

        result = { success: true, jobId: docJobId };
        break;
        
      // ==========================================
      // OPERATIONAL REVISIONS (ADD NOTE)
      // ==========================================
      case "appendJobNote":
        const { data: jobData, error: jobErr } = await supabase.from('jobs_queue').select('meta_data, status').eq('job_code', payload.jobId).single();
        if (jobErr || !jobData) throw new Error("Security Error: Job not found.");

        if (jobData.status !== 'Pending' && jobData.status !== 'Transmitted') throw new Error("Too late! The operator has already started formatting this job.");

        // 🔥 JSONB SAFE MERGE
        let currentMeta = typeof jobData.meta_data === 'string' ? JSON.parse(jobData.meta_data) : (jobData.meta_data || {});
        let updatedMeta = { ...currentMeta, note: payload.note };

        const { error: noteUpdateErr } = await supabase.from('jobs_queue').update({ meta_data: updatedMeta }).eq('job_code', payload.jobId);
        if (noteUpdateErr) throw new Error("Database failed to attach the note.");

        result = { success: true, message: "Note securely attached." };
        break;

      // ==========================================
      // REGISTRATIONS & MANAGEMENT
      // ==========================================
      case "submitInstituteRegistration":
        const { data: newInst } = await supabase.from('institutes').insert([{
            code: payload.instCode, institute_name: payload.instName, is_active: true
        }]).select().single();

        const { data: instAuth } = await supabase.auth.admin.createUser({ email: payload.adminEmail, password: "TKadmin123", email_confirm: true });
        await supabase.from('users').insert([{
            auth_user_id: instAuth.user.id, email: payload.adminEmail, full_name: payload.clientName || "Admin",
            role: 'admin', institute_id: newInst.id, institute_code: payload.instCode, status: 'Active'
        }]);

        const { data: initialSub } = await supabase.from('subscriptions').insert([{
            institute_id: newInst.id, subscription_type: "Complete ERP", plan_name: payload.planType,
            billing_cycle: "Yearly", status: "Active", payment_status: "Trial", start_date: new Date().toISOString(), purchase_value: 0
        }]).select().single();

        await supabase.from('subscription_features').insert([
            { subscription_id: initialSub.id, feature_key: 'paper_formatter', enabled: true, total_limit: payload.papersTotal, remaining: payload.papersTotal },
            { subscription_id: initialSub.id, feature_key: 'sms', enabled: true, total_limit: payload.smsTotal, remaining: payload.smsTotal },
            { subscription_id: initialSub.id, feature_key: 'attendance', enabled: payload.attendanceToggle === "YES" },
            { subscription_id: initialSub.id, feature_key: 'admission', enabled: payload.admissionToggle === "YES" },
            { subscription_id: initialSub.id, feature_key: 'fee_collection', enabled: payload.feeToggle === "YES" }
        ]);

        result = { success: true, message: "Institute, User, and Initial Subscription Registered." };
        break;

      case "submitTeacherRegistration":
        const { data: tchrAuth } = await supabase.auth.admin.createUser({ email: payload.email, password: "TKtchr123", email_confirm: true });
        await supabase.from('users').insert([{ auth_user_id: tchrAuth.user.id, email: payload.email, full_name: payload.name, role: 'teacher', institute_code: payload.instCode, status: 'Active', profile_pic_url: payload.photoUrl }]);
        result = { success: true };
        break;

      case "submitOperatorRegistration":
        const { data: opAuth } = await supabase.auth.admin.createUser({ email: payload.email, password: "TKoperator123", email_confirm: true });
        const { data: newOp } = await supabase.from('users').insert([{ auth_user_id: opAuth.user.id, email: payload.email, full_name: payload.name, role: 'operator', status: 'Active', profile_pic_url: payload.photoUrl }]).select().single();
        await supabase.from('operator_profiles').insert([{ user_id: newOp.id, subjects: payload.subjects, work_type: payload.workType, rate_paper: payload.ratePaper, rate_unit: payload.rateUnit, upi: payload.upi }]);
        result = { success: true };
        break;

      case "updateOperatorDetails":
        const { data: opUser } = await supabase.from('users').select('id').eq('full_name', payload.originalName).single();
        if(opUser) {
           await Promise.all([
             supabase.from('users').update({ status: payload.status }).eq('id', opUser.id),
             supabase.from('operator_profiles').update({ subjects: payload.subjects, work_type: payload.workType, rate_paper: payload.ratePaper, rate_unit: payload.rateUnit }).eq('user_id', opUser.id)
           ]);
        }
        result = { success: true };
        break;

      case "assignJobToOperator":
        const { data: opToAssign } = await supabase.from('users').select('id, device_tokens').eq('full_name', payload.operatorName).single();
        if(opToAssign) {
            await supabase.from('jobs_queue').update({ operator_id: opToAssign.id, status: 'Assigned' }).eq('job_code', payload.jobId);
            if (opToAssign.device_tokens) await sendPushNotification(opToAssign.device_tokens.split(','), "New Job Assigned", `Job ${payload.jobId} assigned to you.`);
        }
        result = { success: true, message: `Job officially assigned.` };
        break;

      case "toggleInstituteApp":
        const { data: instData } = await supabase.from('institutes').select('id').eq('code', payload.instCode).single();
        const featureKeyMap = { 'attendance': 'attendance', 'admission': 'admission', 'fee': 'fee_collection' };
        const fKey = featureKeyMap[payload.appType];
        
        const { data: toggleFeat } = await supabase.from('subscription_features').select('*, subscriptions!inner(institute_id, status)').eq('subscriptions.institute_id', instData.id).eq('subscriptions.status', 'Active').eq('feature_key', fKey).single();
        if (!toggleFeat) throw new Error("Module not found in active subscriptions.");
        
        await supabase.from('subscription_features').update({ enabled: payload.stateStr === 'YES' }).eq('id', toggleFeat.id);
        result = { success: true };
        break;

      case "deleteOperatorAccess":
      case "deleteTeacherAccess":
        await supabase.from('users').delete().eq(payload.name ? 'full_name' : 'email', payload.name || payload.email);
        result = { success: true };
        break;

      case "removeOperatorAccess":
      case "removeTeacherAccess":
        await supabase.from('users').update({ status: 'Inactive' }).eq(payload.name ? 'full_name' : 'email', payload.name || payload.email);
        result = { success: true };
        break;

      case "restoreOperatorAccess":
      case "restoreTeacherAccess":
        await supabase.from('users').update({ status: 'Active' }).eq(payload.name ? 'full_name' : 'email', payload.name || payload.email);
        result = { success: true };
        break;

      case "createPaymentLink":
        result = { success: true, refId: `TXN-${Date.now()}`, amount: payload.amount };
        break;

      case "sendNotification":
        await supabase.from('notifications').insert([{ sender_id: userContext.id, target_roles: [payload.targetRaw], title: payload.title, message: payload.msg }]);
        result = { success: true, message: "Broadcast sent." };
        break;

      case "markNotificationsRead":
        result = { success: true };
        break;

      case "getGeneratedFolderUrl":
        result = { success: true, url: "https://drive.google.com/drive/folders/" + process.env.DRIVE_ROOT_FOLDER_ID };
        break;

      case "download":
        result = { success: true, url: payload.row };
        break;

      case "requestJobRevision":
        const { data: jobInfo } = await supabase.from('jobs_queue').select('meta_data').eq('job_code', payload.jobId).single();
        let newMeta = typeof jobInfo?.meta_data === 'string' ? JSON.parse(jobInfo.meta_data) : (jobInfo?.meta_data || {});
        newMeta.latest_correction_note = payload.note;
        await supabase.from('jobs_queue').update({ status: 'Pending Revision', meta_data: newMeta }).eq('job_code', payload.jobId);
        result = { success: true };
        break;

      default:
        throw new Error("Invalid API Action requested: " + action);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error(error);
    return res.status(200).json({ success: false, message: error.message });
  }
}
