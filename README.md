# EdTrimKey Backend

**Serverless API & Gateway Engine for EdTrimKey**

This repository hosts the backend API functions for **EdTrimKey**, running on Vercel Serverless Functions (`/api/gateway.js`).

---

## Tech Stack & Architecture

* **Runtime:** Node.js (Vercel Serverless Functions)
* **Database:** Supabase PostgreSQL (`@supabase/supabase-js`)
* **Storage:** Google Drive API & Supabase Storage
* **Messaging & Push:** Firebase Cloud Messaging (FCM) & Nodemailer
* **Payment Orchestration:** Integrated with [Trim Key Flow](https://flow.trimkey.in)

---

## Key Modules

```
api/
  gateway.js           ← Single master endpoint handling all API actions & webhooks
lib/
  supabase.js          ← Supabase client initialization
  firebase.js          ← Push notifications
  gdrive.js            ← Google Drive backup & document uploads
database/
  Database-Supabase.txt ← Database schema & tables
docs/
  PAYMENT_AND_BILLING_LEDGER.md ← Payment gateway, webhook, and quota documentation
```

---

## Payments & Quotas Documentation

For comprehensive details on:
* Inbound Trim Key Flow webhooks
* Foreign key safety (`user_id` resolution)
* Ledger recording in `public.billing_ledger`
* Quota crediting in `public.subscription_features`

👉 See **[docs/PAYMENT_AND_BILLING_LEDGER.md](docs/PAYMENT_AND_BILLING_LEDGER.md)**.
