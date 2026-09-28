import { supabase } from '../lib/supabase.js';
import { createClient } from '@supabase/supabase-js';
import { uploadToGoogleDrive, getOrCreateFolder } from '../lib/gdrive.js';
import { sendPushNotification } from '../lib/firebase.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

// 1. Initialize Admin Client (Bypasses RLS & Email Confirmation)
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 2. Configure Gmail SMTP Transporter (Bulletproof App Password Method)
const mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'edtrimkey@gmail.com', 
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// 3. The Enterprise Welcome Email Dispatcher (Premium UI)
// ============================================================================
// ✉️ UNIVERSAL EMAIL ENGINE (RESEND) & TEMPLATE BUILDER
// ============================================================================

async function dispatchSystemEmail(toEmail, subject, htmlContent) {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) return console.warn("Email bypassed: No Resend API Key.");

    try {
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'Ed-Trim Key Alerts <alerts@ed.trimkey.in>',
                reply_to: 'hello@ed.trimkey.in',
                to: [toEmail],
                subject: subject,
                html: htmlContent
            })
        });
    } catch (error) { console.error("Resend API Error:", error); }
}

// 🏗️ THE MASTER LAYOUT: Wraps your unique content in your premium dark-mode design
function buildTkEmail(preheader, logoUrl, innerContent) {
    const defaultLogo = "https://ypmnsgpohaaavbjdqjye.supabase.co/storage/v1/object/public/logo/new-ETK.png";
    const finalLogo = logoUrl || defaultLogo;

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            @keyframes smoothBlink { 0% { opacity: 1; box-shadow: 0 0 0 rgba(38, 195, 234, 0); } 50% { opacity: 0.6; box-shadow: 0 0 12px rgba(38, 195, 234, 0.4); } 100% { opacity: 1; box-shadow: 0 0 0 rgba(38, 195, 234, 0); } }
            .animated-password { animation: smoothBlink 2.5s ease-in-out infinite; }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0B111E; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
        <div style="display: none; max-height: 0px; overflow: hidden; font-size: 0px; mso-hide: all;">${preheader}</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0B111E; padding: 60px 20px;">
            <tr><td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #141E30; border: 1px solid rgba(255, 255, 255, 0.08); border-top: 4px solid #26C3EA; border-radius: 12px;">
                    <tr>
                        <td style="padding: 40px; background: linear-gradient(145deg, #1A2639, #141E30); border-bottom: 1px solid rgba(255, 255, 255, 0.05); text-align: center;">
                            <img src="${finalLogo}" style="width: 56px; height: 56px; border-radius: 14px; border: 1px solid rgba(38, 195, 234, 0.25); margin-bottom: 16px; background-color: #ffffff; object-fit: contain;">
                            <h1 style="color: #26C3EA; margin: 0 0 6px 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">Ed Trim Key</h1>
                            <p style="color: #FFFFFF; margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase;">Academic digital workflow</p>
                        </td>
                    </tr>
                    ${innerContent}
                </table>
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto;">
                    <tr>
                        <td style="padding: 40px 40px 20px 40px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                            <h4 style="color: #94A3B8; font-size: 14px; font-weight: 600; margin: 0 0 8px 0;">Ed-Trim Key Systems</h4>
                            <p style="color: #64748B; font-size: 13px; margin: 0;">Lok Vihar Colony, Lalpur<br>Ranchi, Jharkhand, India<br>
                            <a href="mailto:support@ed.trimkey.in" style="color: #26C3EA; text-decoration: none;">support@ed.trimkey.in</a></p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 24px 40px 32px 40px; text-align: center;">
                            <p style="color: #475569; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} Ed-Trim Key Systems. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td></tr>
        </table>
    </body>
    </html>`;
}

// 📦 THE TEMPLATE ROUTER: Injects your dynamic data into the correct HTML blocks
const EmailTemplates = {
    // 1. Institute Admin Welcome
    adminWelcome: (data) => buildTkEmail(
        `Your requested Institute Admin access for ${data.instName} has been successfully provisioned.`,
        data.logoUrl,
        `<tr><td style="padding: 35px 40px 10px 40px;">
            <h2 style="color: #F1F5F9; margin: 0 0 15px 0; font-size: 20px;">Welcome to your workspace,</h2>
            <p style="color: #94A3B8; font-size: 15px; line-height: 24px;">Hello ${data.name},<br><br>Your environment has been successfully deployed. You have been securely provisioned with the following access parameters:</p>
            <table width="100%" style="background: rgba(38, 195, 234, 0.04); border-left: 3px solid #26C3EA; border-radius: 4px; padding: 18px; margin-bottom: 28px;">
                <tr><td style="padding-bottom: 10px;"><span style="color: #64748B; font-size: 12px; text-transform: uppercase; font-weight: 600;">Organization</span><br><strong style="color: #F1F5F9; font-size: 16px;">${data.instName}</strong></td></tr>
                <tr><td><span style="color: #64748B; font-size: 12px; text-transform: uppercase; font-weight: 600;">Assigned Role</span><br><strong style="color: #F1F5F9; font-size: 16px;">Institute Admin</strong></td></tr>
            </table>
        </td></tr>
        <tr><td style="padding: 0 40px 35px 40px;">
            <table width="100%" style="background-color: #0B111E; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.2);">
                <tr><td style="padding: 24px;">
                    <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748B; font-weight: 600; text-transform: uppercase;">User ID</p>
                    <p style="margin: 0 0 20px 0; font-size: 16px; color: #F1F5F9;">${data.email}</p>
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; font-weight: 600; text-transform: uppercase;">Temporary Password</p>
                    <span class="animated-password" style="background-color: rgba(38, 195, 234, 0.08); border: 1px solid rgba(38, 195, 234, 0.3); color: #26C3EA; padding: 10px 14px; border-radius: 6px; font-family: monospace; font-size: 16px;">${data.password}</span>
                </td></tr>
            </table>
        </td></tr>
        <tr><td style="padding: 0 40px 40px 40px; text-align: center;"><a href="https://ed.trimkey.in" style="background: linear-gradient(135deg, #26C3EA, #1A9CBF); color: #0B111E; text-decoration: none; padding: 14px 36px; border-radius: 24px; font-weight: 700; font-size: 14px; display: inline-block;">Access Dashboard</a></td></tr>`
    ),

    // 2. System Operator Welcome
    operatorWelcome: (data) => buildTkEmail(
        `Your System Operator access for the Ed-Trim Key Network has been successfully provisioned.`,
        "https://ypmnsgpohaaavbjdqjye.supabase.co/storage/v1/object/public/logo/EKT_GIF.gif",
        `<tr><td style="padding: 35px 40px 10px 40px;">
            <h2 style="color: #F1F5F9; margin: 0 0 15px 0; font-size: 20px;">Welcome to the command center,</h2>
            <p style="color: #94A3B8; font-size: 15px; line-height: 24px;">Hello ${data.name},<br><br>You have been officially authorized to join the platform operations infrastructure. Your environment has been successfully deployed:</p>
            <table width="100%" style="background: rgba(38, 195, 234, 0.04); border-left: 3px solid #26C3EA; border-radius: 4px; padding: 18px; margin-bottom: 28px;">
                <tr><td style="padding-bottom: 10px;"><span style="color: #64748B; font-size: 12px; text-transform: uppercase; font-weight: 600;">Organization Network</span><br><strong style="color: #F1F5F9; font-size: 16px;">Ed-Trim Key Network</strong></td></tr>
                <tr><td><span style="color: #64748B; font-size: 12px; text-transform: uppercase; font-weight: 600;">Assigned Role</span><br><strong style="color: #F1F5F9; font-size: 16px;">System Operator</strong></td></tr>
            </table>
        </td></tr>
        <tr><td style="padding: 0 40px 35px 40px;">
            <table width="100%" style="background-color: #0B111E; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px;">
                <tr><td style="padding: 24px;">
                    <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748B; font-weight: 600; text-transform: uppercase;">User ID</p>
                    <p style="margin: 0 0 20px 0; font-size: 16px; color: #F1F5F9;">${data.email}</p>
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; font-weight: 600; text-transform: uppercase;">Temporary Password</p>
                    <span class="animated-password" style="background-color: rgba(38, 195, 234, 0.08); border: 1px solid rgba(38, 195, 234, 0.3); color: #26C3EA; padding: 10px 14px; border-radius: 6px; font-family: monospace; font-size: 16px;">${data.password}</span>
                </td></tr>
            </table>
        </td></tr>
        <tr><td style="padding: 0 40px 40px 40px; text-align: center;"><a href="https://ed.trimkey.in" style="background: linear-gradient(135deg, #26C3EA, #1A9CBF); color: #0B111E; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block;">Access Dashboard</a></td></tr>`
    ),

    // 3. Teacher Welcome
    teacherWelcome: (data) => buildTkEmail(
        `Your Ed-Trim Key Teacher account has been successfully created.`,
        data.logoUrl,
        `<tr><td style="padding: 35px 40px 10px 40px;">
            <h2 style="color: #F1F5F9; margin: 0 0 15px 0; font-size: 20px;">Welcome to your workspace,</h2>
            <p style="color: #94A3B8; font-size: 15px; line-height: 24px;">Hello ${data.name},<br><br>Your teacher profile has been successfully created and linked to your institution. You have been securely provisioned with the following access parameters:</p>
            <table width="100%" style="background: rgba(38, 195, 234, 0.04); border-left: 3px solid #26C3EA; border-radius: 4px; padding: 18px; margin-bottom: 28px;">
                <tr><td style="padding-bottom: 10px;"><span style="color: #64748B; font-size: 12px; text-transform: uppercase; font-weight: 600;">Organization</span><br><strong style="color: #F1F5F9; font-size: 16px;">${data.instName}</strong></td></tr>
                <tr><td><span style="color: #64748B; font-size: 12px; text-transform: uppercase; font-weight: 600;">Assigned Role</span><br><strong style="color: #F1F5F9; font-size: 16px;">Teacher / Faculty</strong></td></tr>
            </table>
        </td></tr>
        <tr><td style="padding: 0 40px 35px 40px;">
            <table width="100%" style="background-color: #0B111E; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px;">
                <tr><td style="padding: 24px;">
                    <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748B; font-weight: 600; text-transform: uppercase;">User ID / Email</p>
                    <p style="margin: 0 0 20px 0; font-size: 16px; color: #F1F5F9;">${data.email}</p>
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; font-weight: 600; text-transform: uppercase;">Temporary Password</p>
                    <span class="animated-password" style="background-color: rgba(38, 195, 234, 0.08); border: 1px solid rgba(38, 195, 234, 0.3); color: #26C3EA; padding: 10px 14px; border-radius: 6px; font-family: monospace; font-size: 16px;">${data.password}</span>
                </td></tr>
            </table>
        </td></tr>
        <tr><td style="padding: 0 40px 40px 40px; text-align: center;"><a href="https://ed.trimkey.in" style="background: linear-gradient(135deg, #26C3EA, #1A9CBF); color: #0B111E; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block;">Login to Dashboard</a></td></tr>`
    ),

    // 4. Job Assigned (Sent to Operator)
    jobAssigned: (data) => buildTkEmail(
        `Action Required: A new paper (${data.jobId}) has been assigned to your formatting queue.`,
        null,
        `<tr><td style="padding: 35px 40px 10px 40px;">
            <h2 style="color: #F1F5F9; margin: 0 0 15px 0; font-size: 20px;">Action Required: New Assignment</h2>
            <p style="color: #94A3B8; font-size: 15px; line-height: 24px;">Hello ${data.operatorName},<br><br>A new academic document has been successfully routed to your formatting queue. Please review the assignment parameters below.</p>
            <table width="100%" style="background-color: #0B111E; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; margin-bottom: 24px;">
                <tr><td style="padding: 24px;">
                    <table width="100%">
                        <tr><td width="50%" style="padding-bottom: 20px;"><span style="color: #64748B; font-size: 11px; text-transform: uppercase;">Job ID</span><br><strong style="color: #F1F5F9; font-size: 15px;">${data.jobId}</strong></td>
                        <td width="50%" style="padding-bottom: 20px;"><span style="color: #64748B; font-size: 11px; text-transform: uppercase;">Subject</span><br><strong style="color: #F1F5F9; font-size: 15px;">${data.subject}</strong></td></tr>
                        <tr><td colspan="2" style="padding-bottom: 20px;"><span style="color: #64748B; font-size: 11px; text-transform: uppercase;">Institute</span><br><strong style="color: #F1F5F9; font-size: 15px;">${data.instName}</strong></td></tr>
                    </table>
                </td></tr>
            </table>
        </td></tr>
        <tr><td style="background-color: rgba(245, 158, 11, 0.05); border-top: 1px solid rgba(245, 158, 11, 0.1); padding: 20px 40px;">
            <p style="color: #F59E0B; font-size: 13px; margin: 0;"><strong style="color: #FCD34D;">SLA Deadline:</strong> Complete by <strong>${data.deadline}</strong>.</p>
        </td></tr>`
    ),

    // 5. Job Ready (Sent to Teacher/Admin)
    jobReady: (data) => buildTkEmail(
        `Success: Your ${data.subject} paper for ${data.className} (Job ID: ${data.jobId}) is ready for download.`,
        data.logoUrl,
        `<tr><td style="padding: 35px 40px 10px 40px;">
            <h2 style="color: #F1F5F9; margin: 0 0 15px 0; font-size: 20px;">Document Processing Complete</h2>
            <p style="color: #94A3B8; font-size: 15px; line-height: 24px;">Hello ${data.teacherName},<br><br>Your requested academic paper has been successfully generated by our operators and is now available in your workspace.</p>
            <table width="100%" style="background-color: #0B111E; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; margin-bottom: 24px;">
                <tr><td style="padding: 24px;">
                    <table width="100%">
                        <tr><td width="50%" style="padding-bottom: 20px;"><span style="color: #64748B; font-size: 11px; text-transform: uppercase;">Job ID</span><br><strong style="color: #F1F5F9; font-size: 15px;">${data.jobId}</strong></td>
                        <td width="50%" style="padding-bottom: 20px;"><span style="color: #64748B; font-size: 11px; text-transform: uppercase;">Subject</span><br><strong style="color: #F1F5F9; font-size: 15px;">${data.subject}</strong></td></tr>
                        <tr><td width="50%"><span style="color: #64748B; font-size: 11px; text-transform: uppercase;">Class</span><br><strong style="color: #F1F5F9; font-size: 15px;">${data.className}</strong></td>
                        <td width="50%"><span style="color: #64748B; font-size: 11px; text-transform: uppercase;">Test No</span><br><strong style="color: #F1F5F9; font-size: 15px;">${data.testNo || 'N/A'}</strong></td></tr>
                    </table>
                </td></tr>
            </table>
        </td></tr>
        <tr><td style="background-color: rgba(16, 185, 129, 0.05); border-top: 1px solid rgba(16, 185, 129, 0.1); padding: 20px 40px;">
            <p style="color: #10B981; font-size: 13px; margin: 0;"><strong style="color: #34D399;">Ready for Download:</strong> Your file has passed all formatting quality checks and is secured in your repository.</p>
        </td></tr>`
    )
};

export default async function handler(req, res) {
  // 1. Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', 'https://ed.trimkey.in'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  // 2. Intercept OPTIONS method
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Only POST allowed' });

  // 🔥 ADDED SAFEGUARD: "|| {}" prevents the server from crashing if req.body is missing
  const { action, email, password, token, ...payload } = req.body || {};
  
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
      case "login": {
        const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
        if (authErr) throw authErr;
        
        const { data: profile } = await supabase.from('users').select('*').eq('auth_user_id', authData.user.id).single();
        // Allow BOTH Active and Pending users to log in
        if (!profile || (profile.status !== 'Active' && profile.status !== 'Pending')) throw new Error("Account is disabled.");

        result = { success: true, email: profile.email, token: authData.session.access_token, role: profile.role };
        break;
      }

      case "changeUserPassword": {
        const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(userContext.id, { password: payload.newPw });
        if (pwErr) throw pwErr;
        
        // If this was their first login, upgrade their profile to Active
        if (payload.currentStatus === 'Pending') {
            await supabaseAdmin.from('users').update({ status: 'Active' }).eq('auth_user_id', userContext.id);
        }

        result = { success: true, message: "Password updated successfully!" };
        break;
      }

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
        let mainPaymentStatus = "Pending"; // 🔥 FIXED: Declared at top level with a safe default

        if (activeSubs.length > 0) {
            const primarySub = activeSubs[0]; 
            mainPlan = primarySub.plan_name || "Standard";
            mainStart = primarySub.start_date || "N/A";
            mainRenew = primarySub.renewal_date || "N/A";
            mainValue = primarySub.purchase_value;
            mainPaymentStatus = primarySub.payment_status || "Pending"; // 🔥 FIXED: Assigned globally
            
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
            status: userData.status, // <--- CRITICAL FIX: Sends 'Pending' to the frontend to trigger the popup
            instId: userData.institute_id || '',
            email: userData.email, 
            name: userData.full_name,
            phone: userData.phone_number || '', // 🔥 ADDED: Pass phone to frontend
            assignedClass: teacherRes.data?.assigned_class || '', // 🔥 ADDED: Pass class to frontend 
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
                plan: mainPlan, 
                startDate: mainStart, 
                renewal: mainRenew, 
                purchaseValue: mainValue,
                paymentStatus: mainPaymentStatus, // 🔥 Now safely in scope
                papersTotal: papersTotal, 
                papersLeft: papersLeft, 
                rcTotal: rcTotal, 
                rcLeft: rcLeft,
                acTotal: acTotal, 
                acLeft: acLeft, 
                smsTotal: smsTotal, 
                smsRemaining: smsRemaining
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
      // STRICT DEVICE DEDUPLICATION & TRACKING
      // ==========================================
      case "syncDeviceSession": {
        const { data: dbUser } = await supabase.from('users').select('id').eq('auth_user_id', userContext.id).single();
        if (!dbUser) throw new Error("Security Error: User not found.");

        let currentSessionId = payload.sessionId;
        if (currentSessionId === "null" || currentSessionId === "undefined") currentSessionId = null;

        let activeSession = null;

        // 1. Try to find the exact session by ID first
        if (currentSessionId) {
            const { data: existing } = await supabase.from('user_sessions')
                .select('id, user_id, preferences')
                .eq('id', currentSessionId)
                .single();
            
            if (existing && existing.user_id === dbUser.id) {
                activeSession = existing;
            }
        }

        // 2. 🔥 STRICT DEDUPLICATION: Search by Device Footprint
        // If local storage was wiped, find their existing device row and reuse it!
        if (!activeSession) {
            const { data: matchedDevice } = await supabase.from('user_sessions')
                .select('id, preferences')
                .eq('user_id', dbUser.id)
                .eq('device_name', payload.deviceName)
                .eq('browser', payload.browser)
                .order('last_seen', { ascending: false })
                .limit(1)
                .single();
                
            if (matchedDevice) activeSession = matchedDevice;
        }

        // 3. Update existing OR Create new (as a last resort)
        if (activeSession) {
            await supabase.from('user_sessions').update({
                ip_address: payload.ipAddress,
                last_seen: new Date().toISOString()
            }).eq('id', activeSession.id);
            
            result = { 
                success: true, 
                sessionId: activeSession.id, 
                preferences: activeSession.preferences || { push: false, whatsapp: false, sms: false, email: false } 
            };
        } else {
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
        }
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

        // 🔥 Added variables for Email Dispatch
        let assignedOperatorId = null;
        let assignedOperatorEmail = null;
        let assignedOperatorName = null;

        // 🔥 Added 'email' and 'full_name' to the select query
        const { data: opData } = await supabase
            .from('users')
            .select('id, email, full_name, operator_profiles!inner(subjects, work_types)')
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
                // 🔥 Extracted to a variable so we can grab all 3 details
                const chosenOp = matchingOps[Math.floor(Math.random() * matchingOps.length)];
                assignedOperatorId = chosenOp.id;
                assignedOperatorEmail = chosenOp.email;
                assignedOperatorName = chosenOp.full_name;
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

            // 🔥 NEW: AUTOMATED RESEND EMAIL DISPATCH
            if (assignedOperatorEmail) {
                await dispatchSystemEmail(
                    assignedOperatorEmail,
                    `New Job Assigned: ${universalJobId}`,
                    EmailTemplates.jobAssigned({
                        operatorName: assignedOperatorName,
                        jobId: universalJobId,
                        subject: payload.subject || 'Paper Formatting',
                        instName: instRes.data.institute_name || 'Ed-Trim Key Client',
                        deadline: deadlineDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
                    })
                );
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

        // 🔥 Added variables for Email Dispatch
        let assignedOperatorId = null; 
        let assignedOperatorEmail = null;
        let assignedOperatorName = null;

        // 🔥 Added 'email' and 'full_name' to the select query
        const { data: opDocData } = await supabase
            .from('users')
            .select('id, email, full_name, operator_profiles!inner(work_types)')
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
                // 🔥 Extracted to a variable so we can grab all 3 details
                const chosenOp = matchingOps[Math.floor(Math.random() * matchingOps.length)];
                assignedOperatorId = chosenOp.id;
                assignedOperatorEmail = chosenOp.email;
                assignedOperatorName = chosenOp.full_name;
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

            // 🔥 NEW: AUTOMATED RESEND EMAIL DISPATCH
            if (assignedOperatorEmail) {
                await dispatchSystemEmail(
                    assignedOperatorEmail,
                    `New Document Assigned: ${docJobId}`,
                    EmailTemplates.jobAssigned({
                        operatorName: assignedOperatorName,
                        jobId: docJobId,
                        subject: documentTypeStr,
                        instName: docInstRes.data?.institute_name || 'Ed-Trim Key Client',
                        deadline: docDeadlineDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
                    })
                );
            }
        }

        result = { success: true, jobId: docJobId };
        break;
      }
     
      // ==========================================
      // REGISTRATIONS & MANAGEMENT
      // ==========================================
      case "submitInstituteRegistration": {
        const tempPassword = "TK-" + crypto.randomBytes(4).toString('hex') + "!";
        
        // 1. Create Institute
        const { data: newInst, error: instErr } = await supabaseAdmin.from('institutes').insert([{
            institute_code: payload.instCode,
            institute_name: payload.instName, 
            logo_url: payload.logoUrl
        }]).select().single();
        if (instErr || !newInst) throw new Error("Institute DB Error: " + (instErr?.message || "Failed to create institute. Check if the Institute Code is already in use."));

        // 2. Create Auth User
        const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({ 
            email: payload.adminEmail, password: tempPassword, email_confirm: true 
        });
        if (authErr) throw new Error("Auth Error: " + authErr.message);
        if (!authData || !authData.user) throw new Error("Auth Error: Failed to generate user account.");

        // 3. Insert Admin User Profile 
        const { data: newUser, error: userErr } = await supabaseAdmin.from('users').insert([{
            auth_user_id: authData.user.id, 
            email: payload.adminEmail, 
            full_name: payload.clientName || "Admin",
            phone_number: payload.adminPhone || null, // NEW: Maps phone number
            role: 'admin', 
            institute_id: newInst.id, 
            status: 'Pending'
        }]).select('id').single();
        if (userErr) throw new Error("User DB Error: " + userErr.message);

        // 4. Create Teacher Profile (Fixes the missing profile bug for Admins)
        const { error: tpErr } = await supabaseAdmin.from('teacher_profiles').insert([{
            user_id: newUser.id,
            assigned_class: 'All',
            subject_handles: []
        }]);
        if (tpErr) throw new Error("Profile DB Error: " + tpErr.message);

        // 5. Create Subscription with Valuated Quotas
        const pStatus = payload.paymentStatus === 'Trial' ? 'Trial' : (payload.paymentStatus === 'Pending' ? 'Pending' : 'Paid');
        const netPayable = Number(payload.netPayable) || 0;
        const discount = Number(payload.discount) || 0;

        const { data: initialSub, error: subErr } = await supabaseAdmin.from('subscriptions').insert([{
            institute_id: newInst.id, subscription_type: "Complete ERP", plan_name: payload.planType,
            billing_cycle: "Yearly", status: "Active", payment_status: pStatus, start_date: new Date().toISOString(), 
            purchase_value: netPayable, 
            discount: discount
        }]).select().single();
        if (subErr || !initialSub) throw new Error("Subscription Error: " + (subErr?.message || "Failed to generate subscription."));

        // 6. Apply Subscription Features
        const { error: featErr } = await supabaseAdmin.from('subscription_features').insert([
            { subscription_id: initialSub.id, feature_key: 'paper_formatter', enabled: true, total_limit: payload.papersTotal, remaining: payload.papersTotal },
            { subscription_id: initialSub.id, feature_key: 'sms', enabled: true, total_limit: payload.smsTotal, remaining: payload.smsTotal },
            { subscription_id: initialSub.id, feature_key: 'attendance', enabled: payload.attendanceToggle === "YES" },
            { subscription_id: initialSub.id, feature_key: 'admission', enabled: payload.admissionToggle === "YES" },
            { subscription_id: initialSub.id, feature_key: 'fee_collection', enabled: payload.feeToggle === "YES" }
        ]);
        if (featErr) throw new Error("Features DB Error: " + featErr.message);

        // 7. Dynamic Ledger Routing (Trial vs Paid)
        if (netPayable > 0) {
            if (pStatus === 'Paid') {
                // Client paid upfront. Log as cleared revenue.
                await supabaseAdmin.from('billing_ledger').insert([{
                    ledger_ref: 'TXN-' + Date.now(), institute_id: newInst.id, user_id: newUser.id,
                    service_type: 'App Subscriptions', transaction_type: 'SUBSCRIPTION_PURCHASE', direction: 'CREDIT',
                    amount: payload.amountPaid, status: 'POSTED', payment_method: payload.paymentMethod || 'Cash',
                    description: `Initial setup payment for ${payload.planType} plan`
                }]);
            } else {
                // Trial / Pay Later. Log as a pending invoice.
                await supabaseAdmin.from('billing_ledger').insert([{
                    ledger_ref: 'INV-' + Date.now(), institute_id: newInst.id, user_id: newUser.id,
                    service_type: 'App Subscriptions', transaction_type: 'SUBSCRIPTION_CHARGE', direction: 'CREDIT',
                    amount: netPayable, status: 'PENDING', payment_method: 'Pending',
                    description: `Pending invoice for ${payload.planType} initial setup and quotas`
                }]);
            }
        }

        // 6. Push Automated "Pay Now" Notification
        if (pStatus === 'Trial' || pStatus === 'Pending') {
            await supabaseAdmin.from('notifications').insert([{
                sender_id: null, // System generated
                institute_id: newInst.id,
                title: "Welcome to Ed-Trim Key! 🚀",
                message: "Your institute is registered. Please visit 'My Billing' to complete your payment and unlock all features.",
                type: "system_alert",
                status: "sent",
                reference_id: "BILLING-REQUIRED",
                target_roles: ['admin'],
                target_users: [newUser.id]
            }]);
        }

        // 8. Dispatch Email
        // 🔥 Send Admin Welcome Email
        await dispatchSystemEmail(
            payload.adminEmail, 
            "Welcome to Ed-Trim Key - Credentials Inside", 
            EmailTemplates.adminWelcome({
                name: payload.clientName,
                instName: payload.instName,
                email: payload.adminEmail,
                password: generatedPassword, // Ensure you pass the generated password variable here
                logoUrl: payload.logoUrl
            })
        );

        result = { success: true, message: "Institute Registered. Credentials Dispatched." };
        break;
      }

      case "submitTeacherRegistration": {
        const tempPassword = "TK-" + crypto.randomBytes(4).toString('hex') + "!";

        const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
            email: email, password: tempPassword, email_confirm: true, user_metadata: { full_name: payload.name }
        });
        if (authErr) throw new Error("Auth Error: " + authErr.message);

        const { data: newUser, error: userErr } = await supabaseAdmin.from('users').insert([{
            auth_user_id: authUser.user.id, institute_id: payload.instId, email: email,
            full_name: payload.name, phone_number: payload.contactNo || null, role: 'teacher',
            status: 'Pending', profile_pic_url: payload.photoUrl || null
        }]).select('id').single();
        if (userErr) throw new Error("User DB Error: " + userErr.message);

        const subjectsArr = payload.subjects ? payload.subjects.split(',').map(s => s.trim()) : [];
        await supabaseAdmin.from('teacher_profiles').insert([{
            user_id: newUser.id, assigned_class: payload.classAssigned || null, subject_handles: subjectsArr
        }]);

        const instName = userContext.user_metadata?.institute_name || payload.instName || "your institute";
        
        // PASSING ALL 6 ARGUMENTS PERFECTLY
        // 🔥 Send Teacher Welcome Email
        await dispatchSystemEmail(
            payload.email, 
            "Your Teacher Dashboard is Ready", 
            EmailTemplates.teacherWelcome({
                name: payload.name,
                instName: payload.instName,
                email: payload.email,
                password: generatedPassword,
                logoUrl: payload.photoUrl // or use global institute logo
            })
        );

        result = { success: true, message: "Teacher provisioned and credentials dispatched securely." };
        break;
      }

      case "submitOperatorRegistration": {
        const tempPassword = "TK-" + crypto.randomBytes(4).toString('hex') + "!";
        
        const { data: opAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({ 
            email: email, password: tempPassword, email_confirm: true 
        });
        if (authErr) throw new Error("Auth Error: " + authErr.message);
        
        const { data: newOp } = await supabaseAdmin.from('users').insert([{ 
            auth_user_id: opAuth.user.id, email: email, full_name: payload.name, 
            role: 'operator', status: 'Pending', profile_pic_url: payload.photoUrl 
        }]).select().single();
        
        await supabaseAdmin.from('operator_profiles').insert([{ 
            user_id: newOp.id, subjects: payload.subjects, work_type: payload.workType, 
            rate_paper: payload.ratePaper, rate_unit: payload.rateUnit, upi_id: payload.upi 
        }]);
        
        // PASSING ALL 6 ARGUMENTS PERFECTLY
        // 🔥 Send Operator Welcome Email
        await dispatchSystemEmail(
            payload.email, 
            "Operator Access Provisioned", 
            EmailTemplates.operatorWelcome({
                name: payload.name,
                email: payload.email,
                password: generatedPassword
            })
        );
        
        result = { success: true };
        break;
      }

      case "assignJobToOperator": {
        const { data: opToAssign } = await supabase.from('users').select('id').eq('full_name', payload.operatorName).single();
        if(opToAssign) {
            await supabase.from('jobs_queue').update({ operator_id: opToAssign.id, status: 'Assigned' }).eq('job_code', payload.jobId);
            
            // You'll need to fetch the Operator's email from the DB first using payload.operatorName
        const { data: opData } = await supabaseAdmin.from('users').select('email').eq('full_name', payload.operatorName).single();
        
        if (opData && opData.email) {
            // 🔥 Send Assignment Alert
            await dispatchSystemEmail(
                opData.email, 
                `New Job Assigned: ${payload.jobId}`, 
                EmailTemplates.jobAssigned({
                    operatorName: payload.operatorName,
                    jobId: payload.jobId,
                    subject: payload.subject || payload.docType || 'Document',
                    instName: payload.instName || 'Ed-Trim Key Client',
                    deadline: payload.deadline || '48 Hours'
                })
            );
        }
        }
        result = { success: true, message: `Job officially assigned.` };
        break;
      }

      case "updateMyProfile": {
        // 1. Update Supabase Auth identity safely
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userContext.id, { 
            email: payload.email, 
            user_metadata: { full_name: payload.name } 
        });
        if (authErr) throw new Error("Identity Update Error: " + authErr.message);

        // 2. Update Public Users table
        const { error: userErr } = await supabaseAdmin.from('users').update({ 
            full_name: payload.name,
            email: payload.email,
            phone_number: payload.phone 
        }).eq('auth_user_id', userContext.id);
        if (userErr) throw new Error("Database Error: " + userErr.message);

        // 3. Autonomously update academic roles if user is an Admin
        if (payload.role === 'admin' || payload.role === 'super admin' || payload.role === 'system admin') {
            const { data: me } = await supabaseAdmin.from('users').select('id').eq('auth_user_id', userContext.id).single();
            if (me) {
                const subjectsArr = payload.subjects ? payload.subjects.split(',').map(s => s.trim()) : [];
                await supabaseAdmin.from('teacher_profiles').update({ 
                    assigned_class: payload.assignedClass,
                    subject_handles: subjectsArr
                }).eq('user_id', me.id);
            }
        }

        result = { success: true, message: "Profile updated successfully." };
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

      case "removeTeacherAccess": {
        const { data, error } = await supabaseAdmin.from('users')
            .update({ status: 'Inactive' })
            .eq('id', payload.userId) 
            .select(); 
            
        if (error) throw new Error("DB Error: " + error.message);
        if (!data || data.length === 0) throw new Error("Update Failed: Could not find teacher record.");
        
        result = { success: true, message: "Teacher access suspended." };
        break;
      }

      case "restoreTeacherAccess": {
        const { data, error } = await supabaseAdmin.from('users')
            .update({ status: 'Active' })
            .eq('id', payload.userId) 
            .select();
            
        if (error) throw new Error("DB Error: " + error.message);
        if (!data || data.length === 0) throw new Error("Update Failed: Could not find teacher record.");
        
        result = { success: true, message: "Teacher access restored." };
        break;
      }

      case "restoreTeacherAccess": {
        const { data, error } = await supabaseAdmin.from('users')
            .update({ status: 'Active' })
            .eq('email', payload.email)
            .select();
            
        if (error) throw new Error("DB Error: " + error.message);
        if (!data || data.length === 0) throw new Error("Update Failed: Could not find teacher with email " + payload.email);
        
        result = { success: true, message: "Teacher access restored." };
        break;
      }

      case "removeOperatorAccess": {
        const { data, error } = await supabaseAdmin.from('users')
            .update({ status: 'Inactive' })
            .eq('full_name', payload.name)
            .eq('role', 'operator')
            .select();
            
        if (error) throw new Error("DB Error: " + error.message);
        if (!data || data.length === 0) throw new Error("Update Failed: Could not find operator named " + payload.name);
        
        result = { success: true, message: "Operator access suspended." };
        break;
      }

      case "restoreOperatorAccess": {
        const { data, error } = await supabaseAdmin.from('users')
            .update({ status: 'Active' })
            .eq('full_name', payload.name)
            .eq('role', 'operator')
            .select();
            
        if (error) throw new Error("DB Error: " + error.message);
        if (!data || data.length === 0) throw new Error("Update Failed: Could not find operator named " + payload.name);
        
        result = { success: true, message: "Operator access restored." };
        break;
      }

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

      case "getTeachersList": {
        // Uses supabaseAdmin to safely bypass Row Level Security
        const { data, error } = await supabaseAdmin.from('users')
            .select('*, teacher_profiles(*)')
            .eq('institute_id', payload.instId)
            .eq('role', 'teacher');
            
        if (error) throw new Error("Database Error: " + error.message);
        
        result = { success: true, teachers: data };
        break;
      }
        


      case "updateMyProfile": {
        // 1. Update Supabase Auth identity safely
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userContext.id, { 
            email: payload.email, 
            user_metadata: { full_name: payload.name } 
        });
        if (authErr) throw new Error("Identity Update Error: " + authErr.message);

        // 2. Update Public Users table
        const { error: userErr } = await supabaseAdmin.from('users').update({ 
            full_name: payload.name,
            email: payload.email,
            phone_number: payload.phone 
        }).eq('auth_user_id', userContext.id);
        if (userErr) throw new Error("Database Error: " + userErr.message);

        result = { success: true, message: "Profile updated successfully." };
        break;
      }

      case "requestAcademicChange": {
        const { data: senderObj } = await supabaseAdmin.from('users').select('id, institute_id').eq('auth_user_id', userContext.id).single();
        if (!senderObj) throw new Error("User mapping failed.");

        // Dispatch a request notification to Admins
        await supabaseAdmin.from('notifications').insert([{
            sender_id: senderObj.id,
            institute_id: senderObj.institute_id,
            title: "Profile Change Request",
            message: `${payload.userName} requested an update to their Academic/Work Profile. Click here to review and edit their settings.`,
            type: "system_alert",
            status: "sent",
            reference_id: "REQ_EDIT_" + senderObj.id, // 🔥 THE FIX: Attaches their UUID so the frontend can open the modal!
            target_roles: ['admin', 'super admin'],
            target_users: []
        }]);
        
        result = { success: true };
        break;
      }

      case "getUserDetailsForEdit": {
        // 🔥 NEW: Safely fetches a specific user's full profile to populate the Edit Modal
        const { data, error } = await supabaseAdmin.from('users')
            .select('*, teacher_profiles(*), operator_profiles(*)')
            .eq('id', payload.targetId)
            .single();
            
        if (error) throw new Error("Could not fetch user profile: " + error.message);
        result = { success: true, data: data };
        break;
      }

      case "updateTeacherDetails": {
        const { error: userErr } = await supabaseAdmin.from('users')
            .update({ status: payload.status })
            .eq('id', payload.userId);
        if (userErr) throw new Error("Status Update Error: " + userErr.message);

        const subjectsArr = payload.subjects ? payload.subjects.split(',').map(s => s.trim()).filter(Boolean) : [];
        const { error: profErr } = await supabaseAdmin.from('teacher_profiles')
            .update({ assigned_class: payload.assignedClass, subject_handles: subjectsArr })
            .eq('user_id', payload.userId);
        if (profErr) throw new Error("Profile Update Error: " + profErr.message);

        // 🔥 NEW: IN-APP NOTIFICATION TO THE TEACHER (ACCEPTED)
        await supabaseAdmin.from('notifications').insert([{
            sender_id: null, 
            institute_id: null,
            title: "Profile Update Approved ✅",
            message: "Your request to update your academic profile has been approved and applied by the administration.",
            type: "system_alert",
            status: "sent",
            reference_id: "SYS-ALERT",
            target_roles: [],
            target_users: [payload.userId] // Sends strictly to this teacher
        }]);

        result = { success: true, message: "Teacher details updated successfully." };
        break;
      }

      case "updateOperatorDetails": {
        const { data: opData } = await supabaseAdmin.from('users').select('id').eq('full_name', payload.originalName).eq('role', 'operator').single();
        
        const { error: userErr } = await supabaseAdmin.from('users')
            .update({ status: payload.status })
            .eq('full_name', payload.originalName)
            .eq('role', 'operator');
        if (userErr) throw new Error("Status Update Error: " + userErr.message);

        if (opData) {
            const subjectsArr = payload.subjects ? payload.subjects.split(',').map(s => s.trim()).filter(Boolean) : [];
            const workArr = payload.workType ? payload.workType.split(',').map(s => s.trim()).filter(Boolean) : [];
            
            await supabaseAdmin.from('operator_profiles').update({
                subject_handles: subjectsArr,
                work_types: workArr,
                rate_paper: payload.ratePaper,
                rate_unit: payload.rateUnit
            }).eq('user_id', opData.id);

            // 🔥 NEW: IN-APP NOTIFICATION TO THE OPERATOR (ACCEPTED)
            await supabaseAdmin.from('notifications').insert([{
                sender_id: null, 
                institute_id: null,
                title: "Work Profile Updated ⚙️",
                message: "Your work types, subjects, or rates have been officially updated by the Super Admin.",
                type: "system_alert",
                status: "sent",
                reference_id: "SYS-ALERT",
                target_roles: [],
                target_users: [opData.id] // Sends strictly to this operator
            }]);
        }

        result = { success: true, message: "Operator details updated successfully." };
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


      case "removeOperatorAccess": {
        // Sets status to Inactive (Suspends account without deleting financial data)
        const { error } = await supabaseAdmin.from('users')
            .update({ status: 'Inactive' })
            .eq('full_name', payload.name)
            .eq('role', 'operator');
            
        if (error) throw new Error("Database Error: " + error.message);
        
        result = { success: true, message: "Operator access suspended." };
        break;
      }

      case "restoreOperatorAccess": {
        // Sets status back to Active
        const { error } = await supabaseAdmin.from('users')
            .update({ status: 'Active' })
            .eq('full_name', payload.name)
            .eq('role', 'operator');
            
        if (error) throw new Error("Database Error: " + error.message);
        
        result = { success: true, message: "Operator access restored." };
        break;
      }

      case "deleteOperatorAccess": {
        // 1. Find the user ID and Auth ID based on the operator's name
        const { data: uData, error: fetchErr } = await supabaseAdmin.from('users')
            .select('id, auth_user_id')
            .eq('full_name', payload.name)
            .eq('role', 'operator')
            .single();
            
        if (fetchErr || !uData) throw new Error("Operator not found in the database.");

        // 2. Delete from operator_profiles first (Foreign Key constraint)
        await supabaseAdmin.from('operator_profiles').delete().eq('user_id', uData.id);
        
        // 3. Delete from the public users table
        const { error: delUserErr } = await supabaseAdmin.from('users').delete().eq('id', uData.id);
        
        // Built-in Database Protection: If they have formatted papers in the jobs_queue, 
        // the database will block the deletion to protect your financial ledger.
        if (delUserErr) throw new Error("Cannot delete operator. They have completed jobs in the system. Please suspend their access instead to preserve your audit logs.");

        // 4. Delete their secure login identity from Supabase Auth
        if (uData.auth_user_id) {
            await supabaseAdmin.auth.admin.deleteUser(uData.auth_user_id);
        }

        result = { success: true, message: "Operator permanently deleted from the system." };
        break;
      }
      
      
      case "removeTeacherAccess": {
        const { data, error } = await supabaseAdmin.from('users')
            .update({ status: 'Inactive' })
            .eq('id', payload.userId) // 🔥 Targeting by primary UUID
            .select(); 
            
        if (error) throw new Error("DB Error: " + error.message);
        if (!data || data.length === 0) throw new Error("Update Failed: Could not find teacher record."); // 🔥 "with email" is gone!
        
        result = { success: true, message: "Teacher access suspended." };
        break;
      }

      case "restoreTeacherAccess": {
        const { data, error } = await supabaseAdmin.from('users')
            .update({ status: 'Active' })
            .eq('id', payload.userId) // 🔥 Targeting by primary UUID
            .select();
            
        if (error) throw new Error("DB Error: " + error.message);
        if (!data || data.length === 0) throw new Error("Update Failed: Could not find teacher record.");
        
        result = { success: true, message: "Teacher access restored." };
        break;
      }

      case "deleteTeacherAccess": {
        // Find the user ID and Auth ID based on the UUID
        const { data: uData, error: fetchErr } = await supabaseAdmin.from('users').select('id, auth_user_id').eq('id', payload.userId).single();
        if (fetchErr || !uData) throw new Error("Teacher not found in database.");

        // Delete from teacher_profiles first (Foreign Key constraint)
        await supabaseAdmin.from('teacher_profiles').delete().eq('user_id', uData.id);
        
        // Delete from the public users table
        const { error: delUserErr } = await supabaseAdmin.from('users').delete().eq('id', uData.id);
        if (delUserErr) throw new Error("Failed to delete user profile. They may be linked to existing academic records.");

        // Delete their secure login identity from Supabase Auth
        if (uData.auth_user_id) {
            await supabaseAdmin.auth.admin.deleteUser(uData.auth_user_id);
        }

        result = { success: true, message: "Teacher permanently deleted from the system." };
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
        if (targetUserArr.length > 0) {
            for (let targetId of targetUserArr) {
                await dispatchPushNotification(targetId, alertTitle, alertMsg);
            }
        }

        result = { success: true, message: "Message sent." };
        break;
      }
      
      default:
        throw new Error("Invalid API Action requested: " + action);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error(error);
    return res.status(200).json({ success: false, message: error.message });
  }
}
