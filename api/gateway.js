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


// ==========================================
    // 🚀 MASTER PUSH DISPATCH ENGINE
    // ==========================================
    async function dispatchPushNotification(targetUserId, title, message) {
        try {
            // 1. Find all active devices for this user
            const { data: sessions } = await supabase
                .from('user_sessions')
                .select('fcm_token, preferences')
                .eq('user_id', targetUserId)
                .eq('is_active', true)
                .not('fcm_token', 'is', null);

            if (!sessions || sessions.length === 0) return false;

            // 2. Filter: ONLY send to devices where 'push' is toggled ON
            const validTokens = sessions
                .filter(s => s.preferences && s.preferences.push === true)
                .map(s => s.fcm_token);

            if (validTokens.length === 0) return false;

            // 3. Dispatch using your existing firebase.js function
            await sendPushNotification(validTokens, title, message);
            return true;
        } catch (e) {
            console.error("Push Dispatch Failed:", e.message);
            return false;
        }
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

      // 🔥 STRICT FCM REGISTRATION ENGINE
      case "registerDeviceToken": {
        // 1. Force a failure if the payload is missing data
        if (!payload.sessionId) throw new Error("Backend Error: Session ID is missing.");
        if (!payload.fcmToken) throw new Error("Backend Error: FCM Token is missing.");

        // 2. Perform the update AND force Supabase to return the row (.select)
        const { data: updatedRow, error: updateErr } = await supabase
            .from('user_sessions')
            .update({ fcm_token: payload.fcmToken })
            .eq('id', payload.sessionId)
            .select(); // This ensures we get proof it actually updated

        // 3. Catch Supabase Schema/Database Errors
        if (updateErr) throw new Error("Supabase Error: " + updateErr.message);

        // 4. Catch "Ghost Update" Errors (It tried to update, but the row didn't exist)
        if (!updatedRow || updatedRow.length === 0) {
            throw new Error(`Database Error: Session ID [${payload.sessionId}] does not exist in user_sessions table.`);
        }

        result = { success: true };
        break;
      }
      // ==========================================
      // DASHBOARD DATA AGGREGATOR (ULTRA-FAST PARALLEL QUERIES)
      // ==========================================
      case "getDashboardPayload": {
        const { data: userData, error: userErr } = await supabase
            .from('users')
            .select('*, institutes(*), operator_profiles(*)')
            .eq('auth_user_id', userContext.id)
            .single();
            
        if (userErr || !userData) throw new Error("User profile corrupted.");

        const dashRole = String(userData.role).trim().toLowerCase();
        const dashInstUUID = userData.institute_id;
        const dashUserUUID = userData.id;

        // 🔥 ENTERPRISE THIN-CLIENT ARCHITECTURE: Max 50 Jobs on initial load
        let jobsQuery = supabase.from('jobs_queue')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        
        if (dashRole === 'teacher') jobsQuery = jobsQuery.eq('requester_id', dashUserUUID);
        else if (dashRole === 'admin') jobsQuery = jobsQuery.eq('institute_id', dashInstUUID);
        else if (dashRole === 'operator') jobsQuery = jobsQuery.or(`operator_id.eq.${dashUserUUID},operator_id.is.null`);

        const notifQuery = supabase.from('notifications')
            .select('*')
            .or(`target_users.cs.{${dashUserUUID}},target_roles.cs.{${dashRole}}`)
            .order('created_at', { ascending: false })
            .limit(30);

        const [subsRes, teacherRes, jobsRes, notifsRes, allInstRes] = await Promise.all([
            supabase.from('subscriptions').select('*, subscription_features(*)').eq('institute_id', dashInstUUID).eq('status', 'Active'),
            supabase.from('teacher_profiles').select('subject_handles').eq('user_id', dashUserUUID).maybeSingle(),
            jobsQuery,
            notifQuery,
            supabase.from('institutes').select('id, institute_name') 
        ]);

        const activeSubs = subsRes.data || [];
        const safeJobs = jobsRes.data || [];
        const safeNotifs = notifsRes.data || [];

        const instMap = {};
        if (allInstRes.data) {
            allInstRes.data.forEach(inst => {
                instMap[inst.id] = inst.institute_name;
            });
        }
        
        let formattedTeacherSubjects = teacherRes.data?.subject_handles ? (Array.isArray(teacherRes.data.subject_handles) ? teacherRes.data.subject_handles.join(', ') : teacherRes.data.subject_handles) : null;

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
            toggles: { attendance: attEnabled, admission: admEnabled, fee: feeEnabled },
            dynamicApps: generatedApps,
            instDetails: {
                ...userData.institutes,
                plan: mainPlan, startDate: mainStart, renewal: mainRenew, purchaseValue: mainValue,
                papersTotal: papersTotal, papersLeft: papersLeft, rcTotal: rcTotal, rcLeft: rcLeft,
                acTotal: acTotal, acLeft: acLeft, smsTotal: smsTotal, smsRemaining: smsRemaining
            },
            upi: userData.operator_profiles?.[0]?.upi_id || userData.operator_profiles?.[0]?.upi || '',
            readNotifs: userContext.user_metadata?.read_notifs || [],
            
            // 🔥 THIS IS WHERE THE PREFERENCES LINE GOES:
            preferences: userContext.user_metadata?.preferences || { push: false, whatsapp: false, sms: false, email: false }
          },
          data: {
            papers: safeJobs.filter(j => j.job_type === 'Paper').map(j => ({ 
                id: j.job_code, date: j.created_at, inst: instMap[j.institute_id] || userData.institutes?.institute_name || 'Unknown', class: j.meta_data?.class || '', subject: j.meta_data?.subject || '', exam: j.meta_data?.test_type || '', deadline: j.deadline || 'No Deadline', status: j.status, row: j.final_file_url || j.raw_file_url || '', latestCorrectionNote: j.meta_data?.latest_correction_note || ''
            })),
            docs: safeJobs.filter(j => j.job_type !== 'Paper').map(j => ({ 
                id: j.job_code, date: j.created_at, inst: instMap[j.institute_id] || userData.institutes?.institute_name || 'Unknown', class: j.meta_data?.class || '', type: j.job_type, exam: j.meta_data?.exam_name || '', students: j.meta_data?.num_students || 0, deadline: j.deadline || 'No Deadline', status: j.status, row: j.final_file_url || j.raw_file_url || '', latestCorrectionNote: j.meta_data?.latest_correction_note || ''
            })),
            myBilling: [], instTeachers: [], instStudents: []
          },
          notifications: safeNotifs.map(n => ({ 
              title: n.title, 
              msg: n.message, 
              time: new Date(n.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }), 
              isRead: n.status === 'read',
              refId: n.reference_id 
          })),
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
      }
        
      case "updatePreferences": {
        if (!payload.sessionId) throw new Error("No active device session ID found. Please refresh the dashboard.");

        // 1. Fetch the specific device session using the Session ID
        const { data: sessionData } = await supabase
            .from('user_sessions')
            .select('id, preferences')
            .eq('id', payload.sessionId)
            .single();
            
        if (!sessionData) throw new Error("Session row not found in database.");

        // 2. Merge and save the new preferences
        const currentPrefs = sessionData.preferences || { push: false, whatsapp: false, sms: false, email: false };
        currentPrefs[payload.type] = payload.value;
        
        await supabase.from('user_sessions').update({ preferences: currentPrefs }).eq('id', sessionData.id);
        
        result = { success: true };
        break;
      }

      // ==========================================
      // DEVICE FINGERPRINTING & SESSION TRACKING
      // ==========================================
      case "syncDeviceSession": {
        const { data: dbUser } = await supabase.from('users').select('id').eq('auth_user_id', userContext.id).single();
        if (!dbUser) throw new Error("Security Error: User not found.");

        let currentSessionId = payload.sessionId;

        // Try to update the existing device session if we have an ID
        if (currentSessionId) {
            const { data: existing } = await supabase.from('user_sessions').select('id, preferences').eq('id', currentSessionId).single();
            if (existing) {
                await supabase.from('user_sessions').update({
                    device_name: payload.deviceName,
                    device_type: payload.deviceType,
                    browser: payload.browser,
                    ip_address: payload.ipAddress,
                    last_seen: new Date().toISOString()
                }).eq('id', currentSessionId);
                
                // 🔥 Return the saved preferences for this specific device
                result = { 
                    success: true, 
                    sessionId: currentSessionId, 
                    preferences: existing.preferences || { push: false, whatsapp: false, sms: false, email: false } 
                };
                break;
            }
        }

        // If no session ID exists, create a brand new session row
        const defaultPrefs = { push: false, whatsapp: false, sms: false, email: false };
        const { data: newSession, error: insertErr } = await supabase.from('user_sessions').insert([{
            user_id: dbUser.id,
            device_name: payload.deviceName,
            device_type: payload.deviceType,
            browser: payload.browser,
            ip_address: payload.ipAddress,
            is_active: true,
            last_seen: new Date().toISOString(),
            preferences: defaultPrefs
        }]).select('id, preferences').single();

        if (insertErr) throw new Error("Failed to log session: " + insertErr.message);

        result = { success: true, sessionId: newSession.id, preferences: newSession.preferences };
        break;
      }
        
      // ==========================================
      // JOB CREATION - PAPERS
      // ==========================================
      case "submitPaperJob": { 
        const { data: dbUser } = await supabase.from('users').select('id, institute_id').eq('auth_user_id', userContext.id).single();
        if (!dbUser) throw new Error("Security Error: Account mapping invalid.");
        const instUUID = dbUser.institute_id;

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
        const { data: opData } = await supabase
            .from('users')
            .select('id, operator_profiles!inner(subjects, work_types)')
            .eq('role', 'operator')
            .eq('status', 'Active');

        if (opData && opData.length > 0) {
            const matchingOps = opData.filter(op => {
                const profile = Array.isArray(op.operator_profiles) ? op.operator_profiles[0] : op.operator_profiles;
                if (!profile) return false;
                
                const safeWork = JSON.stringify(profile.work_types || []).toLowerCase();
                const safeSubj = JSON.stringify(profile.subjects || []).toLowerCase();
                
                const handlesWork = safeWork.includes('paper'); 
                const handlesSubject = payload.subject 
                    ? (safeSubj.includes(payload.subject.toLowerCase()) || (payload.subject.toLowerCase() === 'mathematics' && safeSubj.includes('math'))) 
                    : true;
                    
                return handlesWork && handlesSubject;
            });
            
            if (matchingOps.length > 0) {
                assignedOperatorId = matchingOps[Math.floor(Math.random() * matchingOps.length)].id;
            }
        }

        const { error: submitDbError } = await supabase.from('jobs_queue').insert([{
            job_code: universalJobId, 
            institute_id: instUUID, 
            job_type: jobTypeStr, 
            requester_id: dbUser.id, 
            operator_id: assignedOperatorId, 
            status: assignedOperatorId ? 'Assigned' : 'Pending', 
            raw_file_url: paperDriveUrl, 
            deadline: deadlineDate.toISOString(),
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
       
        let targetUserArr = assignedOperatorId ? [assignedOperatorId] : [];
        let targetRoleArr = assignedOperatorId ? [] : ['operator', 'system admin', 'super admin'];

        const { error: notifErr } = await supabase.from('notifications').insert([{
            sender_id: dbUser.id,
            institute_id: instUUID,
            title: assignedOperatorId ? "New Job Assigned" : "New Job in Queue",
            message: assignedOperatorId ? `Job ${universalJobId} has been assigned to your queue.` : `Job ${universalJobId} is pending assignment.`,
            type: "job_assigned",
            status: "sent",
            reference_id: universalJobId,
            target_roles: targetRoleArr,       
            target_users: targetUserArr        
        }]);

        if (notifErr) console.error("Notification DB Error (Paper):", notifErr);
        // 🔥 EXPLICIT INLINE PUSH (Matches your Broadcast Engine)
        if (assignedOperatorId) {
            const { data: opSessions } = await supabase
                .from('user_sessions')
                .select('fcm_token, preferences')
                .eq('user_id', assignedOperatorId)
                .eq('is_active', true)
                .not('fcm_token', 'is', null);

            if (opSessions && opSessions.length > 0) {
                const validTokens = opSessions
                    .filter(s => s.preferences && s.preferences.push === true)
                    .map(s => s.fcm_token);

                if (validTokens.length > 0) {
                    await sendPushNotification(validTokens, "New Paper Job Assigned", `Paper Job ${universalJobId} has been assigned to your queue.`);
                } else {
                    console.log("Push bypassed: Operator has push toggled OFF or no valid tokens.");
                }
            }
        }
        
        result = { success: true, jobId: universalJobId };
        break;
      }

      // ==========================================
      // JOB CREATION - DOCUMENTS
      // ==========================================
      case "submitDocumentJob": { 
        const { data: docUserObj } = await supabase.from('users').select('id, institute_id').eq('auth_user_id', userContext.id).single();
        const docInstUUID = docUserObj.institute_id;

        const documentTypeStr = payload.jobType; 
        const featureTarget = documentTypeStr === 'Report Card' ? 'report_cards' : 'admit_cards';
        
        const [docInstRes, docFeatureRes] = await Promise.all([
            supabase.from('institutes').select('*').eq('id', docInstUUID).single(),
            supabase.from('subscription_features').select('*, subscriptions!inner(status, payment_status, expiry_date)').eq('subscriptions.institute_id', docInstUUID).eq('subscriptions.status', 'Active').eq('feature_key', featureTarget).single()
        ]);

        const docFeature = docFeatureRes.data;
        if (!docFeature) throw new Error(`Subscription Required: ${documentTypeStr} module not found.`);
        if (docFeature.subscriptions.payment_status !== 'Paid' && docFeature.subscriptions.payment_status !== 'Trial') throw new Error("Billing Error: Payment is pending.");
        if (docFeature.subscriptions.expiry_date && new Date(docFeature.subscriptions.expiry_date) < new Date()) throw new Error("Subscription Expired.");
        if (docFeature.remaining <= 0) throw new Error(`${documentTypeStr} quota exhausted! Please recharge.`);

        const docInstCode = docInstRes.data?.institute_code || docInstRes.data?.code || "INST";
        const jobTypeCodes = { "Report Card": "RC", "Admit Card": "AC", "ID Card": "ID", "Certificate": "CERT" };
        const docTypeCode = jobTypeCodes[documentTypeStr] || "DOC";
        const currentDocYearStr = new Date().getFullYear().toString().slice(-2);

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
        
        const docDeadlineDate = new Date();
        docDeadlineDate.setHours(docDeadlineDate.getHours() + 48);

        let assignedOperatorId = null; 
        const { data: opDocData } = await supabase
            .from('users')
            .select('id, operator_profiles!inner(work_types)')
            .eq('role', 'operator')
            .eq('status', 'Active');

        if (opDocData && opDocData.length > 0) {
            const matchingOps = opDocData.filter(op => {
                const profile = Array.isArray(op.operator_profiles) ? op.operator_profiles[0] : op.operator_profiles;
                if (!profile) return false;
                
                const safeWork = JSON.stringify(profile.work_types || []).toLowerCase();
                return safeWork.includes(documentTypeStr.toLowerCase()) || safeWork.includes('card');
            });
            
            if (matchingOps.length > 0) {
                assignedOperatorId = matchingOps[Math.floor(Math.random() * matchingOps.length)].id;
            }
        }

        await supabase.from('jobs_queue').insert([{
            job_code: docJobId, 
            institute_id: docInstUUID, 
            job_type: documentTypeStr, 
            requester_id: docUserObj.id, 
            operator_id: assignedOperatorId, 
            status: assignedOperatorId ? 'Assigned' : 'Pending', 
            raw_file_url: docDriveUrl,
            deadline: docDeadlineDate.toISOString(),
            meta_data: { 
                class: payload.className ? payload.className.toUpperCase() : "", 
                exam_name: payload.examName ? payload.examName.toUpperCase() : "", 
                num_students: payload.num_students || payload.numStudents 
            }
        }]);

        await supabase.from('subscription_features').update({ used: docFeature.used + 1, remaining: docFeature.remaining - 1 }).eq('id', docFeature.id);

        let docTargetUserArr = assignedOperatorId ? [assignedOperatorId] : [];
        let docTargetRoleArr = assignedOperatorId ? [] : ['operator', 'system admin', 'super admin'];

        const { error: notifErr } = await supabase.from('notifications').insert([{
            sender_id: docUserObj.id,
            institute_id: docInstUUID,
            title: assignedOperatorId ? "New Document Assigned" : "New Document in Queue",
            message: assignedOperatorId ? `Document Job ${docJobId} has been assigned to your queue.` : `Document ${docJobId} is pending assignment.`,
            type: "job_assigned",
            status: "sent",
            reference_id: docJobId,
            target_roles: docTargetRoleArr,
            target_users: docTargetUserArr
        }]);

        if (notifErr) console.error("Notification DB Error (Doc):", notifErr);
        
        // 🔥 EXPLICIT INLINE PUSH (Matches your Broadcast Engine)
        if (assignedOperatorId) {
            const { data: docSessions } = await supabase
                .from('user_sessions')
                .select('fcm_token, preferences')
                .eq('user_id', assignedOperatorId)
                .eq('is_active', true)
                .not('fcm_token', 'is', null);

            if (docSessions && docSessions.length > 0) {
                const docTokens = docSessions
                    .filter(s => s.preferences && s.preferences.push === true)
                    .map(s => s.fcm_token);

                if (docTokens.length > 0) {
                    await sendPushNotification(docTokens, "New Document Assigned", `Document Job ${docJobId} has been assigned to your queue.`);
                }
            }
        }

        result = { success: true, jobId: docJobId };
        break;
      }
     
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
        await supabase.from('operator_profiles').insert([{ user_id: newOp.id, subjects: payload.subjects, work_type: payload.workType, rate_paper: payload.ratePaper, rate_unit: payload.rateUnit, upi_id: payload.upi }]);
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

      case "assignJobToOperator": {
        const { data: opToAssign } = await supabase.from('users').select('id').eq('full_name', payload.operatorName).single();
        if(opToAssign) {
            await supabase.from('jobs_queue').update({ operator_id: opToAssign.id, status: 'Assigned' }).eq('job_code', payload.jobId);
            
            // 🔥 NEW: USE THE SMART PUSH ENGINE
            await dispatchPushNotification(opToAssign.id, "New Job Assigned", `Job ${payload.jobId} assigned to you.`);
        }
        result = { success: true, message: `Job officially assigned.` };
        break;
      }

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

     // ==========================================
      // MANUAL SYSTEM BROADCASTS & FCM PUSH
      // ==========================================
      case "sendNotification": {
        let rolesArr = [];
        let instScope = null; 

        // 1. Determine Scope
        if (payload.targetRaw === 'all_operators') rolesArr = ['operator'];
        else if (payload.targetRaw === 'all_teachers') rolesArr = ['teacher'];
        else if (payload.targetRaw === 'all_admins') rolesArr = ['admin'];
        else if (payload.targetRaw === 'global') rolesArr = ['operator', 'teacher', 'admin', 'system admin', 'super admin'];
        else if (payload.targetRaw === 'inst_teachers') { 
            rolesArr = ['teacher']; 
            instScope = userContext.user_metadata?.institute_id || null; 
        }

        const { data: senderObj } = await supabase.from('users').select('id, institute_id').eq('auth_user_id', userContext.id).single();
        if (payload.targetRaw === 'inst_teachers' && !instScope && senderObj) {
            instScope = senderObj.institute_id;
        }

        // 🔥 2. FETCH TARGET USERS
        let usersQuery = supabase.from('users').select('id').in('role', rolesArr);
        if (instScope) usersQuery = usersQuery.eq('institute_id', instScope);
        
        const { data: targetUsers, error: userErr } = await usersQuery;
        if (userErr) console.error("User Fetch Error:", userErr);
        
        const targetUserIds = targetUsers ? targetUsers.map(u => u.id) : [];

        // 🔥 3. FETCH ACTIVE FCM TOKENS FROM user_sessions
        let allTokens = [];
        if (targetUserIds.length > 0) {
            const { data: activeSessions, error: sessionErr } = await supabase
                .from('user_sessions')
                .select('fcm_token')
                .in('user_id', targetUserIds)
                .eq('is_active', true)
                .not('fcm_token', 'is', null);

            if (sessionErr) console.error("Session Fetch Error:", sessionErr);

            if (activeSessions) {
                // Extract tokens and filter out any empty strings
                allTokens = activeSessions.map(s => s.fcm_token).filter(t => t.trim() !== "");
            }
        }

        // 🔥 4. FIRE THE OUT-OF-APP PUSH NOTIFICATION (FCM)
        if (allTokens.length > 0) {
            const uniqueTokens = [...new Set(allTokens)];
            try {
                await sendPushNotification(uniqueTokens, payload.title, payload.msg);
                console.log(`FCM Deployed to ${uniqueTokens.length} active sessions.`);
            } catch (fcmErr) {
                console.error("FCM Broadcast Error:", fcmErr);
            }
        }

        // 5. LOG TO DATABASE FOR IN-APP WEBSOCKET UI
        const { error: notifErr } = await supabase.from('notifications').insert([{ 
            sender_id: senderObj ? senderObj.id : null,
            institute_id: instScope,
            title: payload.title, 
            message: payload.msg,
            type: "system_broadcast",
            status: "sent",
            reference_id: "SYS-ALERT", 
            target_roles: rolesArr,
            target_users: []
        }]);

        if (notifErr) console.error("Broadcast DB Error:", notifErr);

        result = { success: true, message: "Broadcast deployed successfully." };
        break;
      }
        
      case "markNotificationsRead":
        result = { success: true };
        break;

      case "getGeneratedFolderUrl":
        result = { success: true, url: "https://drive.google.com/drive/folders/" + process.env.DRIVE_ROOT_FOLDER_ID };
        break;

      case "download":
        result = { success: true, url: payload.row };
        break;
        
      // ==========================================
      // STATUS MANAGEMENT
      // ==========================================
      case "updateJobStatus": {
        const { jobId, status } = payload;
        if (!jobId || !status) throw new Error("Missing parameters.");
        
        const { data: jobData, error: fetchErr } = await supabase
            .from('jobs_queue')
            .select('meta_data')
            .eq('job_code', jobId)
            .single();
            
        if (fetchErr || !jobData) throw new Error(`Fetch Error: ${fetchErr?.message || 'Job not found'}`);

        const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        
        let meta = typeof jobData.meta_data === 'string' ? JSON.parse(jobData.meta_data) : (jobData.meta_data || {});
        let timeline = meta.history || [];
        
        const lastMsg = timeline.length > 0 ? timeline[timeline.length - 1].message : "";
        if (!lastMsg.includes(`updated to ${status}`)) {
            timeline.push({
                type: 'system',
                actorName: 'System',
                actorRole: 'automation',
                message: `Operator launched workspace. Status officially updated to ${status}.`,
                timestamp: istTime
            });
        }
        
        meta.history = timeline;

        const { error: updateErr } = await supabase
            .from('jobs_queue')
            .update({ status: status, meta_data: meta })
            .eq('job_code', jobId);
            
        if (updateErr) throw new Error(`Database Rejected: ${updateErr.message}`);

        result = { success: true, message: `Status securely changed to ${status}` };
        break;
      }

case "updateOperatorUpi": {
        // 1. Find the internal user ID using the secure Auth Context
        const { data: opUser } = await supabase
            .from('users')
            .select('id')
            .eq('auth_user_id', userContext.id)
            .single();

        if (!opUser) throw new Error("Security Error: Operator account not found.");

        // 2. Update the upi_id column in operator_profiles
        const { error: upiErr } = await supabase
            .from('operator_profiles')
            .update({ upi_id: payload.upi })
            .eq('user_id', opUser.id);

        if (upiErr) throw new Error("Database Error: " + upiErr.message);

        // 3. Return success to the frontend
        result = { success: true, message: "UPI ID saved securely." };
        break;
      }
        
      // ==========================================
      // SCALABLE COMMUNICATION ENGINE
      // ==========================================
      case "getJobTimeline": {
        const { data: messages, error: msgErr } = await supabase
            .from('job_communications')
            .select('*')
            .eq('job_code', payload.jobId)
            .order('created_at', { ascending: true });

        if (msgErr) throw new Error("Failed to load communications: " + msgErr.message);

        let historyArr = (messages || []).map(msg => ({
            type: msg.message_type,
            actorName: msg.actor_name,
            actorRole: msg.actor_role,
            message: msg.message,
            timestamp: new Date(msg.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
        }));

        if (historyArr.length === 0) {
            const { data: jobData } = await supabase.from('jobs_queue').select('created_at').eq('job_code', payload.jobId).single();
            if (jobData) {
                let createdDate = new Date(jobData.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
                historyArr.push({ type: 'system', actorName: 'System', actorRole: 'automation', message: 'Job created securely.', timestamp: createdDate });
            }
        }

        result = { success: true, history: historyArr };
        break;
      }
      
      case "addJobTimelineEvent": {
        const { data: currentJob } = await supabase.from('jobs_queue').select('meta_data, status, requester_id, operator_id, institute_id').eq('job_code', payload.jobId).single();
        if (!currentJob) throw new Error("Job not found.");

        const { error: insertErr } = await supabase.from('job_communications').insert([{
            job_code: payload.jobId,
            actor_name: payload.actorName || 'User',
            actor_role: payload.actorRole || 'Unknown',
            message_type: payload.mode === 'revision' ? 'revision' : 'note',
            message: payload.message
        }]);

        if (insertErr) throw new Error("Failed to send message: " + insertErr.message);

        let meta = typeof currentJob.meta_data === 'string' ? JSON.parse(currentJob.meta_data) : (currentJob.meta_data || {});
        meta.latest_correction_note = payload.message; 
        
        let updatePayload = { meta_data: meta, updated_at: new Date().toISOString() };
        if (payload.mode === 'revision') updatePayload.status = 'Pending Revision';
        await supabase.from('jobs_queue').update(updatePayload).eq('job_code', payload.jobId);

        // 🔥 THE SMART OMNICHANNEL PUB/SUB BRIDGE (Multi-User Chat Routing)
        let targetUserArr = [];
        let alertTitle = "";
        let alertMsg = "";
        let notifType = payload.mode === 'revision' ? "revision_alert" : "new_message";

        const { data: senderObj } = await supabase.from('users').select('id, role').eq('auth_user_id', userContext.id).single();
        const senderPublicId = senderObj ? senderObj.id : null;
        const senderRole = senderObj ? String(senderObj.role).toLowerCase() : 'unknown';

        if (senderRole === 'operator') {
            if (currentJob.requester_id) targetUserArr.push(currentJob.requester_id);
            alertTitle = "New Reply from Operator";
            alertMsg = `${payload.actorName} replied to job ${payload.jobId}.`;
        } 
        else if (senderRole === 'teacher') {
            if (currentJob.operator_id) targetUserArr.push(currentJob.operator_id);
            alertTitle = payload.mode === 'revision' ? "Revision Requested 🔴" : "New Note from Teacher";
            alertMsg = `${payload.actorName} added a note to job ${payload.jobId}.`;
        } 
        else {
            if (currentJob.requester_id) targetUserArr.push(currentJob.requester_id);
            if (currentJob.operator_id) targetUserArr.push(currentJob.operator_id);
            alertTitle = "Admin Message on Job " + payload.jobId;
            alertMsg = `${payload.actorName} added a note to the workspace.`;
        }

        if (senderPublicId) {
            targetUserArr = targetUserArr.filter(id => id !== senderPublicId);
        }

        if (targetUserArr.length > 0) {
            const { error: notifErr } = await supabase.from('notifications').insert([{
                sender_id: senderPublicId, 
                institute_id: currentJob.institute_id || null,
                title: alertTitle,
                message: alertMsg,
                type: notifType,
                status: "sent",
                reference_id: payload.jobId,
                target_roles: [],
                target_users: targetUserArr
            }]);

                     
            if (notifErr) console.error("Notification DB Error (Chat):", notifErr);
        }


        // 🔥 NEW: INSTANT PUSH NOTIFICATION FOR CHAT
            for (let targetId of targetUserArr) {
                await dispatchPushNotification(targetId, alertTitle, alertMsg);
            }
        }

        result = { success: true, message: "Message sent." };
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
