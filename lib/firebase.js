import admin from 'firebase-admin';

export async function sendPushNotification(tokens, title, body) {
  if (!tokens || tokens.length === 0) return { success: false, message: 'No tokens provided' };
  
  // 1. Initialize safely inside the function
  if (!admin.apps.length) {
    try {
      const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      if (!rawJson) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON in Vercel.");

      const serviceAccount = JSON.parse(rawJson);

      // 🔥 CRITICAL VERCEL FIX: Restore the newlines in the private key
      if (serviceAccount.private_key) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } catch (e) {
      console.error("🔥 FIREBASE INIT ERROR: Your JSON is malformed.", e.message);
      return { success: false, error: "Server Configuration Error: Firebase JSON invalid." };
    }
  }

  const message = {
    notification: { title, body },
    tokens: tokens 
  };

  // 2. Dispatch and log specific token failures
  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`🔥 FCM Dispatch Complete. Success: ${response.successCount}, Failed: ${response.failureCount}`);
    
    // If some tokens failed, log exactly why so we can debug them in Vercel
    if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                console.error(`Token [${tokens[idx]}] failed to send:`, resp.error);
            }
        });
    }

    return { success: true, successCount: response.successCount, failureCount: response.failureCount };
  } catch (error) {
    console.error('🔥 FCM FATAL ERROR:', error);
    return { success: false, error: error.message };
  }
}
