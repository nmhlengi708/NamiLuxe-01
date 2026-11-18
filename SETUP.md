# NamiLuxe online store — setup guide

This is a full-stack starter project. It includes a responsive storefront, Supabase email/password authentication, customer profiles, basket, server-validated order requests, order history and an admin dashboard.

## 1. What you need
- A computer is easiest for the first deployment (Android + Termux is possible but more involved).
- A free Supabase project: https://supabase.com/
- Node.js 20 or newer: https://nodejs.org/

## 2. Create the database
1. Create a Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. Open `supabase/schema.sql`, copy all SQL and run it.
4. In **Authentication -> Providers -> Email**, enable email/password. Configure email confirmation and your production site URL under Authentication URL settings.

## 3. Configure the server
1. Copy `.env.example` to `.env`.
2. In Supabase **Project Settings -> API**, copy the Project URL, anon/public key and service_role/secret key into `.env`.
3. Set `SITE_URL` to your deployed website URL.
4. Set `WHATSAPP_NUMBER` to your business WhatsApp number in international format without `+`, e.g. `27...`.
5. Never put `SUPABASE_SERVICE_ROLE_KEY` in any browser code or publish your `.env` file.

## 4. Install and run
```bash
npm install
npm start
```
Open http://localhost:3000

## 5. Add your first admin
1. Register your own account from the storefront.
2. In Supabase SQL Editor run the following, replacing the email:
```sql
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');
```
3. Sign out and sign in again, then open the account section. You should see **Open admin dashboard**.

## 6. Add products
Use the admin dashboard to add product name, price in ZAR, stock, description, category and an image URL. Use image URLs hosted somewhere you control. The server validates product prices and stock when orders are submitted.

## 7. Payments and delivery — important
The checkout currently records an **order request only**. It does not charge a card, mark an order as paid, or calculate courier fees. This is deliberate: live payment processing must be connected to a verified payment provider account, with server-side payment notification/signature validation before an order can be marked paid. Do not manually tell customers that an order is paid based only on this demo checkout. For South Africa, evaluate a hosted provider such as PayFast or Yoco and complete its merchant onboarding and webhook/ITN verification before launch.

Add your actual delivery rates, returns/refunds policy, privacy policy, terms, contact email and WhatsApp details before accepting public orders.

## 8. Deployment
Deploy the Node server to a Node-compatible host (for example Render, Railway, or another provider that supports persistent environment variables). Set all `.env` values in the host's environment settings, set `SITE_URL` to your live HTTPS domain, and configure Supabase's allowed redirect URLs to match. Do not upload `.env` to GitHub.

## Security notes
- Supabase handles password hashing and authentication; passwords are not stored by this app.
- The server checks the logged-in user's access token and checks admin status for admin endpoints.
- The service-role key is server-only and bypasses Row Level Security; keep it secret.
- Before a public launch, add rate limiting, bot protection, proper logging, backups, privacy/legal notices, and test the full order lifecycle.
