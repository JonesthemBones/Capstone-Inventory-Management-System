const VLM_API_ENDPOINT = '/api/vlm-scan';
const SUPPLIER_VLM_API_ENDPOINT = '/api/vlm-scan-supplier';
const VLM_CONFIG_ENDPOINT = '/api/vlm-config';
let currentReceiptImage = null;
let currentItems = [];
let currentSupplierDetails = {};
let currentCategories = [];
let receiptCameraStream = null;
let thumbnailModalContext = {
    itemIndex: null,
    inventoryId: null,
    currentThumbnailUrl: null,
    pendingThumbnailUrl: null,
    pendingThumbnailFile: null
};

function setStatus(message, variant = 'neutral') {
    const statusElement = document.getElementById('vlm-status');
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.className = `vlm-status vlm-status-${variant}`;
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

async function prepareReceiptImage(file) {
    const bitmap = await createImageBitmap(file);
    const maxDimension = 1800;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.9);
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
    if (event && event.target !== modal && event.target.closest('.vlm-image-modal-content')) {
        return;
    }
    modal.classList.remove('active');
}

async function openReceiptCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        alert('Direct camera access is not supported by this browser. Use Choose or capture a receipt instead.');
        return;
    }

    const modal = document.getElementById('vlm-camera-modal');
    const video = document.getElementById('receipt-camera-video');
    try {
        receiptCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        video.srcObject = receiptCameraStream;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        await video.play();
    } catch (error) {
        console.error('Unable to open receipt camera:', error);
        alert('Camera access was unavailable. Allow camera permission and make sure the site is opened over HTTPS or localhost.');
        closeReceiptCamera();
    }
}

function closeReceiptCamera() {
    receiptCameraStream?.getTracks().forEach(track => track.stop());
    receiptCameraStream = null;
    const video = document.getElementById('receipt-camera-video');
    const modal = document.getElementById('vlm-camera-modal');
    if (video) video.srcObject = null;
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function captureReceiptPhoto() {
    const video = document.getElementById('receipt-camera-video');
    const canvas = document.getElementById('receipt-camera-canvas');
    if (!video?.videoWidth || !video?.videoHeight) {
        alert('The camera is still starting. Please try again in a moment.');
        return;
    }

    const maxDimension = 1800;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    currentReceiptImage = { file: null, dataUrl, source: 'camera' };
    setPreviewImage(dataUrl);
    setStatus('Receipt photo ready. Tap Extract Receipt to process.', 'neutral');
    closeReceiptCamera();
}

function clearReceiptSelection() {
    const input = document.getElementById('receipt-image-input');
    if (input) {
        input.value = '';
    }
    currentReceiptImage = null;
    currentSupplierDetails = {};
    setPreviewImage(null);
    setStatus('No receipt selected. Choose or capture a receipt to begin.');
    document.getElementById('vlm-items-grid').innerHTML = '';
    document.getElementById('vlm-raw-output').hidden = true;
    renderSupplierDetailsPanel({});
    updateSupplierSaveButton();
    currentItems = [];
    updateSaveButton();
}

function parseVLMResponse(responseBody) {
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
            .select('product_name, unit_price, selling_price, unit_of_measure, category_id');

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
                unit_of_measure: String(product.unit_of_measure || item.unit_of_measure || 'unit').trim() || 'unit',
                category_id: product.category_id || item.category_id || null,
                category_name: product.category_id
                    ? currentCategories.find(category => category.category_id === product.category_id)?.category_name || item.category_name
                    : item.category_name,
                category_slug: product.category_id
                    ? currentCategories.find(category => category.category_id === product.category_id)?.category_slug || item.category_slug
                    : item.category_slug,
                category_source: product.category_id ? 'existing_product' : 'vlm'
            };
        });
    } catch (error) {
        console.warn('Unable to merge VLM items with existing product defaults:', error);
        return items;
    }
}

async function lookupThumbnails(extractedItems) {
    const items = Array.isArray(extractedItems) ? extractedItems : [];
    const unmatchedItems = items.map(item => ({
        ...item,
        inventoryId: null,
        thumbnailUrl: null
    }));

    if (!window.supabaseClient || items.length === 0) {
        return unmatchedItems;
    }

    try {
        const { data: products, error } = await window.supabaseClient
            .from('products')
            .select('product_id, product_name, image_url');

        if (error || !products) {
            return unmatchedItems;
        }

        const productMap = new Map();
        products.forEach(product => {
            const key = normalizeProductName(product.product_name);
            if (key) {
                productMap.set(key, product);
            }
        });

        return items.map(item => {
            const product = productMap.get(normalizeProductName(item.name));
            if (!product) {
                return {
                    ...item,
                    inventoryId: null,
                    thumbnailUrl: null
                };
            }

            return {
                ...item,
                inventoryId: product.product_id ?? null,
                thumbnailUrl: product.image_url || null
            };
        });
    } catch (error) {
        console.warn('Unable to look up VLM item thumbnails:', error);
        return unmatchedItems;
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
        const categoryConfidenceValue = item.category_confidence;
        const categoryConfidence = Number.isFinite(Number(categoryConfidenceValue))
            ? Math.max(0, Math.min(1, Number(categoryConfidenceValue)))
            : 0;
        const accepted = item.accepted === true;
        return {
            id: `vlm-item-${idx}`,
            name,
            original_name: item.original_name ?? name,
            name_was_edited: false,
            price,
            unit_price: unitPrice,
            selling_price: sellingPrice,
            unit_of_measure: unitOfMeasure || 'unit',
            receipt_quantity: receiptQuantity,
            real_quantity: realQuantity,
            confidence,
            category_id: item.category_id ?? item.suggested_category_id ?? null,
            category_name: item.category_name ?? 'Uncategorized',
            category_slug: item.category_slug ?? item.suggested_category_slug ?? 'uncategorized',
            category_confidence: categoryConfidence,
            category_source: item.category_source ?? 'vlm',
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

function normalizeSupplierDetails(rawDetails) {
    const source = rawDetails && typeof rawDetails === 'object' ? rawDetails : {};
    const supplierBlock = source.supplier && typeof source.supplier === 'object' ? source.supplier : {};
    const details = source.supplierDetails && typeof source.supplierDetails === 'object' ? source.supplierDetails : source;
    const merged = { ...supplierBlock, ...details };

    const fields = [
        ['supplier_name', ['supplier_name', 'supplierName', 'supplier', 'company_name', 'companyName']],
        ['contact_name', ['contact_name', 'contactName', 'contact_person', 'contactPerson']],
        ['phone', ['phone', 'phone_number', 'contact_number', 'contactNumber']],
        ['email', ['email', 'email_address', 'e_mail']],
        ['address', ['address', 'street_address', 'billing_address']],
        ['tin', ['tin', 'tax_id', 'taxId', 'vat_number', 'vatNumber']],
        ['vat', ['vat', 'vat_number', 'vatNumber']],
        ['website', ['website', 'website_url', 'url']],
        ['notes', ['notes', 'remarks', 'comment']]
    ];

    const normalized = {};
    for (const [key, aliases] of fields) {
        const value = aliases
            .map(alias => merged[alias])
            .find(item => item !== undefined && item !== null && String(item).trim() !== '');
        if (value !== undefined) {
            normalized[key] = String(value).trim();
        }
    }

    return normalized;
}

function updateSupplierSaveButton() {
    const saveBtn = document.getElementById('save-supplier-details-btn');
    if (!saveBtn) return;

    const supplierData = normalizeSupplierDetails(currentSupplierDetails);
    const hasSupplierDetails = Object.keys(supplierData).length > 0;
    saveBtn.disabled = !hasSupplierDetails;
    saveBtn.innerHTML = hasSupplierDetails
        ? '<i class="fas fa-user-plus"></i> Save Supplier Details'
        : '<i class="fas fa-user-plus"></i> No supplier details to save';
}

function renderSupplierDetailsPanel(details) {
    const panel = document.getElementById('supplier-details-panel');
    const content = document.getElementById('supplier-details-content');
    const toggle = document.getElementById('supplier-details-toggle');
    if (!panel || !content || !toggle) return;

    const normalized = normalizeSupplierDetails(details);
    const fieldDefs = [
        { key: 'supplier_name', label: 'Supplier Name' },
        { key: 'contact_name', label: 'Contact Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'address', label: 'Address' },
        { key: 'tin', label: 'TIN' },
        { key: 'vat', label: 'VAT' },
        { key: 'website', label: 'Website' },
        { key: 'notes', label: 'Notes' }
    ];

    if (!Object.keys(normalized).length) {
        panel.classList.add('hidden');
        updateSupplierSaveButton();
        return;
    }

    panel.classList.remove('hidden');
    if (!panel.dataset.expanded) {
        panel.dataset.expanded = 'true';
    }
    const isExpanded = panel.dataset.expanded !== 'false';
    toggle.innerHTML = `<span>Supplier Details</span><i class="fas ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>`;
    toggle.setAttribute('aria-expanded', String(isExpanded));
    content.hidden = !isExpanded;

    content.innerHTML = fieldDefs.map(field => {
        const value = normalized[field.key] ?? '';
        const isLongField = field.key === 'address' || field.key === 'notes';
        const control = isLongField
            ? `<textarea id="supplier-field-${field.key}" data-supplier-field="${field.key}" rows="2">${escapeHtml(value)}</textarea>`
            : `<input id="supplier-field-${field.key}" type="text" value="${escapeHtml(value)}" data-supplier-field="${field.key}">`;
        return `
            <div class="supplier-details-field${isLongField ? ' supplier-details-field-wide' : ''}">
                <label for="supplier-field-${field.key}">${field.label}</label>
                ${control}
            </div>
        `;
    }).join('');
    updateSupplierSaveButton();
}

function handleSupplierFieldInput(event) {
    const target = event.target;
    if (!target || !target.dataset.supplierField) return;
    const field = target.dataset.supplierField;
    currentSupplierDetails[field] = target.value;
    updateSupplierSaveButton();
}

async function saveSupplierDetailsToSupabase() {
    const saveBtn = document.getElementById('save-supplier-details-btn');
    if (!saveBtn) return;

    const supplierData = normalizeSupplierDetails(currentSupplierDetails);
    if (!Object.keys(supplierData).length) {
        setStatus('No supplier details available to save.', 'warning');
        return;
    }

    const supplierName = String(supplierData.supplier_name || '').trim();
    if (!supplierName) {
        setStatus('Supplier name is required before saving supplier details.', 'warning');
        return;
    }

    const imageId = currentReceiptImage?.image_id || currentReceiptImage?.imageId || null;

    const startedAt = Date.now();
    const payload = {
        image_id: imageId,
        supplier_name: supplierName,
        supplier_address: String(supplierData.address || '').trim() || null,
        supplier_phone: String(supplierData.phone || '').trim() || null,
        supplier_tax_id: String(supplierData.tin || '').trim() || null,
        overall_confidence: null,
        extraction_status: 'success',
        raw_response: JSON.stringify({
            supplier_name: supplierName,
            contact_name: String(supplierData.contact_name || '').trim() || null,
            email: String(supplierData.email || '').trim() || null,
            vat: String(supplierData.vat || '').trim() || null,
            website: String(supplierData.website || '').trim() || null,
            notes: String(supplierData.notes || '').trim() || null,
            phone: String(supplierData.phone || '').trim() || null,
            address: String(supplierData.address || '').trim() || null,
            tin: String(supplierData.tin || '').trim() || null
        }),
        processing_time_ms: Date.now() - startedAt,
        created_at: new Date().toISOString()
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving supplier...';

    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session?.access_token) {
            throw new Error('Your session has expired. Please sign in again.');
        }

        const { error: insertError } = await window.supabaseClient
            .from('vlm_extractions')
            .insert([payload]);

        if (insertError) {
            throw insertError;
        }

        setStatus('Supplier details saved to vlm_extractions.', 'success');
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Supplier saved';
    } catch (error) {
        console.error('Supplier save error:', error);
        setStatus('Failed to save supplier details to the VLM extraction table.', 'danger');
        alert(`Supplier save failed: ${error.message || error}`);
        saveBtn.innerHTML = '<i class="fas fa-user-plus"></i> Save Supplier Details';
    } finally {
        saveBtn.disabled = false;
        updateSupplierSaveButton();
    }
}

function renderItems(items) {
    const grid = document.getElementById('vlm-items-grid');
    if (!grid) return;

    if (items.length === 0) {
        grid.innerHTML = '<div class="vlm-empty-state">No items available. Scan a receipt to load items.</div>';
        return;
    }

    grid.innerHTML = items.map((item, index) => {
        const removedClass = item.removed ? 'vlm-card-removed' : '';
        const acceptedClass = item.accepted && !item.removed ? 'vlm-card-accepted' : '';
        const statusLabel = item.removed ? 'Rejected' : item.accepted ? 'Accepted' : 'Pending';
        const statusClass = item.removed ? 'vlm-item-status-rejected' : item.accepted ? 'vlm-item-status-accepted' : 'vlm-item-status-pending';
        const acceptLabel = item.accepted && !item.removed ? 'Accepted' : 'Accept';
        const acceptIcon = item.accepted && !item.removed ? 'fa-check-circle' : 'fa-check';
        const rejectLabel = item.removed ? 'Restore' : 'Reject';
        const rejectIcon = item.removed ? 'fa-undo' : 'fa-ban';
        const disableAccept = item.removed ? 'disabled' : '';
        const thumbnailHtml = item.thumbnailUrl
            ? `<img src="${escapeHtml(item.thumbnailUrl)}" alt="${escapeHtml(item.name)} thumbnail" class="product-thumbnail" loading="lazy">`
            : '<div class="product-thumbnail-placeholder" aria-label="No thumbnail"><i class="fas fa-image"></i></div>';
        const categoryOptions = currentCategories.map(category => `
            <option value="${escapeHtml(category.category_id)}" ${category.category_id === item.category_id ? 'selected' : ''}>
                ${escapeHtml(category.category_name)}
            </option>
        `).join('');
        const categorySource = item.category_source === 'existing_product'
            ? 'Existing product category'
            : item.category_source === 'system_rule'
                ? `System matched from product name (${formatConfidence(item.category_confidence)})`
                : `AI confidence: ${formatConfidence(item.category_confidence)}`;

        return `
            <article class="vlm-card-item ${removedClass} ${acceptedClass}" data-index="${index}">
                <div class="vlm-card-item-header">
                    <button type="button" class="vlm-card-item-thumbnail-column vlm-thumbnail-trigger" data-action="edit-thumbnail" data-index="${index}" aria-label="Change ${escapeHtml(item.name)} thumbnail">
                        ${thumbnailHtml}
                    </button>
                    <div>
                        <div class="vlm-item-name-field">
                            <label for="vlm-item-name-${index}">Product Name</label>
                            <input id="vlm-item-name-${index}" type="text" maxlength="100" value="${escapeHtml(item.name)}" data-field="name" data-index="${index}">
                            ${item.name_was_edited ? '<small class="vlm-name-edited"><i class="fas fa-pen"></i> Edited from extracted name</small>' : ''}
                        </div>
                        <p class="vlm-card-item-meta">Unit Price: <strong>₱${Number.isFinite(item.unit_price) ? item.unit_price.toFixed(2) : '0.00'}</strong> | Receipt Qty: <strong>${item.receipt_quantity}</strong> | Confidence: <strong>${escapeHtml(formatConfidence(item.confidence))}</strong></p>
                        <span class="vlm-item-status ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="vlm-card-item-actions">
                        <button type="button" class="btn btn-secondary vlm-item-accept-btn" data-action="toggle-accept" ${disableAccept}>
                            <i class="fas ${acceptIcon}"></i>
                            ${acceptLabel}
                        </button>
                        <button type="button" class="btn btn-danger vlm-item-remove-btn" data-action="toggle-remove">
                            <i class="fas ${rejectIcon}"></i>
                            ${rejectLabel}
                        </button>
                    </div>
                </div>
                <div class="vlm-card-item-fields">
                    <div class="vlm-card-item-field">
                        <label>Category</label>
                        <select data-field="category_id" data-index="${index}" ${currentCategories.length ? '' : 'disabled'}>
                            <option value="">Uncategorized</option>
                            ${categoryOptions}
                        </select>
                        <small class="vlm-category-hint">${escapeHtml(categorySource)}</small>
                    </div>
                    <div class="vlm-card-item-field">
                        <label>Unit</label>
                        <input type="text" value="${escapeHtml(item.unit_of_measure || 'unit')}" data-field="unit_of_measure" data-index="${index}">
                    </div>
                    <div class="vlm-card-item-field">
                        <label>Selling Price</label>
                        <input type="number" step="0.01" min="0" value="${Number.isFinite(item.selling_price) ? item.selling_price.toFixed(2) : '0.00'}" data-field="selling_price" data-index="${index}">
                    </div>
                    <div class="vlm-card-item-field">
                        <label>Real Quantity</label>
                        <input type="number" step="1" min="0" value="${item.real_quantity}" data-field="real_quantity" data-index="${index}">
                    </div>
                    <div class="vlm-card-item-field vlm-card-item-field-wide">
                        <label>Comment</label>
                        <textarea rows="2" data-field="comment" data-index="${index}">${escapeHtml(item.comment)}</textarea>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    updateSaveButton();
}

function setThumbnailModalPreview(thumbnailUrl) {
    const image = document.getElementById('thumbnail-modal-image');
    const emptyState = document.getElementById('thumbnail-modal-empty');
    if (!image || !emptyState) return;

    if (thumbnailUrl) {
        image.src = thumbnailUrl;
        image.hidden = false;
        emptyState.hidden = true;
    } else {
        image.src = '';
        image.hidden = true;
        emptyState.hidden = false;
    }
}

function openThumbnailModal(itemIndex) {
    const item = currentItems[itemIndex];
    const modal = document.getElementById('thumbnail-modal');
    const fileInput = document.getElementById('thumbnail-file-input');
    if (!item || !modal) return;

    thumbnailModalContext = {
        itemIndex,
        inventoryId: item.inventoryId ?? null,
        currentThumbnailUrl: item.thumbnailUrl || null,
        pendingThumbnailUrl: item.thumbnailUrl || null,
        pendingThumbnailFile: null
    };
    modal.dataset.itemIndex = String(itemIndex);
    modal.dataset.inventoryId = item.inventoryId ?? '';
    if (fileInput) fileInput.value = '';
    setThumbnailModalPreview(thumbnailModalContext.pendingThumbnailUrl);
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
}

function closeThumbnailModal() {
    const modal = document.getElementById('thumbnail-modal');
    const fileInput = document.getElementById('thumbnail-file-input');
    if (fileInput) fileInput.value = '';
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        delete modal.dataset.itemIndex;
        delete modal.dataset.inventoryId;
    }
    thumbnailModalContext = {
        itemIndex: null,
        inventoryId: null,
        currentThumbnailUrl: null,
        pendingThumbnailUrl: null,
        pendingThumbnailFile: null
    };
}

function handleThumbnailFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file.');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        thumbnailModalContext.pendingThumbnailFile = file;
        thumbnailModalContext.pendingThumbnailUrl = reader.result;
        setThumbnailModalPreview(thumbnailModalContext.pendingThumbnailUrl);
    };
    reader.readAsDataURL(file);
}

async function uploadThumbnailToStorage(file, inventoryId) {
    if (!window.supabaseClient) {
        throw new Error('Supabase is not available.');
    }

    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const itemPrefix = inventoryId ? `product-${inventoryId}` : 'vlm-item';
    const filePath = `product-images/${itemPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { error: uploadError } = await window.supabaseClient.storage
        .from('product-images')
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
        });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = window.supabaseClient.storage
        .from('product-images')
        .getPublicUrl(filePath);
    const imageUrl = publicUrlData?.publicUrl;
    if (!imageUrl) {
        throw new Error('Unable to generate a public thumbnail URL.');
    }

    return { imageUrl, filePath };
}

async function saveThumbnailModal() {
    const context = { ...thumbnailModalContext };
    const itemIndex = context.itemIndex;
    const item = itemIndex === null ? null : currentItems[itemIndex];
    const file = context.pendingThumbnailFile;
    const saveButton = document.getElementById('save-thumbnail-btn');
    if (!item || !file) {
        closeThumbnailModal();
        return;
    }

    if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
        const { imageUrl, filePath } = await uploadThumbnailToStorage(file, context.inventoryId);

        if (context.inventoryId) {
            const { error: updateError } = await window.supabaseClient
                .from('products')
                .update({
                    image_url: imageUrl,
                    image_path: filePath,
                    image_uploaded_at: new Date().toISOString()
                })
                .eq('product_id', context.inventoryId);

            if (updateError) throw updateError;
        }

        currentItems[itemIndex] = {
            ...item,
            thumbnailUrl: imageUrl,
            inventoryId: context.inventoryId
        };
        renderItems(currentItems);
        closeThumbnailModal();
    } catch (error) {
        console.error('Thumbnail save error:', error);
        setStatus('Thumbnail save failed. Please try again.', 'danger');
        alert('Unable to save thumbnail: ' + error.message);
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = 'Save';
        }
    }
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

function getVlmConfigStatusElement() {
    return document.getElementById('vlm-config-status');
}

function setVlmConfigStatus(message, variant = 'neutral') {
    const status = getVlmConfigStatusElement();
    if (!status) return;
    status.textContent = message;
    status.style.color = variant === 'error' ? '#b91c1c' : variant === 'success' ? '#047857' : 'var(--text-secondary)';
}

async function fetchAdminVLMConfig() {
    const token = await getSupabaseAccessToken();
    if (!token) {
        throw new Error('User is not authenticated.');
    }

    const response = await fetch(VLM_CONFIG_ENDPOINT, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(result?.error || 'Failed to load VLM config.');
    }

    return result.config;
}

async function saveAdminVLMConfig() {
    const token = await getSupabaseAccessToken();
    if (!token) {
        alert('Unable to save VLM settings because you are not authenticated.');
        return;
    }

    const apiKeyInput = document.getElementById('vlm-api-key-input');
    const supplierApiKeyInput = document.getElementById('vlm-supplier-api-key-input');
    const modelInput = document.getElementById('vlm-model-input');
    const endpointInput = document.getElementById('vlm-endpoint-input');
    const saveButton = document.getElementById('save-vlm-config-btn');

    if (!apiKeyInput || !modelInput || !endpointInput || !saveButton) return;

    const apiKey = apiKeyInput.value.trim();
    const supplierApiKey = supplierApiKeyInput ? supplierApiKeyInput.value.trim() : '';
    const model = modelInput.value.trim();
    const endpoint = endpointInput.value.trim();
    if (!apiKey || !model || !endpoint) {
        setVlmConfigStatus('Product API key, model name, and endpoint are all required.', 'error');
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    try {
        const response = await fetch(VLM_CONFIG_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ apiKey, model, endpoint, supplierApiKey: supplierApiKey || apiKey })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result?.error || 'Unable to save VLM settings.');
        }

        setVlmConfigStatus('VLM settings saved successfully.', 'success');
        apiKeyInput.value = result.config?.apiKey || apiKey;
        if (supplierApiKeyInput) {
            supplierApiKeyInput.value = result.config?.supplierApiKey || supplierApiKey || apiKey;
        }
        modelInput.value = result.config?.model || model;
        endpointInput.value = result.config?.endpoint || endpoint;
    } catch (error) {
        console.error('VLM config save failed:', error);
        setVlmConfigStatus(error.message || 'Failed to save VLM settings.', 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save"></i> Save VLM Settings';
    }
}

async function initAdminVLMSettings() {
    const adminSettings = document.getElementById('vlm-admin-settings');
    if (!adminSettings) return;

    const role = await window.authHelpers.getUserRole?.();
    if (role !== 'admin') {
        adminSettings.classList.add('hidden');
        return;
    }

    adminSettings.classList.remove('hidden');
    setVlmConfigStatus('Loading admin VLM settings...', 'neutral');

    const saveButton = document.getElementById('save-vlm-config-btn');
    if (saveButton) {
        saveButton.addEventListener('click', (event) => {
            event.preventDefault();
            saveAdminVLMConfig();
        });
    }

    try {
        const config = await fetchAdminVLMConfig();
        const apiKeyInput = document.getElementById('vlm-api-key-input');
        const supplierApiKeyInput = document.getElementById('vlm-supplier-api-key-input');
        const modelInput = document.getElementById('vlm-model-input');
        const endpointInput = document.getElementById('vlm-endpoint-input');
        if (apiKeyInput) apiKeyInput.value = config?.apiKey || '';
        if (supplierApiKeyInput) supplierApiKeyInput.value = config?.supplierApiKey || config?.apiKey || '';
        if (modelInput) modelInput.value = config?.model || '';
        if (endpointInput) endpointInput.value = config?.endpoint || 'https://api.deepseek.com/chat/completions';
        setVlmConfigStatus('Admin VLM settings loaded.', 'success');
    } catch (error) {
        console.error('Unable to load admin VLM settings:', error);
        setVlmConfigStatus('Unable to load admin settings.', 'error');
    }
}

function handleVlmItemGridInput(event) {
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
    } else if (field === 'category_id') {
        value = target.value || null;
        const category = currentCategories.find(entry => entry.category_id === value);
        currentItems[index].category_name = category?.category_name || 'Uncategorized';
        currentItems[index].category_slug = category?.category_slug || 'uncategorized';
        currentItems[index].category_source = 'reviewed';
    } else if (field === 'name') {
        value = target.value;
        currentItems[index].name_was_edited = normalizeProductName(value) !== normalizeProductName(currentItems[index].original_name);
    } else {
        value = target.value;
    }
    currentItems[index][field] = value;
}

function handleVlmItemGridClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    event.preventDefault();

    const parentCard = button.closest('.vlm-card-item');
    const index = Number(parentCard?.getAttribute('data-index'));
    if (Number.isNaN(index) || !currentItems[index]) return;

    const action = button.getAttribute('data-action');
    if (action === 'edit-thumbnail') {
        openThumbnailModal(index);
        return;
    }

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
            original_name: item.original_name,
            name_was_edited: item.name_was_edited,
            unit_price: item.unit_price,
            selling_price: item.selling_price,
            unit_of_measure: item.unit_of_measure,
            price: item.price,
            receipt_quantity: item.receipt_quantity,
            real_quantity: item.real_quantity,
            confidence: item.confidence,
            category_id: item.category_id,
            category_name: item.category_name,
            category_slug: item.category_slug,
            category_confidence: item.category_confidence,
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

async function fetchSupplierDetails(imageDataUrl) {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');

        const response = await fetch(SUPPLIER_VLM_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ imageDataUrl })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result?.details || result?.error || result?.message || 'Unable to scan supplier details.');
        }

        return result.supplierDetails || result.supplier || result;
    } catch (error) {
        console.warn('Supplier scan warning:', error);
        return null;
    }
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
    document.getElementById('vlm-items-grid').innerHTML = '';
    document.getElementById('vlm-raw-output').hidden = true;

    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');

        const authHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        };

        const productResponse = await fetch(VLM_API_ENDPOINT, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ imageDataUrl })
        });
        const productResult = await productResponse.json();

        if (!productResponse.ok) {
            const message = productResult?.details || productResult?.error || productResult?.message || 'Unable to scan receipt.';
            setStatus(`Scan failed: ${message}`, 'danger');
            return;
        }

        const parsed = parseVLMResponse(productResult.receipt ?? productResult);
        if (!parsed) {
            setStatus('Unable to parse VLM output. Please try again with a clearer receipt image.', 'danger');
            document.getElementById('vlm-raw-output').textContent = JSON.stringify(productResult.rawResponse || productResult, null, 2);
            document.getElementById('vlm-raw-output').hidden = false;
            return;
        }

        currentCategories = Array.isArray(productResult.categories) ? productResult.categories : [];
        currentItems = normalizeItemsFromReceipt(parsed).map(item => ({
            ...item,
            accepted: false,
            removed: false,
            confidence: item.confidence ?? null,
        }));

        currentItems = await mergeWithExistingProductDefaults(currentItems);
        currentItems = await lookupThumbnails(currentItems);
        renderItems(currentItems);

        const supplierDetails = productResult?.supplierDetails || parsed?.supplier || {};
        currentSupplierDetails = normalizeSupplierDetails(supplierDetails);
        renderSupplierDetailsPanel(currentSupplierDetails);

        const totalTokens = Number(productResult?.usage?.total_tokens);
        const usageText = Number.isFinite(totalTokens) ? ` Used ${totalTokens.toLocaleString()} API tokens.` : '';
        setStatus(`Receipt scanned successfully. ${currentItems.length} item(s) found.${usageText}`, 'success');
        const rawOutput = document.getElementById('vlm-raw-output');
        rawOutput.textContent = JSON.stringify({
            receipt: parsed,
            supplierDetails: currentSupplierDetails
        }, null, 2);
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
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');
        const response = await fetch('/api/save-items-to-inventory', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ items: currentItems })
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

        const supplierPayload = normalizeSupplierDetails(currentSupplierDetails);
        const hasSupplierData = Object.keys(supplierPayload).length > 0;

        if (hasSupplierData) {
            const supplierName = String(supplierPayload.supplier_name || '').trim();
            if (supplierName) {
                const supplierInsertPayload = {
                    image_id: currentReceiptImage?.image_id || currentReceiptImage?.imageId || null,
                    supplier_name: supplierName,
                    supplier_address: String(supplierPayload.address || '').trim() || null,
                    supplier_phone: String(supplierPayload.phone || '').trim() || null,
                    supplier_tax_id: String(supplierPayload.tin || '').trim() || null,
                    overall_confidence: null,
                    extraction_status: 'success',
                    raw_response: JSON.stringify({
                        supplier_name: supplierName,
                        contact_name: String(supplierPayload.contact_name || '').trim() || null,
                        email: String(supplierPayload.email || '').trim() || null,
                        vat: String(supplierPayload.vat || '').trim() || null,
                        website: String(supplierPayload.website || '').trim() || null,
                        notes: String(supplierPayload.notes || '').trim() || null,
                        phone: String(supplierPayload.phone || '').trim() || null,
                        address: String(supplierPayload.address || '').trim() || null,
                        tin: String(supplierPayload.tin || '').trim() || null
                    }),
                    processing_time_ms: 0,
                    created_at: new Date().toISOString()
                };

                const { error: supplierError } = await window.supabaseClient
                    .from('vlm_extractions')
                    .insert([supplierInsertPayload]);

                if (supplierError) {
                    console.warn('Supplier save via main inventory save failed:', supplierError);
                    statusMessage += ' | Supplier save pending due to DB policy/constraint issues';
                } else {
                    statusMessage += ' | Supplier details saved';
                }
            }
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
        const resultsDiv = document.getElementById('vlm-raw-output');
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
    const session = await window.authHelpers?.requireAuth?.();
    if (!session) return;
    const hasAccess = await window.authHelpers.requireRole(['admin', 'manager', 'staff']);
    if (!hasAccess) return;

    const imageInput = document.getElementById('receipt-image-input');
    const processButton = document.getElementById('process-receipt-btn');
    const clearButton = document.getElementById('clear-receipt-btn');
    const openCameraButton = document.getElementById('open-camera-btn');
    const captureCameraButton = document.getElementById('capture-camera-btn');
    const closeCameraButton = document.getElementById('close-camera-btn');
    const cancelCameraButton = document.getElementById('cancel-camera-btn');
    const acceptAllBtn = document.getElementById('accept-all-btn');
    const removeAllBtn = document.getElementById('remove-all-btn');
    const downloadBtn = document.getElementById('download-json-btn');
    const saveToInventoryBtn = document.getElementById('save-to-inventory-btn');
    const thumbnailModal = document.getElementById('thumbnail-modal');
    const thumbnailFileInput = document.getElementById('thumbnail-file-input');
    const changeThumbnailBtn = document.getElementById('change-thumbnail-btn');
    const saveThumbnailBtn = document.getElementById('save-thumbnail-btn');
    const cancelThumbnailBtn = document.getElementById('cancel-thumbnail-btn');
    const closeThumbnailBtn = document.getElementById('thumbnail-modal-close');

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

            try {
                setStatus('Optimizing receipt image...', 'warning');
                const dataUrl = await prepareReceiptImage(file);
                currentReceiptImage = { file, dataUrl };
                setPreviewImage(dataUrl);
                setStatus('Receipt image ready. Tap Scan Receipt to process.', 'neutral');
            } catch (error) {
                console.error('Unable to prepare receipt image:', error);
                alert('The receipt image could not be prepared. Please try another JPG, PNG, or WEBP image.');
                clearReceiptSelection();
            }
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

    openCameraButton?.addEventListener('click', openReceiptCamera);
    captureCameraButton?.addEventListener('click', captureReceiptPhoto);
    closeCameraButton?.addEventListener('click', closeReceiptCamera);
    cancelCameraButton?.addEventListener('click', closeReceiptCamera);
    window.addEventListener('pagehide', closeReceiptCamera);

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

    if (changeThumbnailBtn && thumbnailFileInput) {
        changeThumbnailBtn.addEventListener('click', () => thumbnailFileInput.click());
    }
    if (thumbnailFileInput) {
        thumbnailFileInput.addEventListener('change', handleThumbnailFileChange);
    }
    if (saveThumbnailBtn) {
        saveThumbnailBtn.addEventListener('click', saveThumbnailModal);
    }
    if (cancelThumbnailBtn) {
        cancelThumbnailBtn.addEventListener('click', closeThumbnailModal);
    }
    if (closeThumbnailBtn) {
        closeThumbnailBtn.addEventListener('click', closeThumbnailModal);
    }
    if (thumbnailModal) {
        thumbnailModal.addEventListener('click', (event) => {
            if (event.target === thumbnailModal) closeThumbnailModal();
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

    const itemsGrid = document.getElementById('vlm-items-grid');
    if (itemsGrid) {
        itemsGrid.addEventListener('input', handleVlmItemGridInput);
        itemsGrid.addEventListener('click', handleVlmItemGridClick);
    }

    const supplierToggle = document.getElementById('supplier-details-toggle');
    if (supplierToggle) {
        supplierToggle.addEventListener('click', () => {
            const panel = document.getElementById('supplier-details-panel');
            if (!panel) return;
            panel.dataset.expanded = panel.dataset.expanded === 'true' ? 'false' : 'true';
            renderSupplierDetailsPanel(currentSupplierDetails);
        });
    }

    const supplierContent = document.getElementById('supplier-details-content');
    if (supplierContent) {
        supplierContent.addEventListener('input', handleSupplierFieldInput);
    }

    await initAdminVLMSettings();
    window.authHelpers.revealProtectedContent();
    clearReceiptSelection();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initReceiptScanner);
} else {
    initReceiptScanner();
}
