const TAX_RATE = 0.12; // 12% VAT for Philippines
const MIN_DISCOUNT_APPROVAL_AMOUNT = 1000; // Discounts above this need manager approval

const POSCalculations = {
    TAX_RATE,
    MIN_DISCOUNT_APPROVAL_AMOUNT,

    /**
     * Sum of price * quantity across all cart items.
     */
    calculateSubtotal(cart) {
        return (cart || []).reduce((sum, item) => sum + (item.price * item.quantity), 0);
    },

    /**
     * VAT on the taxable (post-discount) amount.
     */
    calculateTax(taxableAmount) {
        return Math.max(0, taxableAmount) * TAX_RATE;
    },

    /**
     * Full breakdown used by both the on-screen summary and the receipt,
     * so they can never drift out of sync with each other.
     */
    calculateTotals(cart, discountAmount = 0) {
        const subtotal = this.calculateSubtotal(cart);
        const safeDiscount = Math.max(0, discountAmount || 0);
        const taxableAmount = Math.max(0, subtotal - safeDiscount);
        const tax = this.calculateTax(taxableAmount);
        const total = taxableAmount + tax;

        return {
            subtotal,
            discountAmount: safeDiscount,
            taxableAmount,
            tax,
            total
        };
    },

    /**
     * Change due for a cash payment. Never negative — insufficient tender
     * should be caught by validation before this is called.
     */
    calculateChange(total, tenderAmount) {
        return Math.max(0, (tenderAmount || 0) - (total || 0));
    },

    /**
     * Discounts above MIN_DISCOUNT_APPROVAL_AMOUNT require a manager
     * sign-off before checkout can proceed.
     */
    requiresDiscountApproval(discountAmount) {
        return (discountAmount || 0) > MIN_DISCOUNT_APPROVAL_AMOUNT;
    },

    /**
     * Consistent ₱ formatting used across the cart summary and receipt.
     */
    formatCurrency(amount) {
        return `₱${parseFloat(amount || 0).toFixed(2)}`;
    }
};

window.POSCalculations = POSCalculations;