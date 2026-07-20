import { supabase } from '../lib/supabase.js';
import { uploadToGoogleDrive, getOrCreateFolder } from '../lib/gdrive.js';
import { sendPushNotification } from '../lib/firebase.js';

export default async function handler(req, res) {
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
    
    if (!publicActions.includes(action)) {
       const { data: { user }, error } = await supabase.auth.getUser(token);
       if (error || !user) return res.status(200).json({ authFailed: true, message: "Session expired or invalid." });
       userContext = user;
    }

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
      // DASHBOARD DATA AGGREGATOR (SUBSCRIPTION ARCHITECTURE)
      // ==========================================
      case "getDashboardPayload":
        const { data: userData, error: userErr } = await supabase
            .from('users')
            .select('*, institutes(*), operator_profiles(*)')
            .eq('auth_user_id', userContext.id)
            .single();
            
        if (userErr || !userData) throw new Error("User profile corrupted.");

        const dashRole = String(userData.role).trim().toLowerCase();
        const dashUserUUID = userData.id;
        const dashInstUUID = userData.institute_id;

        // 🔥 THE NEW ARCHITECTURE: Fetch Active Subscriptions & Features
        const { data: activeSubs } = await supabase
            .from('subscriptions')
            .select('*, subscription_features(*)')
            .eq('institute_id', dashInstUUID)
            .eq('status', 'Active');

        // Parse Subscription Features into Dashboard Data
        let papersTotal = 0, papersLeft = 0;
        let rcTotal = 0, rcLeft = 0;
        let acTotal = 0, acLeft = 0;
        let smsTotal = 0, smsRemaining = 0;
        let attEnabled = "NO", admEnabled = "NO", feeEnabled = "NO";
        let mainPlan = "Standard", mainStart = "N/A", mainRenew = "N/A", mainValue = null;

        if (activeSubs && activeSubs.length > 0) {
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

        const { data: teacherProfile } = await supabase.from('teacher_profiles').select('subject_handles').eq('user_id', userData.id).maybeSingle(); 
        let formattedTeacherSubjects = teacherProfile?.subject_handles ? (Array.isArray(teacherProfile.subject_handles) ? teacherProfile.subject_handles.join(', ') : teacherProfile.subject_handles) : null;
        
        let papersQuery = supabase.from('jobs_queue').select('*').eq('job_type', 'Paper');
        let docsQuery = supabase.from('jobs_queue').select('*').not('job_type', 'eq', 'Paper');

        if (dashRole === 'teacher') {
            papersQuery = papersQuery.eq('requester_id', dashUserUUID);
            docsQuery = docsQuery.eq('requester_id', dashUserUUID);
        } else if (dashRole === 'admin') {
            papersQuery = papersQuery.eq('institute_id', dashInstUUID);
            docsQuery = docsQuery.eq('institute_id', dashInstUUID);
        } else if (dashRole === 'operator') {
            papersQuery = papersQuery.eq('operator_id', dashUserUUID);
            docsQuery = docsQuery.eq('operator_id', dashUserUUID);
        }

        const { data: papersData } = await papersQuery.order('created_at', { ascending: false });
        const { data: docsData } = await docsQuery.order('created_at', { ascending: false });
        const safeJobs = [...(papersData || []), ...(docsData || [])];

        const { data: notifications } = await supabase.from('notifications').select('*').contains('target_roles', [userData.role]).order('created_at', { ascending: false }).limit(30);
        const safeNotifs = notifications || [];

// 🔥 THE APP BUTTON GENERATOR
        let generatedApps = [];
        // Replace the placeholder URLs below with your actual deployed Vercel app links!
        if (attEnabled === "YES") generatedApps.push({ name: "Attendance App", url: "https://your-attendance-app.vercel.app", targetRole: "all" });
        if (admEnabled === "YES") generatedApps.push({ name: "Admission System", url: "https://your-admission-app.vercel.app", targetRole: "all" });
        if (feeEnabled === "YES") generatedApps.push({ name: "Fee Collection", url: "https://your-fee-app.vercel.app", targetRole: "admin" });

        result = {
          profile: {
            id: userData.id,
            instId: userData.institute_id || '',
            email: userData.email, 
            name: userData.full_name, 
            role: userData.role, 
            subjects: formattedTeacherSubjects || userData.subjects || userData.operator_profiles?.[0]?.subjects || 'Not Assigned',
            institute: userData.institutes?.institute_name, 
            code: userData.institutes?.institute_code || userData.institutes?.code || '',
            logo: userData.institutes?.logo_url || userData.institutes?.logo || userData.institutes?.institute_logo || '', 
            profilePic: userData.profile_pic_url,
            toggles: {
                attendance: attEnabled,
                admission: admEnabled,
                fee: feeEnabled
            },
            // 🔥 THE FIX: Injecting the apps into the dashboard payload so the frontend draws them!
            dynamicApps: generatedApps,
            instDetails: {
                ...userData.institutes,
                plan: mainPlan,
                startDate: mainStart,
                renewal: mainRenew,
                purchaseValue: mainValue,
                papersTotal: papersTotal,
                papersLeft: papersLeft,
                rcTotal: rcTotal,
                rcLeft: rcLeft,
                acTotal: acTotal,
                acLeft: acLeft,
                smsTotal: smsTotal,
                smsRemaining: smsRemaining
            }
          },
          // ... (keep data, notifications, and stats objects exactly the same as before)
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
            const { data: allInst } = await supabase.from('institutes').select('*');
            const { data: allOps } = await supabase.from('users').select('*, operator_profiles(*)').eq('role', 'operator');
            result.superAdmin = {
                kpi: { totalRev: 0, activeInst: allInst?.length || 0, pendingPay: 0, docsGen: safeJobs.length },
                institutes: (allInst || []).map(i => ({ code: i.institute_code || i.code || '', name: i.institute_name, plan: 'Checking Subs...', status: i.is_active ? 'Active' : 'Inactive', rc: 0, ac: 0, papers: 0, toggles: { attendance: "NO", admission: "NO", fee: "NO" } })),
                operatorList: (allOps || []).map(o => ({ name: o.full_name, role: o.role, status: o.status, pending: 0, assigned: 0, completed: 0, totalEarnings: 0, clearedEarnings: 0, pendingPayouts: 0, upi: o.operator_profiles[0]?.upi })),
                transactions: []
            };
        }
        break;

      // ==========================================
      // JOB CREATION - PAPERS
      // ==========================================
      case "submitPaperJob":
        const { data: dbUser, error: submitUserErr } = await supabase.from('users').select('id, institute_id').eq('auth_user_id', userContext.id).single();
        if (submitUserErr || !dbUser) throw new Error("Security Error: Account mapping invalid.");

        const userUUID = dbUser.id;
        const instUUID = dbUser.institute_id;

        const { data: dbInst } = await supabase.from('institutes').select('*').eq('id', instUUID).single();
        if (!dbInst) throw new Error("Security Error: Institute mapping invalid.");

        // 🔥 THE NEW SUBSCRIPTION GATEKEEPER
        const { data: paperFeature } = await supabase
            .from('subscription_features')
            .select('*, subscriptions!inner(status, payment_status, expiry_date)')
            .eq('subscriptions.institute_id', instUUID)
            .eq('subscriptions.status', 'Active')
            .eq('feature_key', 'paper_formatter')
            .single();

        if (!paperFeature) throw new Error("Subscription Required: Paper Formatter module not found or active.");
        if (paperFeature.subscriptions.payment_status !== 'Paid' && paperFeature.subscriptions.payment_status !== 'Trial') throw new Error("Billing Error: Payment is pending or failed.");
        if (paperFeature.subscriptions.expiry_date && new Date(paperFeature.subscriptions.expiry_date) < new Date()) throw new Error("Subscription Expired: Please renew your plan.");
        if (paperFeature.remaining <= 0) throw new Error("Quota Exhausted: You have 0 papers remaining. Please recharge.");

        const instCode = dbInst.institute_code || dbInst.code || "INST";
        const instName = dbInst.institute_name || "Unknown Institute";
        const jobTypeStr = payload.jobType || "Paper";
        const currentYearStr = new Date().getFullYear().toString().slice(-2);

        const { data: latestJobs } = await supabase.from('jobs_queue').select('job_code').eq('institute_id', instUUID).eq('job_type', jobTypeStr).order('created_at', { ascending: false }).limit(1);
        let nextNum = 1;
        if (latestJobs && latestJobs.length > 0) {
            const match = latestJobs[0].job_code.match(/\d+$/);
            if (match) nextNum = parseInt(match[0], 10) + 1;
        }
        const universalJobId = `${instCode}-PPR-${currentYearStr}-${String(nextNum).padStart(4, '0')}`;

        let ext = payload.mimeType === "application/pdf" ? ".pdf" : "";
        if (payload.fileName && payload.fileName.includes('.')) ext = '.' + payload.fileName.split('.').pop();
        const finalFileName = `${universalJobId}${ext}`;

        let baseFolderId = process.env.DRIVE_ROOT_FOLDER_ID || '1U0hXB394ogLsfRCpjbtR-XU48B_Xutzt';
        let finalFolderId = baseFolderId;

        if (payload.fileBase64) {
            const level2_InstName = await getOrCreateFolder(instName, baseFolderId);
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
            job_code: universalJobId, institute_id: instUUID, job_type: jobTypeStr, requester_id: userUUID, operator_id: assignedOperatorId,
            status: 'Pending', raw_file_url: paperDriveUrl, deadline: deadlineDate.toISOString(),
            meta_data: { class: payload.className, exam_name: payload.examName, subject: payload.subject, test_type: payload.testType, test_no: payload.testNo, test_date: payload.testDate || payload.docDate, num_students: payload.numStudents, duration: payload.duration, questions: payload.numQuestions, full_marks: payload.fullMarks, pass_marks: payload.passMarks, teacher_name: payload.teacherName }
        }]);

        if (submitDbError) throw new Error("Database Write Failed: " + submitDbError.message);
        
        // 🔥 THE NEW LEDGER DEDUCTION
        await supabase.from('subscription_features').update({ used: paperFeature.used + 1, remaining: paperFeature.remaining - 1 }).eq('id', paperFeature.id);
        
        result = { success: true, jobId: universalJobId };
        break;
        
      // ==========================================
      // JOB CREATION - DOCUMENTS
      // ==========================================
      case "submitDocumentJob":
        const { data: docUser } = await supabase.from('users').select('id, institute_id').eq('auth_user_id', userContext.id).single();
        
        // 🔥 THE NEW SUBSCRIPTION GATEKEEPER
        const featureTarget = payload.docType === 'Report Card' ? 'report_cards' : 'admit_cards';
        const { data: docFeature } = await supabase
            .from('subscription_features')
            .select('*, subscriptions!inner(status, payment_status, expiry_date)')
            .eq('subscriptions.institute_id', docUser.institute_id)
            .eq('subscriptions.status', 'Active')
            .eq('feature_key', featureTarget)
            .single();

        if (!docFeature) throw new Error(`Subscription Required: ${payload.docType} module not found or active.`);
        if (docFeature.subscriptions.payment_status !== 'Paid' && docFeature.subscriptions.payment_status !== 'Trial') throw new Error("Billing Error: Payment is pending or failed.");
        if (docFeature.remaining <= 0) throw new Error(`${payload.docType} quota exhausted! Please recharge.`);

        let docDriveUrl = payload.fileBase64 ? await uploadToGoogleDrive(payload.fileBase64, payload.fileName, payload.mimeType) : "";
        const docJobId = `TK-D-${Math.floor(1000 + Math.random() * 9000)}`;
        
        await supabase.from('jobs_queue').insert([{
            job_code: docJobId, institute_id: docUser.institute_id, job_type: payload.docType,
            requester_id: docUser.id, status: 'Pending', raw_file_url: docDriveUrl,
            meta_data: { class: payload.className, exam_name: payload.examName, num_students: payload.numStudents }
        }]);

        // 🔥 THE NEW LEDGER DEDUCTION
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

        // 🔥 THE FIX: Strict JSON handling to force a clean database overwrite
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
        // 1. Create Institute
        const { data: newInst } = await supabase.from('institutes').insert([{
            code: payload.instCode, institute_name: payload.instName, is_active: true
        }]).select().single();

        // 2. Create Auth & User mapping
        const { data: instAuth } = await supabase.auth.admin.createUser({ email: payload.adminEmail, password: "TKadmin123", email_confirm: true });
        await supabase.from('users').insert([{
            auth_user_id: instAuth.user.id, email: payload.adminEmail, full_name: payload.clientName || "Admin",
            role: 'admin', institute_id: newInst.id, institute_code: payload.instCode, status: 'Active'
        }]);

        // 3. Create initial Subscription & Features based on their selection
        const { data: initialSub } = await supabase.from('subscriptions').insert([{
            institute_id: newInst.id, subscription_type: "Complete ERP", plan_name: payload.planType,
            billing_cycle: "Yearly", status: "Active", payment_status: "Trial",
            start_date: new Date().toISOString(),
            purchase_value: 0
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
        await supabase.from('users').insert([{
            auth_user_id: tchrAuth.user.id, email: payload.email, full_name: payload.name,
            role: 'teacher', institute_code: payload.instCode, status: 'Active', profile_pic_url: payload.photoUrl
        }]);
        result = { success: true };
        break;

      case "submitOperatorRegistration":
        const { data: opAuth } = await supabase.auth.admin.createUser({ email: payload.email, password: "TKoperator123", email_confirm: true });
        const { data: newOp } = await supabase.from('users').insert([{
            auth_user_id: opAuth.user.id, email: payload.email, full_name: payload.name,
            role: 'operator', status: 'Active', profile_pic_url: payload.photoUrl
        }]).select().single();
        
        await supabase.from('operator_profiles').insert([{
            user_id: newOp.id, subjects: payload.subjects, work_type: payload.workType, 
            rate_paper: payload.ratePaper, rate_unit: payload.rateUnit, upi: payload.upi
        }]);
        result = { success: true };
        break;

      case "updateOperatorDetails":
        const { data: opUser } = await supabase.from('users').select('id').eq('full_name', payload.originalName).single();
        if(opUser) {
           await supabase.from('users').update({ status: payload.status }).eq('id', opUser.id);
           await supabase.from('operator_profiles').update({ subjects: payload.subjects, work_type: payload.workType, rate_paper: payload.ratePaper, rate_unit: payload.rateUnit }).eq('user_id', opUser.id);
        }
        result = { success: true };
        break;

      case "assignJobToOperator":
        const { data: opToAssign } = await supabase.from('users').select('id, device_tokens').eq('full_name', payload.operatorName).single();
        if(opToAssign) {
            await supabase.from('jobs_queue').update({ operator_id: opToAssign.id, status: 'Assigned' }).eq('job_code', payload.jobId);
            if (opToAssign.device_tokens) {
               await sendPushNotification(opToAssign.device_tokens.split(','), "New Job Assigned", `Job ${payload.jobId} assigned to you.`);
            }
        }
        result = { success: true, message: `Job officially assigned.` };
        break;

      case "toggleInstituteApp":
        const { data: instData } = await supabase.from('institutes').select('id').eq('code', payload.instCode).single();
        
        // Find mapping
        const featureKeyMap = { 'attendance': 'attendance', 'admission': 'admission', 'fee': 'fee_collection' };
        const fKey = featureKeyMap[payload.appType];
        
        // Find active feature
        const { data: toggleFeat } = await supabase
            .from('subscription_features')
            .select('*, subscriptions!inner(institute_id, status)')
            .eq('subscriptions.institute_id', instData.id)
            .eq('subscriptions.status', 'Active')
            .eq('feature_key', fKey)
            .single();

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
        let newMeta = jobInfo?.meta_data || {};
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
