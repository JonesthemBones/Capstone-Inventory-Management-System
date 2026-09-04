# Amacar Hardware Inventory Management System

A Web-based inventory and point-of-sale system for Amacar Hardware. The application manages products, categories, stock, receipt extraction, and sales workflows.

## Project status

The system is in active capstone development and currently supports its main end-to-end workflows: authenticated role-based access, inventory maintenance, inbound receipt extraction, outbound stock processing, POS sales, reporting, audit history, and backup/restore. Desktop and mobile layouts are implemented, including cashier-focused mobile POS controls and dark mode.

The current development focus is interface refinement, data consistency, production configuration, and validation of external integrations. See [Known limitation](#known-limitation) for the remaining user-creation API issue.

## Current features

- Dashboard metrics for inventory, sales, recent transactions, stock movements, and top products by value
- Product inventory management with categories, images, pricing, stock thresholds, adjustments, inbound batch history, active/inactive status, filtering, and pagination
- Inbound inventory through VLM-assisted receipt extraction and product matching
- Manual outbound transactions for sales, returns, damage/disposal, transfers, and other stock-outs
- Point of Sale (POS) with category filtering, cart management, discounts, cash payments, PayMongo test checkout, receipts, transaction history, and voiding
- Automatic POS inventory deductions and stock-movement records through an authenticated server endpoint
- Low-stock monitoring and stock alerts
- Admin reorder-list generation for low, critical, and out-of-stock products, with editable suggested quantities and a printable purchase document
- Inventory, valuation, low-stock, stock-movement, and cashier sales reports
- Audit logs and stock-movement history with export options
- User viewing, editing, activation, backup/restore, and role assignment for `admin`, `cashier`, and `staff`
- Supabase authentication, OTP password reset, first-login-wins session control, inactivity logout, failed-login throttling, role-based navigation, responsive desktop/mobile layouts, and dark mode
- Inventory and user backup/restore tools

## Recent progress and interface changes

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
- Reordered mobile inventory actions to `Delete | Edit | Adjust`, added a visible Delete label, and retained confirmation before deletion.
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
| Inventory actions | Authorized users receive evenly sized `Delete`, `Edit`, and `Adjust` controls. Delete is positioned on the left, visually marked as destructive, and still requires confirmation. |
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

## Roles and access

| Role | Main access |
| --- | --- |
| `admin` | Full navigation, user management, audit logs, inventory, reports, VLM, and POS |
| `cashier` | Dashboard, POS, and cashier-focused sales reports |
| `staff` | Dashboard, inventory, reports, and VLM extraction workflows |

The UI hides unauthorized navigation, while sensitive server endpoints validate the Supabase access token and role. Supabase Row Level Security should still be configured for every exposed table.

## Current security controls

| Control | Current behavior |
| --- | --- |
| Authentication | Supabase Auth issues and refreshes access and refresh tokens. Protected pages require an active authenticated session. |
| First login wins | The first active browser claims the account lock. A later browser using the same account is rejected and locally signed out instead of interrupting the original user. |
| Session heartbeat | Protected pages validate the session approximately every 10 seconds and whenever a hidden tab becomes visible. Successful validation refreshes `active_session_last_seen`. |
| Abandoned-session recovery | A lock without a heartbeat for 15 minutes becomes stale, allowing a legitimate new login when the original browser closed without signing out. |
| Inactivity timeout | Activity is shared across tabs in the same browser. After 15 minutes without user activity, the browser signs out and releases its lock; a warning appears during the final two minutes. |
| Logout isolation | Rejected and automatic logouts use local scope so a stale browser cannot revoke another browser's valid Supabase session. Normal logout releases the database lock. |
| Failed-login throttling | Password failures are tracked in browser storage. Groups of three failures trigger progressively longer local lockouts of 5, 10, and 15 minutes. |
| Active-account check | Only profiles with `users.is_active = true` can claim or retain the application session lock. |
| Role-based access | Navigation and actions are limited by `admin`, `cashier`, and `staff` roles. Sensitive Express routes separately validate the JWT and required role. |
| Auditability | Supported login, logout, inventory, and management actions write user-linked audit data; stock changes produce traceable movement records. |
| Secret separation | Service-role, SMTP, payment, and VLM secrets remain server-side in `.env`. The browser's public Supabase anonymous key must be constrained by RLS. |

The first-login-wins mechanism is application-level enforcement backed by database RPC functions. It prevents concurrent use through the normal interface, but it does not replace Row Level Security. Every Data API table still needs suitable RLS policies because a valid JWT may otherwise access exposed tables outside the interface. The browser failed-login counter is also a usability safeguard; production deployments should retain server/provider rate limits and Supabase attack-protection controls.

## Current API routes

All routes are mounted under `/api`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/send-otp` | Send a password-reset OTP |
| `POST` | `/verify-otp` | Verify a password-reset OTP |
| `POST` | `/reset-password` | Reset a user password |
| `POST` | `/vlm-scan` | Process a receipt image |
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

### A user is incorrectly reported as already signed in

Ask the user to sign out from the original browser. If that browser was closed or lost connectivity, leave the account inactive for 15 minutes so its heartbeat expires. Administrators can inspect the three `active_session_*` fields, but should not clear a live lock without confirming the original user is no longer working.

### Password-reset email is not sent

Check the SMTP variables and use an app password when required by the email provider.

### Receipt extraction fails

Check `DEEPSEEK_API_KEY`, `VLM_MODEL`, `PYTHON_BINARY`, and the server console. The VLM configuration can also be inspected through `/api/vlm-config`.

## License

This project was developed as a capstone system for Amacar Hardware.
