const ReceiptPrinter = {
    generateHTML(transaction) {
        const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[character]);
        const fmt = window.POSCalculations
            ? window.POSCalculations.formatCurrency
            : (n) => `₱${parseFloat(n || 0).toFixed(2)}`;
        const paymentLabel = transaction.payment_method === 'bank_transfer'
            ? 'QR / E-wallet (PayMongo)'
            : transaction.payment_method;
        const isVoided = transaction.is_voided === true || transaction.is_active === false;
        const voidedAt = transaction.void_datetime ? new Date(transaction.void_datetime).toLocaleString() : '';
        const voidNotice = isVoided ? `
            <div class="receipt-void-notice">
                <strong>VOIDED TRANSACTION</strong>
                ${voidedAt ? `<span>Voided: ${escapeHTML(voidedAt)}</span>` : ''}
                ${transaction.void_reason ? `<span>Reason: ${escapeHTML(transaction.void_reason)}</span>` : ''}
            </div>` : '';

        const itemsHTML = transaction.pos_transaction_items
            ? transaction.pos_transaction_items.map(item => {
                const lineTotal = item.line_total ?? item.subtotal ?? item.item_total ?? (Number(item.unit_price || 0) * Number(item.quantity || 0));
                return `
                    <tr>
                        <td>${item.quantity}x</td>
                        <td>${item.product_name || item.products?.product_name || item.product_id}</td>
                        <td>${fmt(item.unit_price)}</td>
                        <td>${fmt(lineTotal)}</td>
                    </tr>
                `;
            }).join('')
            : '';

        const discountRow = transaction.discount_amount > 0
            ? `<div class="summary-line">
                   <span>Discount:</span>
                   <span>-${fmt(transaction.discount_amount)}</span>
               </div>`
            : '';

        return `
            <div class="receipt-header">
                <h2>Amacar Hardware</h2>
                <p>Inventory Management System</p>
                <p>Receipt #${transaction.transaction_number || transaction.transaction_id}</p>
            </div>

            ${voidNotice}

            <div class="receipt-details">
                <p><strong>Date:</strong> ${new Date(transaction.transaction_datetime).toLocaleString()}</p>
                <p><strong>Payment Method:</strong> ${paymentLabel}</p>
            </div>

            <table class="receipt-items">
                <thead>
                    <tr>
                        <th>Qty</th>
                        <th>Description</th>
                        <th>Price</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHTML}
                </tbody>
            </table>

            <div class="receipt-summary">
                <div class="summary-line">
                    <span>Subtotal:</span>
                    <span>${fmt(transaction.subtotal)}</span>
                </div>
                ${discountRow}
                <div class="summary-line">
                    <span>Tax (VAT):</span>
                    <span>${fmt(transaction.tax_amount)}</span>
                </div>
                <div class="summary-line total">
                    <span>Total:</span>
                    <span>${fmt(transaction.total_amount)}</span>
                </div>
            </div>

            <div class="receipt-footer">
                ${isVoided
                    ? '<p><strong>This receipt has been voided and is not valid as proof of purchase.</strong></p>'
                    : '<p>Thank you for your purchase!</p><p>Please keep this receipt for warranty purposes.</p>'}
            </div>
        `;
    },

    /**
     * A minimal, self-contained HTML document for the print window — it
     * can't rely on pos.css since it opens as a separate window/tab.
     */
    generatePrintDocument(transaction) {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Receipt ${transaction.transaction_number || transaction.transaction_id}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Courier New', Courier, monospace;
            width: 320px;
            margin: 0 auto;
            padding: 16px;
            color: #111;
        }
        .receipt-header { text-align: center; margin-bottom: 12px; }
        .receipt-header h2 { margin: 0 0 4px; font-size: 1.3rem; letter-spacing: 0.04em; }
        .receipt-header p { margin: 2px 0; font-size: 0.85rem; }
        .receipt-details {
            border-top: 1px dashed #333;
            border-bottom: 1px dashed #333;
            padding: 8px 0;
            margin-bottom: 8px;
            font-size: 0.85rem;
        }
        .receipt-details p { margin: 3px 0; }
        .receipt-void-notice { border: 3px double #b91c1c; color: #b91c1c; margin: 10px 0; padding: 8px; text-align: center; }
        .receipt-void-notice strong, .receipt-void-notice span { display: block; }
        .receipt-void-notice strong { font-size: 1.15rem; margin-bottom: 4px; }
        .receipt-items { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 0.82rem; }
        .receipt-items th, .receipt-items td { padding: 4px 2px; text-align: left; }
        .receipt-items th { border-bottom: 1px solid #333; text-transform: uppercase; font-size: 0.7rem; }
        .receipt-summary { border-top: 1px dashed #333; padding-top: 8px; font-size: 0.88rem; }
        .summary-line { display: flex; justify-content: space-between; margin: 3px 0; }
        .summary-line.total { font-weight: 700; font-size: 1.05rem; border-top: 1px dashed #333; padding-top: 6px; margin-top: 6px; }
        .receipt-footer { margin-top: 14px; text-align: center; border-top: 1px dashed #333; padding-top: 10px; font-size: 0.82rem; }
        .receipt-footer p { margin: 2px 0; }
        @media print {
            body { width: 100%; }
        }
    </style>
</head>
<body>
    ${this.generateHTML(transaction)}
</body>
</html>`;
    },

    /**
     * Opens the receipt in its own window and triggers the browser print
     * dialog, so what gets printed is just the receipt — not the cart,
     * sidebar, or modal chrome.
     */
    print(transaction) {
        if (!transaction) {
            console.warn('ReceiptPrinter.print called with no transaction');
            return;
        }

        const printWindow = window.open('', '_blank', 'width=400,height=640');
        if (!printWindow) {
            alert('Please allow pop-ups for this site to print the receipt.');
            return;
        }

        printWindow.document.write(this.generatePrintDocument(transaction));
        printWindow.document.close();
        printWindow.onload = () => {
            printWindow.focus();
            printWindow.print();
        };
    },

    /**
     * Placeholder — no email-sending backend wired up yet. Kept as its own
     * method so hooking up a real email flow later doesn't need to touch
     * pos.js at all.
     */
    email(transaction) {
        if (!transaction) {
            console.warn('ReceiptPrinter.email called with no transaction');
            return;
        }
        alert('Email receipt is not set up yet. This will send a copy of the receipt to the customer once email delivery is configured.');
    }
};

window.ReceiptPrinter = ReceiptPrinter;
