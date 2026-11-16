# EdTrimKey Backend — Payment Gateway, Billing Ledger & Quota Architecture

## 1. Overview

The **EdTrimKey Backend** provides cloud APIs and webhooks for all educational management modules, including admissions, fee collection, subscriptions, exam generation, and dynamic billing.

Payment processing is fully integrated with **Trim Key Flow** (and underlying gateways like Razorpay) through an automated dual-channel reconciliation engine that writes to `public.billing_ledger` and updates feature quotas in `public.subscription_features`.

---

## 2. Payment Flow Architecture

```
[Trim Key Flow / Razorpay]
       │
       ├────────────────────────────────────────┐
       │ (Channel 1: Cloud Webhook)             │ (Channel 2: Client Fallback)
       │ POST /api/gateway                      │ POST /api/gateway
       │ Header: x-trim-key-flow-event          │ Body: { action: "confirmFlowPayment" }
       │                                        │
       ▼                                        ▼
┌────────────────────────────────────────────────────────┐
│               api/gateway.js Handler                   │
│                                                        │
│  1. Flow Webhook Detector (Lines 466–501)              │
│  2. Client Fallback Handler (Lines 1684–1707)          │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│            recordPaymentAndCreditQuota Engine          │
│                                                        │
│  Step 1: Resolve Institute (UUID or Code: KPS)         │
│  Step 2: Idempotency Verification                      │
│  Step 3: Resolve Public User ID (FK Safety)            │
│  Step 4: Commit Row to public.billing_ledger           │
│  Step 5: Map Service Type & Credit Quota               │
└────────────────────────────────────────────────────────┘
```

---

## 3. Webhook & Fallback Handlers in `api/gateway.js`

### 3.1. Inbound Trim Key Flow Webhook
Trim Key Flow dispatches automated cloud webhooks upon payment capture:
* **Trigger condition:**
  ```javascript
  const isFlowWebhook = (
    action === 'flowWebhook' || 
    req.body?.event === 'payment.success' || 
    req.headers['x-trim-key-flow-event'] === 'payment.success'
  );
  ```
* **Payload extraction:**
  * `paymentNumber` (e.g. `TKF-PAY-20261115-000008`)
  * `amount` (converted from paise if > 500)
  * `providerPaymentId` (e.g. `pay_U0aMdt4e3MIiY3`)
  * `providerOrderId` (e.g. `order_U0aMdt4e3MIiY3`)
  * `metadata`: `serviceType`, `instCode`, `quantity`

### 3.2. Client-Side Reconciliation Fallback (`confirmFlowPayment`)
If a customer's browser stays open after payment, `index.html` sends a client confirmation:
```javascript
serverCall('confirmFlowPayment', {
  paymentNumber: 'TKF-PAY-20261115-000008',
  instCode: 'KPS',
  serviceType: 'Admit Card',
  amount: 1,
  quantity: 1,
  providerPaymentId: 'pay_U0aMdt4e3MIiY3'
});
```
* **Idempotency Guarantee:** Whether the webhook arrives first or the client confirmation arrives first, `recordPaymentAndCreditQuota` ensures the transaction is committed exactly once.

### 3.3. Customer Profile Auto-Query & Gateway Prefill (`createPaymentLink`)
When initiating a recharge or payment link, EdTrimKey backend queries the database so that payment gateways (Razorpay, etc.) automatically prefill the user's name, email, and mobile phone:
1. **User Identity Resolution:** Queries `public.users` using:
   - `userContext.id` (checking `id` or `auth_user_id`)
   - `email` fallback
   - `institute_code` fallback (`institutes.admin_email` -> `users`)
2. **Phone Normalization:** Strips non-digits, checks for Indian 10-digit mobile pattern (`/^[6-9]\d{9}$/`), and handles leading `+91` or `0`.
3. **Payload Construction:** Sends resolved `customer: { name, email, phone }` to Trim Key Flow, ensuring checkout forms pre-populate without manual data entry.

---

## 4. `recordPaymentAndCreditQuota` Engine Details

### 4.1. Institute Resolution
The engine resolves the target school/institute:
1. Checks by `instId` (UUID).
2. Falls back to `instCode` (e.g. `KPS` / `Keystone Public School`).
3. Defaults to primary institute if neither is specified.

### 4.2. Database Foreign Key Safety (`user_id` vs `auth_user_id`)
> [!IMPORTANT]
> In Supabase, authentication user IDs (`auth.users.id`) and public profile user IDs (`public.users.id`) are distinct UUIDs. The `billing_ledger` table enforces:
> ```sql
> constraint billing_ledger_user_id_fkey foreign key (user_id) references users (id) on delete set null
> ```
> To prevent foreign key constraint violations, the engine resolves the user safely:
> ```javascript
> let effectiveUserId = null;
> if (userId) {
>     const { data: resolvedUser } = await supabaseAdmin
>         .from('users')
>         .select('id')
>         .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
>         .maybeSingle();
>     if (resolvedUser) effectiveUserId = resolvedUser.id;
> }
> if (!effectiveUserId && effectiveInstId) {
>     const { data: adminUser } = await supabaseAdmin
>         .from('users')
>         .select('id')
>         .eq('institute_id', effectiveInstId)
>         .eq('role', 'admin')
>         .limit(1)
>         .maybeSingle();
>     if (adminUser) effectiveUserId = adminUser.id;
> }
> ```

### 4.3. Ledger Record Commit (`public.billing_ledger`)
The engine writes a permanent ledger record with:
* `ledger_ref`: `LED-TKF-PAY-YYYYMMDD-NNNNNN`
* `payment_ref`: `TKF-PAY-YYYYMMDD-NNNNNN`
* `institute_id`: Resolved Institute UUID
* `user_id`: Resolved `public.users.id` (or `null`)
* `service_type`: e.g. `Admit Card`, `Report Card`, `MCQ Paper`, `SMS Top-up`
* `transaction_type`: `'PAYMENT_RECEIVED'`
* `direction`: `'CREDIT'`
* `amount`: Numeric paid amount (₹)
* `status`: `'POSTED'`
* `payment_gateway`: `'Trim Key Flow'`
* `gateway_payment_id`: e.g. `pay_U0aMdt4e3MIiY3`

### 4.4. Quota Credit Engine (`public.subscription_features`)
Service types map to feature keys in `subscription_features`:
* `'MCQ Paper'`, `'Math Paper'` ➔ `paper_formatter`
* `'Report Card'`, `'Report Cards'` ➔ `report_cards`
* `'Admit Card'`, `'Admit Cards'` ➔ `admit_cards`
* `'SMS Cost'`, `'SMS Top-up'` ➔ `sms`

The engine locates the active subscription for the institute and increments:
* `total_limit = total_limit + quantity`
* `remaining = remaining + quantity`
If no feature record exists for this subscription, a new row is initialized.

### 4.5. `myBilling` Mapping & Receipt Retrieval Engine (`getBillingReceipt`)
To power the frontend's official PDF receipt and redesigned Activity Ledger:
* **Rich Metadata Mapping:** `myBilling` in `initDashboard` transforms `billing_ledger` rows with:
  - `ledId`: Immutable ledger reference (`LED-TKF-PAY-...`)
  - `quantity`: Quantity of service units purchased
  - `unitPrice`: Calculated per-unit price (`amount / quantity`)
  - `customerName`, `customerEmail`, `customerPhone`: Billed customer details
  - `instName`, `instCode`: Institute details
  - `gatewayPaymentId`, `gatewayOrderId`: Gateway references
* **Dedicated API Action (`getBillingReceipt`):** Allows instant query of any historical receipt by `ledId` or `paymentNumber`, joining user and institute information.

---

## 5. Developer Cheatsheet

### Verify recent ledger entries:
```sql
SELECT id, ledger_ref, amount, service_type, status, gateway_payment_id, created_at 
FROM public.billing_ledger 
ORDER BY created_at DESC 
LIMIT 10;
```

### Verify remaining quota for an institute:
```sql
SELECT sf.feature_key, sf.total_limit, sf.remaining, sf.used, s.status, i.institute_name
FROM public.subscription_features sf
JOIN public.subscriptions s ON sf.subscription_id = s.id
JOIN public.institutes i ON s.institute_id = i.id
WHERE i.institute_code = 'KPS';
```
