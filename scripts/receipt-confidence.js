(function (root) {
    const fields = ['name', 'real_quantity', 'unit_price', 'unit_of_measure'];
    function number(value) {
        if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object' || String(value).trim() === '') return null;
        const result = Number(value);
        return Number.isFinite(result) ? result : null;
    }
    function valid(item, field) {
        const value = item[field];
        if (field === 'real_quantity') return Number.isSafeInteger(number(value)) && number(value) > 0;
        if (field === 'unit_price') return number(value) !== null && number(value) >= 0;
        return typeof value === 'string' && value.trim().length >= (field === 'name' ? 2 : 1);
    }
    function state(item, field) {
        const meta = item.field_confidence?.[field] || {};
        const raw = number(meta.confidence);
        const score = raw !== null && raw >= 0 && raw <= 1 ? raw : null;
        const issue = typeof meta.issue === 'string' ? meta.issue : '';
        if (!valid(item, field)) return { level: 'low', label: 'Value required', score, issue: field === 'real_quantity' ? 'Enter a positive whole quantity.' : 'Enter a valid value.' };
        if (issue) return { level: 'low', label: 'Low VLM confidence', score, issue };
        if (score === null) return { level: 'unknown', label: 'Confidence unavailable', score, issue };
        if (score < 0.7) return { level: 'low', label: 'Low VLM confidence', score, issue };
        if (score < 0.9) return { level: 'medium', label: 'Medium VLM confidence', score, issue };
        return { level: 'high', label: 'High VLM confidence', score, issue };
    }
    function problems(item) {
        return fields.filter(field => !valid(item, field));
    }
    const api = { fields, number, valid, state, problems };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ReceiptConfidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
