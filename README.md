# Amacar Hardware Inventory Management System

A Web-based inventory and point-of-sale system for Amacar Hardware. The application manages products, categories, stock, receipt extraction, and sales workflows.

## Project status

The system is in active capstone development and currently supports its main end-to-end workflows: authenticated role-based access, inventory maintenance, inbound receipt extraction, outbound stock processing, POS sales, reporting, audit history, and backup/restore. Desktop and mobile layouts are implemented, including cashier-focused mobile POS controls and dark mode.

The current development focus is interface refinement, data consistency, production configuration, and validation of external integrations. See [Known limitation](#known-limitation) for the remaining user-creation API issue.

## Current features

- Dashboard metrics for inventory, sales, recent transactions, stock movements, and top products by value
- Product inventory management with categories, images, pricing, stock thresholds, audited adjustments, inbound batch history, reversible archive/restore, filtering, and pagination
- Inbound inventory through VLM-assisted receipt extraction and product matching
- Manual outbound transactions for sales, returns, damage/disposal, transfers, and other stock-outs
- Point of Sale (POS) with category filtering, cart management, discounts, cash payments, PayMongo test checkout, receipts, transaction history, and voiding
- Automatic POS inventory deductions and stock-movement records through an authenticated server endpoint
- Low-stock monitoring and stock alerts
- Staff and management reorder-list generation for low, critical, and out-of-stock products, with editable suggested quantities and a printable purchase document
- Inventory, valuation, low-stock, stock-movement, and cashier sales reports
- Audit logs and stock-movement history with export options
- User viewing, editing, activation/deactivation, non-destructive backup/restore, and role assignment for `owner`, `admin`, `cashier`, and `staff`
- Supabase authentication, OTP password reset, first-login-wins session control, five-minute inactivity logout, failed-login throttling, role-based navigation, responsive desktop/mobile layouts, and dark mode
- Inventory and user backup/restore tools

## Recent progress and interface changes

- Replaced the former `manager` role with the new `owner` role across navigation, inventory, POS, reports, receipt scanning, user management, and activity history. Owners receive full business access, while technical receipt-scanner configuration remains exclusive to `admin`.
- Reduced the inactivity timeout from 15 minutes to 5 minutes and improved automatic logout reason handling, session cleanup, and cross-tab activity tracking.
- Added Receipt Scanner extraction history for reviewed items that were successfully saved to inventory, including the save date, operator, quantity, cost, category, and whether each item created a product or updated stock.
- Made voided POS transactions immediately recognizable in transaction history and on displayed or printed receipts, including the void date and reason.
- Improved product-unit handling during inventory entry and receipt imports, with clearer success, partial-success, and failure notifications after saving extracted items.
- Reduced the vision-model response-token limit to improve receipt-processing efficiency.
- Replaced technical navigation terminology with clearer task-based names, including `Sales Checkout`, `Receipt Scanner`, `Staff Accounts`, and `Activity History`.
- Added product categories throughout inventory creation and editing, plus category filters on Inventory and Sales Checkout.
- Added client-side pagination to Inventory while keeping the Sales Checkout catalog continuously available for faster cashier use.
- Redesigned the Receipt Scanner workflow with clear processing states, duplicate-submit prevention, and structured extracted-item review cards.
- Moved receipt-item Accept and Reject actions below the review fields and aligned semantic colors across light and dark modes: green for Accept, red for Reject, and amber for Pending.
- Improved shared modals for mobile widths and backdrop dismissal, and updated contextual page guides for newer screens and terminology.
- Replaced native browser alerts with branded, non-blocking notifications and migrated Yes/No prompts to accessible confirmation dialogs. Both support semantic colors, dismissal, responsive positioning, and light/dark mode.
- Standardized the application typography on Open Sans with a consistent 14px base scale and inherited form-control typography.
- Added the current Amacar logo as the browser-tab icon on every application page.
- Refined the desktop sidebar branding into a compact two-line `Amacar Hardware` / `Inventory System` title.
- Standardized product names to uppercase when manually created or edited, restored from inventory backups, or imported through VLM receipt extraction.
- Added uppercase presentation for older product records so existing mixed-case data remains visually consistent.
- Made unit-filter options case-insensitive and uppercase. Values such as `pcs`, `Pcs`, and `PCS` now appear once as `PCS`, while matching all equivalent stored records.
- Improved mobile inventory cards by showing all product details without a disclosure dropdown.
- Replaced product deletion with reversible Archive/Restore actions so stock, movement, and transaction history remain intact.
- Replaced permanent staff-account deletion with activation/deactivation so user-linked audit, receipt, stock, and transaction history remains attributable.
- Removed destructive `Replace All` restore choices. Inventory and user restores now use merge or add-only workflows.
- Added database-enforced archive metadata, role-aware RLS, append-only audit/movement history, and protection against frontend hard deletion.
- Redesigned the mobile POS product catalog as compact single-column cashier rows with thumbnails, unit/code information, prices, stock indicators, and larger circular add controls.
- Preserved the mobile POS bottom cart bar and slide-up checkout panel for quick cart access.
- Reduced the expanded inbound batch-history inset and simplified its dark-mode borders so it blends with the inventory table.
- Kept receipt/product-code fields and other machine-readable identifiers in monospace while applying Open Sans to the general interface.

These responsive changes apply at mobile breakpoints and do not replace the desktop inventory table or desktop POS catalog.

## Mobile experience

The application includes responsive views designed for phones and small tablets. Mobile navigation uses a compact branded header and hamburger menu, while page content is reorganized for touch interaction rather than simply shrinking the desktop layout.

| Mobile screen | Current behavior |
| --- | --- |
| Inventory | Products appear as full-width cards with a thumbnail, status, uppercase product name, code, available quantity, selling price, unit cost, stock value, reorder level, and maximum stock. Details remain visible without an extra dropdown. |
| Inventory actions | Authorized users receive `Archive`/`Restore`, `Edit`, and `Adjust` controls. Archived products are excluded from operational lists while remaining available to history and reports. |
| Inventory filters | Search, status, category, availability, unit, quantity, price, and sorting controls reflow into touch-friendly columns. Unit values are deduplicated without regard to capitalization. |
| Point of Sale | Products appear in a cashier-focused single-column list with thumbnail, stock status, uppercase name, unit, code, selling price, and a prominent circular add control. |
| POS cart | A persistent bottom bar shows cart count and total. Selecting it opens a slide-up cart and checkout panel without leaving the product catalog. |
| VLM extraction | Receipt capture, extracted-item review, thumbnail editing, acceptance/rejection, and inventory-saving actions adapt to narrow screens. |
| Modals and help | Dialogs fit narrow screens, scroll internally when needed, and retain clear close controls. Updated page guides explain current workflows and terminology. |
| Navigation and appearance | The mobile header provides role-aware navigation. Light mode, dark mode, inactivity handling, and help controls remain available. |

Mobile layouts are primarily applied at widths of `768px` and below, with additional adjustments for narrow devices around `380px` to `420px`.

## Technology

- Frontend: HTML, CSS, vanilla JavaScript, Chart.js, and Supabase JS
- Backend: Node.js and Express
- Database/authentication/storage: Supabase (PostgreSQL, Auth, Realtime, and Storage)
- Receipt extraction: DeepSeek vision model with a Python VLM helper
- Payments: PayMongo test checkout for QR/e-wallet payments
- Email: Nodemailer/SMTP for OTP password reset

## Project structure

```text
Capstone-Inventory-Management-System/
|-- index.html                 # Login-aware application entry point
|-- server.js                  # Express server and static hosting
|-- password-reset.js          # OTP and password-reset API routes
|-- openrouter.js              # VLM extraction and inventory-import API routes
|-- paymongo.js                # PayMongo checkout API routes
|-- pos-api.js                 # Authenticated POS stock finalization
|-- python_vlm.py              # Python receipt-image helper
|-- vlm_settings.json          # Selected vision model configuration
|-- AMACAR_RLS_FLOW_ALIGNMENT.sql       # Archive schema and role-aligned RLS policies
|-- AMACAR_ADMIN_ACCESS_RECOVERY.sql    # Recovery for recursive users-table RLS
|-- pages/                     # Application HTML pages
|-- scripts/                   # Page logic and shared browser helpers
|-- styles/                    # Shared and page-specific styles
|-- supabase/migrations/       # SQL migrations required by hosted Supabase features
`-- components/sidebar.html    # Shared desktop/mobile navigation
```

## Prerequisites

- Node.js 18 or newer (the server uses the built-in `fetch` API)
- npm
- A configured Supabase project
- Python available as `python`, or configured through `PYTHON_BINARY`, for receipt-image processing
- DeepSeek, SMTP, and PayMongo test credentials for their respective optional workflows

## Installation and startup

```bash
npm install
npm start
```

Open `http://localhost:3001`.

Use the Express server rather than a frontend-only static server. Password reset, VLM extraction, PayMongo, user creation, and protected POS inventory finalization depend on `/api` routes.

## Configuration

Create a root `.env` file. It is ignored by Git and must never be committed.

```env
PORT=3001

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

DEEPSEEK_API_KEY=your-deepseek-key
VLM_MODEL=deepseek-v4-flash-vision-exp
DEEPSEEK_API_ENDPOINT=https://api.deepseek.com/chat/completions
PYTHON_BINARY=python

EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-email-app-password
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false

PAYMONGO_SECRET_KEY=sk_test_your_test_key
```

The browser Supabase URL and anonymous key are currently configured in `scripts/config.js`. The service-role key belongs only in `.env` and is used by protected server operations.

### Required session-security migration

The Free Supabase plan does not provide the dashboard's built-in single-session setting. Before deploying the current frontend, run this complete file through **Supabase Dashboard -> SQL Editor**:

```text
supabase/migrations/20260903_first_login_wins.sql
```

The migration adds active-session fields to `public.users` and creates authenticated RPC functions for claiming, validating, refreshing, and releasing the session lock. It also replaces the earlier latest-login-wins functions if that draft was previously installed.

### Required archive and RLS alignment

After applying the session-security migration, back up the hosted database and run this file through **Supabase Dashboard -> SQL Editor**:

```text
AMACAR_RLS_FLOW_ALIGNMENT.sql
```

The migration adds archive metadata to products, categories, and user profiles; replaces conflicting permissive policies; enables RLS on exposed operational tables; and aligns database access with the `owner`, `admin`, `cashier`, and `staff` application roles. The legacy `manager` value remains temporarily recognized for existing records, but new accounts should use `owner`.

`AMACAR_ADMIN_ACCESS_RECOVERY.sql` is an emergency repair script for databases where a recursive `public.users` policy prevents the application from resolving the signed-in role. It is not a substitute for the complete alignment migration, and the older recursive policy script must not be reapplied afterward.

## Roles and access

| Role | Main access |
| --- | --- |
| `owner` | Full business operations, product archive/restore, user activation/deactivation, activity history, inventory, reports, receipt scanning, and POS; technical scanner configuration is hidden and server-blocked |
| `admin` | Full business and technical administration, including archive/restore and receipt-scanner credentials, model, and endpoint configuration |
| `cashier` | Dashboard, POS, and cashier-focused sales reports |
| `staff` | Dashboard, reports, VLM extraction, reorder lists, routine stock adjustments and removals, and product creation/editing; existing pricing, archive/restore, backup/restore, and technical scanner settings remain restricted |

The UI hides unauthorized navigation, while sensitive server endpoints validate the Supabase access token and role. Supabase Row Level Security should still be configured for every exposed table.

## Current security controls

| Control | Current behavior |
| --- | --- |
| Authentication | Supabase Auth issues and refreshes access and refresh tokens. Protected pages require an active authenticated session. |
| First login wins | The first active browser claims the account lock. A later browser using the same account is rejected and locally signed out instead of interrupting the original user. |
| Session heartbeat | Protected pages validate the session approximately every 10 seconds and whenever a hidden tab becomes visible. Successful validation refreshes `active_session_last_seen`. |
| Abandoned-session recovery | A lock without a heartbeat for 15 minutes becomes stale, allowing a legitimate new login when the original browser closed without signing out. |
| Inactivity timeout | Activity is shared across tabs in the same browser. After 5 minutes without user activity, the browser signs out and releases its lock; a warning appears during the final two minutes. |
| Logout isolation | Rejected and automatic logouts use local scope so a stale browser cannot revoke another browser's valid Supabase session. Normal logout releases the database lock. |
| Failed-login throttling | Password failures are tracked in browser storage. Groups of three failures trigger progressively longer local lockouts of 5, 10, and 15 minutes. |
| Active-account check | Only profiles with `users.is_active = true` can claim or retain the application session lock. |
| Role-based access | Navigation and actions are limited by `owner`, `admin`, `cashier`, and `staff` roles. The `owner` role replaces the former `manager` role. Sensitive Express routes separately validate the JWT and required role. Scanner configuration remains exclusive to `admin`. |
| Auditability | Supported login, logout, inventory, and management actions write user-linked audit data; stock changes produce traceable movement records. |
| Archiving | Products are archived by setting `is_active = false`; archive time and actor are recorded while inventory, movements, sales, VLM matches, and audit history remain intact. Staff accounts are deactivated rather than deleted. |
| Durable history | Authenticated browser clients cannot hard-delete products, users, stock movements, audit logs, or finalized POS records. Stock movements and audit logs are append-only. |
| Secret separation | Service-role, SMTP, payment, and VLM secrets remain server-side in `.env`. The browser's public Supabase anonymous key must be constrained by RLS. |

The first-login-wins mechanism is application-level enforcement backed by database RPC functions. It prevents concurrent use through the normal interface, but it does not replace Row Level Security. `AMACAR_RLS_FLOW_ALIGNMENT.sql` supplies the role-aware policies required by the browser and protected server workflows. The browser failed-login counter is also a usability safeguard; production deployments should retain server/provider rate limits and Supabase attack-protection controls.

## Archive and retention behavior

- Active products are shown by default. Management can select **Archived Products** under Inventory filters and restore a product.
- Archiving a product never deletes its stock row, movement history, POS references, extraction matches, or audit records.
- Archived products are excluded from Sales Checkout, receipt matching, outbound selection, and reorder generation.
- Staff accounts use Activate/Deactivate. Deactivation preserves historical attribution and blocks the account through the active-account checks.
- Finalized sales use the existing Void workflow and are never deleted. Only an empty POS draft may be removed automatically when line-item creation fails.
- Inventory and staff-account backup restoration supports Merge and Add Only. Destructive replacement is disabled.
- Database retention is governed by the organization's documented retention schedule. Archive is an operational state, not indefinite retention or a replacement for authorized secure disposal.

## Current API routes

All routes are mounted under `/api`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/send-otp` | Send a password-reset OTP |
| `POST` | `/verify-otp` | Verify a password-reset OTP |
| `POST` | `/reset-password` | Reset a user password |
| `POST` | `/vlm-scan` | Process a receipt image |
| `POST` | `/vlm-scan-supplier` | Process a supplier receipt image with the supplier-focused extraction workflow |
| `GET` | `/vlm-extraction-history` | List reviewed extractions successfully saved to inventory |
| `GET` | `/categories` | Read active categories available to receipt extraction |
| `GET` | `/vlm-config` | Read the active VLM configuration |
| `POST` | `/vlm-config` | Update VLM configuration |
| `POST` | `/save-items-to-inventory` | Save extracted receipt items into inventory |
| `POST` | `/paymongo/checkout` | Create a PayMongo test checkout session |
| `GET` | `/paymongo/checkout/:checkoutId` | Verify a PayMongo checkout session |
| `POST` | `/pos/transactions/:transactionId/finalize` | Deduct sold quantities and record stock movements |


Most product, transaction, report, and audit operations use the Supabase client directly rather than custom REST endpoints.

## Database model

The application currently uses these main public tables:

- `users` — profile, role, status, OTP, and login information linked to `auth.users`
- `products` — product identity, unit, prices, thresholds, status, and image metadata
- `inventory_stock` — one stock row per product with quantity and restock/sale timestamps
- `stock_movements` — inbound, outbound, and adjustment history
- `stock_alerts` — threshold alerts and acknowledgement/resolution details
- `pos_transactions` — sale totals, payment details, customer details, and void status
- `pos_transaction_items` — product snapshots and quantities for each POS transaction
- `receipt_images` — uploaded receipt-image metadata
- `vlm_processing_logs` — VLM processing attempts, status, timing, and errors
- `vlm_extractions` — supplier, receipt totals, confidence, status, and raw extraction data
- `extracted_line_items` — extracted receipt items and optional product matches
- `audit_logs` — user actions and before/after values
- `backup_logs` — backup execution and retention metadata

Important relationships:

```text
auth.users ── users
products ── inventory_stock
products ── stock_movements
products ── stock_alerts
pos_transactions ── pos_transaction_items ── products
receipt_images ── vlm_processing_logs
receipt_images ── vlm_extractions ── extracted_line_items
```

Product categories are normalized in `categories`; `products.category_id` stores the approved category and VLM line items can carry a validated category suggestion and confidence score.

The session-security migration adds `users.active_session_id`, `users.active_session_created_at`, and `users.active_session_last_seen`. The lock is matched against the `session_id` in the authenticated Supabase JWT, and only the `authenticated` role receives permission to execute its session RPC functions.

## Storage

- `product-images` stores product photos referenced by `products.image_path`/`image_url`.
- Receipt image metadata is stored in `receipt_images`; bucket access and retention should match the policies configured in Supabase.

## Operational notes

- Restart the Node server after changing backend files or `.env` values.
- PayMongo integration requires a test secret beginning with `sk_test_`.
- POS inventory finalization must go through Express so the server can perform the protected stock update after validating the signed-in user.
- Stock changes should create corresponding `stock_movements` rows for traceability.
- Keep the Supabase service-role key, SMTP password, DeepSeek key, and PayMongo secret out of browser code and version control.
- Apply `supabase/migrations/20260903_first_login_wins.sql` before testing authentication, including when replacing the earlier latest-login-wins draft.
- Back up the database before applying `AMACAR_RLS_FLOW_ALIGNMENT.sql`; sign out of all application tabs and sign in again after policy changes.
- Do not reapply the superseded RLS script that queries `public.users` from a policy on the same table; it causes recursive role lookup and access denial.

## Known limitation

The current user-management screen calls `/api/create-user-with-auth` when adding a user, but that route is not registered by the present Express server. Viewing and editing existing profiles use Supabase directly; creating a new authenticated user requires that server route to be restored or replaced.

## Troubleshooting

### The application loads but API actions return 404

Open the application through `http://localhost:3001`, not a Live Server port, and confirm `npm start` is running.

### POS transaction saves but inventory does not change

Restart the server to load `pos-api.js`, confirm `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are present, and inspect the response from `/api/pos/transactions/:transactionId/finalize`.

### Supabase requests fail

Verify the project URL/keys and relevant RLS policies. Browser operations use the signed-in user's JWT; protected server operations use the service role only after authorization checks.

### Login says session security is not configured

Run `supabase/migrations/20260903_first_login_wins.sql` in the Supabase SQL Editor. Confirm that `public.users` contains the three `active_session_*` fields and that `claim_current_session`, `is_current_session`, and `release_current_session` appear under Database Functions. Refresh the browser after the migration completes.

### Admin navigation appears but the page says Access Denied

Inspect the browser console for an infinite-recursion error on `public.users`. Run `AMACAR_ADMIN_ACCESS_RECOVERY.sql`, sign out, close all application tabs, and sign in again. Then apply `AMACAR_RLS_FLOW_ALIGNMENT.sql` for the complete policy set. Do not rerun the superseded recursive RLS script.

### Archived product is still visible in operational screens

Hard-refresh the browser to load the current frontend. Confirm `products.is_active = false`, then verify that Inventory is using the Active Products filter and that Sales Checkout, outbound selection, receipt matching, and reorder queries filter for active products.

### A user is incorrectly reported as already signed in

Ask the user to sign out from the original browser. If that browser was closed or lost connectivity, leave the account inactive for 15 minutes so its heartbeat expires. Administrators can inspect the three `active_session_*` fields, but should not clear a live lock without confirming the original user is no longer working.

### Password-reset email is not sent

Check the SMTP variables and use an app password when required by the email provider.

### Receipt extraction fails

Check `DEEPSEEK_API_KEY`, `VLM_MODEL`, `PYTHON_BINARY`, and the server console. The VLM configuration can also be inspected through `/api/vlm-config`.

## License

This project was developed as a capstone system for Amacar Hardware.
