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
    if (!preview) return;
    if (!dataUrl) {
        preview.innerHTML = 'No image selected';
        preview.style.backgroundImage = 'none';
        return;
    }
    preview.innerHTML = '';
    preview.style.backgroundImage = `url('${dataUrl}')`;
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
        const comment = item.comment ?? item.notes ?? '';
        const accepted = item.accepted === true;
        return {
            id: `ocr-item-${idx}`,
            name,
            price,
            receipt_quantity: receiptQuantity,
            real_quantity: realQuantity,
            comment,
            accepted,
            removed: item.removed === true,
        };
    });
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
                        <p class="ocr-card-item-meta">Price: <strong>₱${item.price.toFixed(2)}</strong> | Receipt Qty: <strong>${item.receipt_quantity}</strong></p>
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

function handleOcrItemGridInput(event) {
    const target = event.target;
    if (!target) return;

    const field = target.getAttribute('data-field');
    const index = Number(target.getAttribute('data-index'));
    if (!field || Number.isNaN(index)) return;

    const value = field === 'real_quantity' ? Number(target.value) : target.value;
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
            price: item.price,
            receipt_quantity: item.receipt_quantity,
            real_quantity: item.real_quantity,
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
        }));
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
    setStatus('All items marked as accepted.', 'success');
}

function removeAllItems() {
    if (!currentItems.length) {
        alert('No items available to reject. Scan a receipt first.');
        return;
    }

    const confirmReject = confirm('Reject all items? This will mark every item as rejected and remove them from the save list. Continue?');
    if (!confirmReject) return;

    currentItems = currentItems.map(item => ({ ...item, removed: true, accepted: false }));
    renderItems(currentItems);
    setStatus('All items have been rejected. Use Restore to recover any item.', 'warning');
    updateSaveButton();
}

function updateSaveButton() {
    const saveBtn = document.getElementById('save-to-inventory-btn');
    const startBtn = document.getElementById('start-new-scan-btn');
    if (!saveBtn) return;

    const acceptedCount = currentItems.filter(item => item.accepted && !item.removed).length;
    saveBtn.disabled = acceptedCount === 0;
    saveBtn.style.display = 'inline-flex';
    saveBtn.innerHTML = `<i class="fas fa-save"></i> ${acceptedCount > 0 ? `Save ${acceptedCount} Accepted Item(s) to Inventory` : 'No accepted items to save'}`;

    // Show a "Start New Scan" button when all items were rejected (so the user can clear and begin again)
    if (startBtn) {
        const totalCount = currentItems.length;
        const removedCount = currentItems.filter(i => i.removed).length;
        if (totalCount > 0 && removedCount === totalCount) {
            startBtn.style.display = 'inline-flex';
        } else {
            startBtn.style.display = 'none';
        }
    }
}

async function saveAcceptedItemsToInventory() {
    const acceptedCount = currentItems.filter(item => item.accepted && !item.removed).length;
    const saveBtn = document.getElementById('save-to-inventory-btn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const acceptedItems = currentItems.filter(item => item.accepted && !item.removed);
        const response = await fetch('/api/save-items-to-inventory', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ items: acceptedItems })
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

        let statusMessage = `✓ Successfully processed ${successCount} item(s)`;
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

function initReceiptScanner() {
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

    clearReceiptSelection();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initReceiptScanner);
} else {
    initReceiptScanner();
}
