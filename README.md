# Amacar Hardware Inventory Management System

A web-based inventory and point-of-sale system for Amacar Hardware. The current application manages products and stock directly; the legacy product-category module has been removed.

## Current features

- Dashboard metrics for inventory, sales, recent transactions, stock movements, and top products by value
- Product inventory management with images, pricing, stock thresholds, adjustments, and active/inactive status
- Inbound inventory through VLM-assisted receipt extraction and product matching
- Manual outbound transactions for sales, returns, damage/disposal, transfers, and other stock-outs
- Point of Sale (POS) with cart management, discounts, cash payments, PayMongo test checkout, receipts, transaction history, and voiding
- Automatic POS inventory deductions and stock-movement records through an authenticated server endpoint
- Low-stock monitoring and stock alerts
- Inventory, valuation, low-stock, stock-movement, and cashier sales reports
- Audit logs and stock-movement history with export options
- User viewing, editing, activation, backup/restore, and role assignment for `admin`, `manager`, `cashier`, and `staff`
- Supabase authentication, OTP password reset, inactivity logout, role-based navigation, responsive layouts, and dark mode
- Inventory and user backup/restore tools

## Technology

- Frontend: HTML, CSS, vanilla JavaScript, Chart.js, and Supabase JS
- Backend: Node.js and Express
- Database/authentication/storage: Supabase (PostgreSQL, Auth, Realtime, and Storage)
- Receipt extraction: OpenRouter vision models with a Python VLM helper
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
`-- components/sidebar.html    # Shared desktop/mobile navigation
```

## Prerequisites

- Node.js 18 or newer (the server uses the built-in `fetch` API)
- npm
- A configured Supabase project
- Python available as `python`, or configured through `PYTHON_BINARY`, for receipt-image processing
- OpenRouter, SMTP, and PayMongo test credentials for their respective optional workflows

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

OPENROUTER_API_KEY=your-openrouter-key
VLM_MODEL=your-vision-language-model
PYTHON_BINARY=python

EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-email-app-password
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false

PAYMONGO_SECRET_KEY=sk_test_your_test_key
```

The browser Supabase URL and anonymous key are currently configured in `scripts/config.js`. The service-role key belongs only in `.env` and is used by protected server operations.

## Roles and access

| Role | Main access |
| --- | --- |
| `admin` | Full navigation, user management, audit logs, inventory, reports, VLM, and POS |
| `manager` | Dashboard, inventory, reports, VLM, and POS; selected management operations |
| `cashier` | Dashboard, POS, and cashier-focused sales reports |
| `staff` | Dashboard, inventory, reports, and VLM extraction workflows |

The UI hides unauthorized navigation, while sensitive server endpoints validate the Supabase access token and role. Supabase Row Level Security should still be configured for every exposed table.

## Current API routes

All routes are mounted under `/api`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/send-otp` | Send a password-reset OTP |
| `POST` | `/verify-otp` | Verify a password-reset OTP |
| `POST` | `/reset-password` | Reset a user password |
| `POST` | `/vlm-scan` | Process a receipt image |
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

There is no `categories` table or `products.category_id` field in the current application.

## Storage

- `product-images` stores product photos referenced by `products.image_path`/`image_url`.
- Receipt image metadata is stored in `receipt_images`; bucket access and retention should match the policies configured in Supabase.

## Operational notes

- Restart the Node server after changing backend files or `.env` values.
- PayMongo integration requires a test secret beginning with `sk_test_`.
- POS inventory finalization must go through Express so the server can perform the protected stock update after validating the signed-in user.
- Stock changes should create corresponding `stock_movements` rows for traceability.
- Keep the Supabase service-role key, SMTP password, OpenRouter key, and PayMongo secret out of browser code and version control.

## Known limitation

The current user-management screen calls `/api/create-user-with-auth` when adding a user, but that route is not registered by the present Express server. Viewing and editing existing profiles use Supabase directly; creating a new authenticated user requires that server route to be restored or replaced.

## Troubleshooting

### The application loads but API actions return 404

Open the application through `http://localhost:3001`, not a Live Server port, and confirm `npm start` is running.

### POS transaction saves but inventory does not change

Restart the server to load `pos-api.js`, confirm `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are present, and inspect the response from `/api/pos/transactions/:transactionId/finalize`.

### Supabase requests fail

Verify the project URL/keys and relevant RLS policies. Browser operations use the signed-in user's JWT; protected server operations use the service role only after authorization checks.

### Password-reset email is not sent

Check the SMTP variables and use an app password when required by the email provider.

### Receipt extraction fails

Check `OPENROUTER_API_KEY`, `VLM_MODEL`, `PYTHON_BINARY`, and the server console. The VLM configuration can also be inspected through `/api/vlm-config`.

## License

This project was developed as a capstone system for Amacar Hardware.
