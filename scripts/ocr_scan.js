const OCR_API_ENDPOINT = 'http://localhost:3001/api/ocr-scan';
let currentReceiptImage = null;
let currentItems = [];

function setStatus(message, variant = 'neutral') {
    const statusElement = document.getElementById('ocr-status');
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.className = `ocr-status ocr-status-${variant}`;
}

function setPreviewImage(dataUrl) {
    const preview = document.getElementById('receipt-image-preview');
    const viewButton = document.getElementById('view-receipt-image-btn');
    const modalImage = document.getElementById('receipt-image-modal-img');
    if (!preview) return;
    if (!dataUrl) {
        preview.innerHTML = 'No image selected';
        preview.style.backgroundImage = 'none';
        if (viewButton) viewButton.style.display = 'none';
        if (modalImage) modalImage.src = '';
        return;
    }
    preview.innerHTML = '';
    preview.style.backgroundImage = `url('${dataUrl}')`;
    if (viewButton) viewButton.style.display = 'inline-flex';
    if (modalImage) modalImage.src = dataUrl;
}

function openReceiptImagePreview() {
    const modal = document.getElementById('receipt-image-modal');
    const modalImage = document.getElementById('receipt-image-modal-img');
    if (!modal || !modalImage) return;
    if (!modalImage.src) return;
    modal.classList.add('active');
}

function closeReceiptImagePreview(event) {
    const modal = document.getElementById('receipt-image-modal');
    if (!modal) return;
    if (event && event.target !== modal && event.target.closest('.ocr-image-modal-content')) {
        return;
    }
    modal.classList.remove('active');
}

function clearReceiptSelection() {
    const input = document.getElementById('receipt-image-input');
    if (input) {
        input.value = '';
    }
    currentReceiptImage = null;
    setPreviewImage(null);
    setStatus('No receipt selected. Choose or capture a receipt to begin.');
    document.getElementById('ocr-items-grid').innerHTML = '';
    document.getElementById('ocr-raw-output').hidden = true;
    currentItems = [];
    updateSaveButton();
}

function parseOCRResponse(responseBody) {
    if (!responseBody) return null;

    // If the backend already returned a structured object.
    if (typeof responseBody === 'object') {
        if (Array.isArray(responseBody)) {
            return { items: responseBody };
        }
        if (responseBody.items) {
            return responseBody;
        }
        return responseBody;
    }

    const text = String(responseBody).trim();
    try {
        return JSON.parse(text);
    } catch (parseError) {
        const jsonBlock = text.match(/\{[\s\S]*\}/);
        if (jsonBlock) {
            try {
                return JSON.parse(jsonBlock[0]);
            } catch (innerError) {
                return null;
            }
        }
        return null;
    }
}

function normalizeProductName(text) {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function mergeWithExistingProductDefaults(items) {
    if (!window.supabaseClient || !items || items.length === 0) {
        return items;
    }

    try {
        const { data: products, error } = await window.supabaseClient
            .from('products')
            .select('product_name, unit_price, selling_price, unit_of_measure');

        if (error || !products) {
            return items;
        }

        const productMap = new Map();
        products.forEach(product => {
            const key = normalizeProductName(product.product_name);
            if (key) {
                productMap.set(key, product);
            }
        });

        return items.map(item => {
            const key = normalizeProductName(item.name);
            const product = productMap.get(key);
            if (!product) {
                return item;
            }

            return {
                ...item,
                unit_price: Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : Number(product.unit_price) || item.unit_price,
                selling_price: Number.isFinite(Number(product.selling_price)) ? Number(product.selling_price) : item.selling_price,
                unit_of_measure: String(product.unit_of_measure || item.unit_of_measure || 'unit').trim() || 'unit'
            };
        });
    } catch (error) {
        console.warn('Unable to merge OCR items with existing product defaults:', error);
        return items;
    }
}

function normalizeItemsFromReceipt(rawReceipt) {
    let items = [];
    if (!rawReceipt) {
        return items;
    }

    if (Array.isArray(rawReceipt)) {
        items = rawReceipt;
    } else if (Array.isArray(rawReceipt.items)) {
        items = rawReceipt.items;
    } else if (Array.isArray(rawReceipt.line_items)) {
        items = rawReceipt.line_items;
    } else if (Array.isArray(rawReceipt.data)) {
        items = rawReceipt.data;
    }

    return items.map((item, idx) => {
        const name = item.name || item.item || item.description || `Item ${idx + 1}`;
        const price = Number(item.price ?? item.amount ?? item.receipt_amount ?? 0);
        const receiptQuantity = Number(item.receipt_quantity ?? item.quantity ?? item.qty ?? 1);
        const realQuantity = item.real_quantity !== undefined && item.real_quantity !== null
            ? Number(item.real_quantity)
            : receiptQuantity;
        const unitPrice = Number.isFinite(price) ? price : 0;
        const sellingPriceValue = item.selling_price ?? item.sale_price ?? unitPrice;
        const sellingPrice = Number.isFinite(Number(sellingPriceValue)) ? Number(sellingPriceValue) : unitPrice;
        const unitOfMeasure = String(item.unit_of_measure ?? item.unit ?? 'unit').trim();
        const confidenceValue = item.confidence ?? item.confidence_score ?? item.score ?? item.confidenceScore;
        const confidence = Number.isFinite(Number(confidenceValue)) ? Number(confidenceValue) : null;
        const comment = item.comment ?? item.notes ?? '';
        const accepted = item.accepted === true;
        return {
            id: `ocr-item-${idx}`,
            name,
            price,
            unit_price: unitPrice,
            selling_price: sellingPrice,
            unit_of_measure: unitOfMeasure || 'unit',
            receipt_quantity: receiptQuantity,
            real_quantity: realQuantity,
            confidence,
            comment,
            accepted,
            removed: item.removed === true,
        };
    });
}

function formatConfidence(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return 'N/A';
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 'N/A';
    }

    return `${Math.round(numeric * 100)}%`;
}

function renderItems(items) {
    const grid = document.getElementById('ocr-items-grid');
    if (!grid) return;

    if (items.length === 0) {
        grid.innerHTML = '<div class="ocr-empty-state">No items available. Scan a receipt to load items.</div>';
        return;
    }

    grid.innerHTML = items.map((item, index) => {
        const removedClass = item.removed ? 'ocr-card-removed' : '';
        const acceptedClass = item.accepted && !item.removed ? 'ocr-card-accepted' : '';
        const statusLabel = item.removed ? 'Rejected' : item.accepted ? 'Accepted' : 'Pending';
        const statusClass = item.removed ? 'ocr-item-status-rejected' : item.accepted ? 'ocr-item-status-accepted' : 'ocr-item-status-pending';
        const acceptLabel = item.accepted && !item.removed ? 'Accepted' : 'Accept';
        const acceptIcon = item.accepted && !item.removed ? 'fa-check-circle' : 'fa-check';
        const rejectLabel = item.removed ? 'Restore' : 'Reject';
        const rejectIcon = item.removed ? 'fa-undo' : 'fa-ban';
        const disableAccept = item.removed ? 'disabled' : '';

        return `
            <article class="ocr-card-item ${removedClass} ${acceptedClass}" data-index="${index}">
                <div class="ocr-card-item-header">
                    <div>
                        <h3>${escapeHtml(item.name)}</h3>
                        <p class="ocr-card-item-meta">Unit Price: <strong>₱${Number.isFinite(item.unit_price) ? item.unit_price.toFixed(2) : '0.00'}</strong> | Receipt Qty: <strong>${item.receipt_quantity}</strong> | Confidence: <strong>${escapeHtml(formatConfidence(item.confidence))}</strong></p>
                        <span class="ocr-item-status ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="ocr-card-item-actions">
                        <button type="button" class="btn btn-secondary ocr-item-accept-btn" data-action="toggle-accept" ${disableAccept}>
                            <i class="fas ${acceptIcon}"></i>
                            ${acceptLabel}
                        </button>
                        <button type="button" class="btn btn-danger ocr-item-remove-btn" data-action="toggle-remove">
                            <i class="fas ${rejectIcon}"></i>
                            ${rejectLabel}
                        </button>
                    </div>
                </div>
                <div class="ocr-card-item-row">
                    <div class="ocr-card-item-field">
                        <label>Unit</label>
                        <input type="text" value="${escapeHtml(item.unit_of_measure || 'unit')}" data-field="unit_of_measure" data-index="${index}">
                    </div>
                    <div class="ocr-card-item-field">
                        <label>Selling Price</label>
                        <input type="number" step="0.01" min="0" value="${Number.isFinite(item.selling_price) ? item.selling_price.toFixed(2) : '0.00'}" data-field="selling_price" data-index="${index}">
                    </div>
                </div>
                <div class="ocr-card-item-row">
                    <div class="ocr-card-item-field">
                        <label>Real Quantity</label>
                        <input type="number" step="1" min="0" value="${item.real_quantity}" data-field="real_quantity" data-index="${index}">
                    </div>
                    <div class="ocr-card-item-field">
                        <label>Comment</label>
                        <textarea rows="2" data-field="comment" data-index="${index}">${escapeHtml(item.comment)}</textarea>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    updateSaveButton();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function getSupabaseAccessToken() {
    const sessionResult = await window.supabaseClient?.auth?.getSession?.();
    return sessionResult?.data?.session?.access_token || null;
}

function getOcrConfigStatusElement() {
    return document.getElementById('ocr-config-status');
}

function setOcrConfigStatus(message, variant = 'neutral') {
    const status = getOcrConfigStatusElement();
    if (!status) return;
    status.textContent = message;
    status.style.color = variant === 'error' ? '#b91c1c' : variant === 'success' ? '#047857' : 'var(--text-secondary)';
}

async function fetchAdminOCRConfig() {
    const token = await getSupabaseAccessToken();
    if (!token) {
        throw new Error('User is not authenticated.');
    }

    const response = await fetch('http://localhost:3001/api/ocr-config', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(result?.error || 'Failed to load OCR config.');
    }

    return result.config;
}

async function saveAdminOCRConfig() {
    const token = await getSupabaseAccessToken();
    if (!token) {
        alert('Unable to save OCR settings because you are not authenticated.');
        return;
    }

    const apiKeyInput = document.getElementById('ocr-api-key-input');
    const modelInput = document.getElementById('ocr-model-input');
    const saveButton = document.getElementById('save-ocr-config-btn');

    if (!apiKeyInput || !modelInput || !saveButton) return;

    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim();
    if (!apiKey || !model) {
        setOcrConfigStatus('API key and model name are both required.', 'error');
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    try {
        const response = await fetch('http://localhost:3001/api/ocr-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ apiKey, model })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result?.error || 'Unable to save OCR settings.');
        }

        setOcrConfigStatus('OCR settings saved successfully.', 'success');
        apiKeyInput.value = result.config?.apiKey || apiKey;
        modelInput.value = result.config?.model || model;
    } catch (error) {
        console.error('OCR config save failed:', error);
        setOcrConfigStatus(error.message || 'Failed to save OCR settings.', 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save"></i> Save OCR Settings';
    }
}

async function initAdminOCRSettings() {
    const adminSettings = document.getElementById('ocr-admin-settings');
    if (!adminSettings) return;

    const role = await window.authHelpers.getUserRole?.();
    if (role !== 'admin') {
        adminSettings.classList.add('hidden');
        return;
    }

    adminSettings.classList.remove('hidden');
    setOcrConfigStatus('Loading admin OCR settings...', 'neutral');

    const saveButton = document.getElementById('save-ocr-config-btn');
    if (saveButton) {
        saveButton.addEventListener('click', (event) => {
            event.preventDefault();
            saveAdminOCRConfig();
        });
    }

    try {
        const config = await fetchAdminOCRConfig();
        const apiKeyInput = document.getElementById('ocr-api-key-input');
        const modelInput = document.getElementById('ocr-model-input');
        if (apiKeyInput) apiKeyInput.value = config?.apiKey || '';
        if (modelInput) modelInput.value = config?.model || '';
        setOcrConfigStatus('Admin OCR settings loaded.', 'success');
    } catch (error) {
        console.error('Unable to load admin OCR settings:', error);
        setOcrConfigStatus('Unable to load admin settings.', 'error');
    }
}

function handleOcrItemGridInput(event) {
    const target = event.target;
    if (!target) return;

    const field = target.getAttribute('data-field');
    const index = Number(target.getAttribute('data-index'));
    if (!field || Number.isNaN(index)) return;

    let value;
    if (field === 'real_quantity') {
        value = Number(target.value);
    } else if (field === 'selling_price') {
        value = Number(target.value);
        if (!Number.isFinite(value)) {
            value = 0;
        }
    } else if (field === 'unit_of_measure') {
        value = target.value.trim();
    } else {
        value = target.value;
    }
    currentItems[index][field] = value;
}

function handleOcrItemGridClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    event.preventDefault();

    const parentCard = button.closest('.ocr-card-item');
    const index = Number(parentCard?.getAttribute('data-index'));
    if (Number.isNaN(index) || !currentItems[index]) return;

    const action = button.getAttribute('data-action');
    if (action === 'toggle-accept') {
        if (currentItems[index].removed) {
            return;
        }
        currentItems[index].accepted = !currentItems[index].accepted;
        currentItems[index].removed = false;
    } else if (action === 'toggle-remove') {
        currentItems[index].removed = !currentItems[index].removed;
        if (currentItems[index].removed) {
            currentItems[index].accepted = false;
        }
    }

    renderItems(currentItems);
    updateSaveButton();
}

function downloadJsonFile() {
    if (!currentItems || currentItems.length === 0) {
        alert('There are no items to download. Scan a receipt first.');
        return;
    }

    const payload = {
        items: currentItems.map(item => ({
            name: item.name,
            unit_price: item.unit_price,
            selling_price: item.selling_price,
            unit_of_measure: item.unit_of_measure,
            price: item.price,
            receipt_quantity: item.receipt_quantity,
            real_quantity: item.real_quantity,
            confidence: item.confidence,
            comment: item.comment,
            accepted: item.accepted,
            removed: item.removed,
        })),
        generated_at: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'receipt-items.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function processReceiptImage() {
    if (!currentReceiptImage || !currentReceiptImage.dataUrl) {
        alert('Please select or capture a receipt image before scanning.');
        return;
    }

    const imageDataUrl = currentReceiptImage.dataUrl;
    if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
        alert('The selected file is not a valid image. Please try again.');
        return;
    }

    setStatus('Scanning receipt... please wait.', 'warning');
    document.getElementById('ocr-items-grid').innerHTML = '';
    document.getElementById('ocr-raw-output').hidden = true;

    try {
        const response = await fetch(OCR_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ imageDataUrl })
        });

        const result = await response.json();
        if (!response.ok) {
            const message = result?.error || result?.message || 'Unable to scan receipt.';
            setStatus(`Scan failed: ${message}`, 'danger');
            return;
        }

        const parsed = parseOCRResponse(result.receipt ?? result);
        if (!parsed) {
            setStatus('Unable to parse OCR output. Please try again with a clearer receipt image.', 'danger');
            document.getElementById('ocr-raw-output').textContent = JSON.stringify(result.rawResponse || result, null, 2);
            document.getElementById('ocr-raw-output').hidden = false;
            return;
        }

        currentItems = normalizeItemsFromReceipt(parsed).map(item => ({
            ...item,
            accepted: false,
            removed: false,
            confidence: item.confidence ?? null,
        }));

        currentItems = await mergeWithExistingProductDefaults(currentItems);
        renderItems(currentItems);
        setStatus(`Receipt scanned successfully. ${currentItems.length} item(s) found.`, 'success');
        const rawOutput = document.getElementById('ocr-raw-output');
        rawOutput.textContent = JSON.stringify(parsed, null, 2);
        rawOutput.hidden = false;
    } catch (error) {
        console.error('Receipt scan error:', error);
        setStatus('Receipt scan failed. Check the backend server and try again.', 'danger');
    }
}

function setAllAccepted() {
    if (!currentItems.length) {
        alert('No items available to accept. Scan a receipt first.');
        return;
    }
    currentItems = currentItems.map(item => ({ ...item, accepted: true, removed: false }));
    renderItems(currentItems);
    updateSaveButton();
    setStatus('All items marked as accepted.', 'success');
}

function removeAllItems() {
    if (!currentItems.length) {
        alert('No items available to reject. Scan a receipt first.');
        return;
    }

    const confirmReject = confirm('Reject all items? This will mark every item as rejected and keep them in the review list. Continue?');
    if (!confirmReject) return;

    currentItems = currentItems.map(item => ({ ...item, removed: true, accepted: false }));
    renderItems(currentItems);
    updateSaveButton();
    setStatus('All items have been rejected. They remain in the review list for reference.', 'warning');
}

function updateSaveButton() {
    const saveBtn = document.getElementById('save-to-inventory-btn');
    const startBtn = document.getElementById('start-new-scan-btn');
    if (!saveBtn) return;

    const totalCount = currentItems.length;
    const acceptedCount = currentItems.filter(item => item.accepted && !item.removed).length;
    const rejectedCount = currentItems.filter(item => item.removed).length;
    const pendingCount = currentItems.filter(item => !item.accepted && !item.removed).length;
    const hasDecisions = acceptedCount > 0 || rejectedCount > 0;

    const noPendingAndHasDecisions = pendingCount === 0 && hasDecisions;
    saveBtn.disabled = !noPendingAndHasDecisions;
    saveBtn.style.display = 'inline-flex';

    if (pendingCount > 0) {
        saveBtn.innerHTML = `<i class="fas fa-save"></i> Resolve ${pendingCount} pending item(s) before saving`;
    } else if (!hasDecisions) {
        saveBtn.innerHTML = '<i class="fas fa-save"></i> No items decided (accept or reject to enable)';
    } else if (acceptedCount > 0) {
        saveBtn.innerHTML = `<i class="fas fa-save"></i> Save ${acceptedCount} Accepted Item(s) to Inventory`;
    } else if (rejectedCount > 0) {
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Record Review Decisions';
    } else {
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Review Decisions';
    }

    // Keep the session active so rejected items remain visible for review.
    if (startBtn) {
        startBtn.style.display = 'none';
    }
}

async function saveAcceptedItemsToInventory() {
    const saveBtn = document.getElementById('save-to-inventory-btn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const currentUser = await window.authHelpers?.getCurrentUser?.();
        const response = await fetch('/api/save-items-to-inventory', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ items: currentItems, userId: currentUser?.id || null })
        });

        const result = await response.json();

        if (!response.ok) {
            const message = result?.error || result?.message || 'Failed to save items';
            setStatus(`Save failed: ${message}`, 'danger');
            if (saveBtn) saveBtn.disabled = false;
            alert(`Error: ${message}`);
            return;
        }

        const successCount = result.results?.successful?.length || 0;
        const failedCount = result.results?.failed?.length || 0;
        const rejectedCount = result.results?.rejected?.length || 0;

        let statusMessage = `✓ Successfully processed ${successCount} item(s)`;
        if (rejectedCount > 0) {
            statusMessage += ` and recorded ${rejectedCount} rejected item(s)`;
        }
        if (failedCount > 0) {
            statusMessage += ` (${failedCount} failed)`;
        }

        setStatus(statusMessage, 'success');
        
        // Show detailed results
        let detailsHtml = `<h3>Save Results</h3><ul>`;
        
        if (result.results?.successful?.length > 0) {
            detailsHtml += `<li><strong>Processed (${successCount}):</strong><ul>`;
            result.results.successful.forEach(item => {
                if (item.isNew) {
                    detailsHtml += `<li><strong>${item.name}</strong> - Created (Qty: ${item.quantity})${item.price ? ` - ₱${item.price.toFixed(2)}` : ''}</li>`;
                } else {
                    detailsHtml += `<li><strong>${item.name}</strong> - Updated Stock (${item.previousQuantity} → ${item.newQuantity} units, +${item.quantity})</li>`;
                }
            });
            detailsHtml += `</ul></li>`;
        }

        if (result.results?.rejected?.length > 0) {
            detailsHtml += `<li><strong>Rejected (${rejectedCount}):</strong><ul>`;
            result.results.rejected.forEach(item => {
                detailsHtml += `<li><strong>${item.name}</strong>${item.comment ? ` - ${item.comment}` : ''}</li>`;
            });
            detailsHtml += `</ul></li>`;
        }

        if (result.results?.failed?.length > 0) {
            detailsHtml += `<li><strong>Failed (${failedCount}):</strong><ul>`;
            result.results.failed.forEach(item => {
                detailsHtml += `<li>${item.name}: ${item.error}</li>`;
            });
            detailsHtml += `</ul></li>`;
        }

        detailsHtml += `</ul>`;
        const resultsDiv = document.getElementById('ocr-raw-output');
        if (resultsDiv) {
            resultsDiv.innerHTML = detailsHtml;
            resultsDiv.hidden = false;
            resultsDiv.style.color = 'inherit';
        }

        // Clear items after successful save
        clearReceiptSelection();
        
        alert(`Save complete!\n\nProcessed: ${successCount}\nFailed: ${failedCount}`);
    } catch (error) {
        console.error('Save to inventory error:', error);
        setStatus('Save failed. Check the backend server and try again.', 'danger');
        if (saveBtn) saveBtn.disabled = false;
        alert('Error saving items: ' + error.message);
    }
}

async function initReceiptScanner() {
    const imageInput = document.getElementById('receipt-image-input');
    const processButton = document.getElementById('process-receipt-btn');
    const clearButton = document.getElementById('clear-receipt-btn');
    const acceptAllBtn = document.getElementById('accept-all-btn');
    const removeAllBtn = document.getElementById('remove-all-btn');
    const downloadBtn = document.getElementById('download-json-btn');
    const saveToInventoryBtn = document.getElementById('save-to-inventory-btn');

    if (imageInput) {
        imageInput.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) {
                clearReceiptSelection();
                return;
            }

            if (!file.type.startsWith('image/')) {
                alert('Please select a valid image file.');
                clearReceiptSelection();
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                currentReceiptImage = { file, dataUrl };
                setPreviewImage(dataUrl);
                setStatus('Receipt image ready. Tap Scan Receipt to process.', 'neutral');
            };
            reader.readAsDataURL(file);
        });
    }

    if (processButton) {
        processButton.addEventListener('click', (event) => {
            event.preventDefault();
            processReceiptImage();
        });
    }

    if (clearButton) {
        clearButton.addEventListener('click', (event) => {
            event.preventDefault();
            clearReceiptSelection();
        });
    }

    if (acceptAllBtn) {
        acceptAllBtn.addEventListener('click', (event) => {
            event.preventDefault();
            setAllAccepted();
        });
    }

    if (removeAllBtn) {
        removeAllBtn.addEventListener('click', (event) => {
            event.preventDefault();
            removeAllItems();
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', (event) => {
            event.preventDefault();
            downloadJsonFile();
        });
    }

    if (saveToInventoryBtn) {
        saveToInventoryBtn.addEventListener('click', (event) => {
            event.preventDefault();
            saveAcceptedItemsToInventory();
        });
    }
    const startNewScanBtn = document.getElementById('start-new-scan-btn');
    if (startNewScanBtn) {
        startNewScanBtn.addEventListener('click', (event) => {
            event.preventDefault();
            const confirmReset = confirm('Clear rejected items and start a new scan?');
            if (!confirmReset) return;
            clearReceiptSelection();
            setStatus('Ready for a new scan.', 'neutral');
        });
    }

    const itemsGrid = document.getElementById('ocr-items-grid');
    if (itemsGrid) {
        itemsGrid.addEventListener('input', handleOcrItemGridInput);
        itemsGrid.addEventListener('click', handleOcrItemGridClick);
    }

    await initAdminOCRSettings();
    clearReceiptSelection();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initReceiptScanner);
} else {
    initReceiptScanner();
}
