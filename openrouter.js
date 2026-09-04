const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

function resolvePythonBinary() {
    const configuredBinary = String(process.env.PYTHON_BINARY || '').trim();
    const isWindowsPath = /^[A-Za-z]:[\\/]/.test(configuredBinary);
    if (process.platform !== 'win32' && isWindowsPath) return 'python3';
    return configuredBinary || (process.platform === 'win32' ? 'python' : 'python3');
}

// Debug middleware to log all routes
router.use((req, res, next) => {
    console.log(`OpenRouter middleware: ${req.method} ${req.path}`);
    next();
});

const VLM_CONFIG_FILE = path.resolve(__dirname, './vlm_settings.json');
const PYTHON_BINARY = resolvePythonBinary();
const PYTHON_SCRIPT = path.resolve(__dirname, './python_vlm.py');
const DEFAULT_VLM_MODEL = 'deepseek-v4-flash-vision-exp';
const DEFAULT_VLM_ENDPOINT = 'https://api.deepseek.com/chat/completions';

// Supabase client initialization
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wxhkhxsxftundtrahpst.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4aGtoeHN4ZnR1bmR0cmFocHN0Iiwicm9zZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDU3ODc3NywiZXhwIjoyMDc2MTU0Nzc3fQ.R_J7gu9Z7T0CEp0t0Ky8XC0kHvHxDtpqX2t5Vz_K6lE';
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function normalizeVLMModel(model) {
    const candidate = String(model || '').trim();
    if (!candidate) return DEFAULT_VLM_MODEL;
    return candidate;
}

async function loadActiveCategories() {
    const { data, error } = await supabaseClient
        .from('categories')
        .select('category_id, category_name, category_slug, description')
        .eq('is_active', true)
        .order('category_name');

    if (error) {
        throw new Error(`Unable to load product categories: ${error.message}`);
    }

    return data || [];
}

function resolveCategory(item, categories) {
    const byId = new Map(categories.map(category => [category.category_id, category]));
    const bySlug = new Map(categories.map(category => [String(category.category_slug).toLowerCase(), category]));
    const requestedId = String(item.category_id || item.suggested_category_id || '').trim();
    const requestedSlug = String(item.category_slug || item.suggested_category_slug || '').trim().toLowerCase();
    const fallback = bySlug.get('uncategorized') || null;
    const requestedCategory = byId.get(requestedId) || bySlug.get(requestedSlug) || null;
    const normalizedName = normalizeProductName(item.name || item.product_name || '');
    const categoryRules = [
        ['safety-equipment', /\b(glove|gloves|helmet|hard hat|goggle|goggles|respirator|safety vest|harness|ppe)\b/],
        ['plumbing', /\b(pipe cement|pvc cement|water closet|floor drain|teflon tape|gate valve|ball valve|ppr fitting|pvc fitting)\b/],
        ['construction-materials', /\b(cement|concrete|rebar|reinforcing bar|plywood|lumber|hollow block|sand|gravel|tie wire|masonry|roofing|steel bar)\b/],
        ['electrical', /\b(thhn|wire|cable|breaker|switch|outlet|socket|electrical|emt|conduit|junction box|utility box|led bulb|led downlight|downlight|electrical tape)\b/],
        ['plumbing', /\b(ppr|pvc pipe|sanitary pipe|water pipe|male adapter|female adapter|faucet|valve|elbow|reducer|coupling|tee fitting|sanitary|plumbing|flexible hose|floor drain)\b/],
        ['fasteners', /\b(nail|nails|screw|screws|bolt|bolts|nut|nuts|washer|washers|anchor|anchors|rivet|rivets)\b/],
        ['power-tools', /\b(drill|grinder|circular saw|jigsaw|rotary hammer|cutting disc|cutting wheel|sander|power tool)\b/],
        ['hand-tools', /\b(hammer|pliers|wrench|screwdriver|chisel|handsaw|tape measure|measuring tape|level|cutter)\b/],
        ['paint-and-supplies', /\b(paint|latex|enamel|primer|putty|thinner|epoxy|paint roller|paint brush|masking tape|sandpaper|sealant|varnish|coating)\b/],
        ['hardware', /\b(hinge|lock|padlock|chain|bracket|caster|doorknob|door knob|hasp|hook|cabinet handle)\b/]
    ];
    const inferredRule = categoryRules.find(([, pattern]) => pattern.test(normalizedName));
    const inferredCategory = inferredRule ? bySlug.get(inferredRule[0]) || null : null;
    const shouldUseRule = !requestedCategory || requestedCategory.category_slug === 'uncategorized';
    const matchedCategory = shouldUseRule && inferredCategory ? inferredCategory : requestedCategory;
    const category = matchedCategory || fallback;
    const rawConfidence = Number(item.category_confidence);

    return {
        category,
        confidence: shouldUseRule && inferredCategory
            ? 0.9
            : matchedCategory && Number.isFinite(rawConfidence)
                ? Math.max(0, Math.min(1, rawConfidence))
                : 0,
        source: shouldUseRule && inferredCategory ? 'system_rule' : matchedCategory ? 'vlm' : 'fallback'
    };
}

function applyValidatedCategories(parsed, categories) {
    if (!parsed || !Array.isArray(parsed.items)) return parsed;

    return {
        ...parsed,
        items: parsed.items.map(item => {
            const { category, confidence, source } = resolveCategory(item, categories);
            return {
                ...item,
                category_id: category?.category_id || null,
                suggested_category_id: category?.category_id || null,
                category_name: category?.category_name || 'Uncategorized',
                category_slug: category?.category_slug || 'uncategorized',
                category_confidence: confidence,
                category_source: source
            };
        })
    };
}

function loadVLMConfig() {
    const defaults = {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        supplierApiKey: process.env.SUPPLIER_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '',
        model: normalizeVLMModel(process.env.VLM_MODEL || process.env.VISION_MODEL || DEFAULT_VLM_MODEL),
        endpoint: process.env.DEEPSEEK_API_ENDPOINT || DEFAULT_VLM_ENDPOINT
    };

    try {
        if (fs.existsSync(VLM_CONFIG_FILE)) {
            const raw = fs.readFileSync(VLM_CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed?.apiKey) {
                defaults.apiKey = parsed.apiKey;
            }
            if (parsed?.supplierApiKey) {
                defaults.supplierApiKey = parsed.supplierApiKey;
            } else if (parsed?.apiKey) {
                defaults.supplierApiKey = parsed.apiKey;
            }
            if (parsed?.model) {
                defaults.model = normalizeVLMModel(parsed.model);
            }
            if (parsed?.endpoint) {
                defaults.endpoint = parsed.endpoint;
            }
        }
    } catch (error) {
        console.error('Unable to load VLM settings file:', error);
    }

    return defaults;
}

function persistVLMConfig({ apiKey, model, endpoint, supplierApiKey }) {
    const payload = {
        apiKey: String(apiKey || '').trim(),
        supplierApiKey: String(supplierApiKey || apiKey || '').trim(),
        model: normalizeVLMModel(model),
        endpoint: String(endpoint || DEFAULT_VLM_ENDPOINT).trim() || DEFAULT_VLM_ENDPOINT
    };

    if (!payload.apiKey || !payload.model) {
        throw new Error('Both apiKey and model are required to persist VLM settings.');
    }

    fs.writeFileSync(VLM_CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}

function generateProductCode(productName) {
    const normalized = String(productName || 'PRD')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    const prefix = normalized.substring(0, 3).padEnd(3, 'X');
    const timestamp = Date.now().toString().slice(-5);
    const randomSuffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${timestamp}-${randomSuffix}`;
}

function normalizeProductName(productName) {
    return String(productName || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ');
}

async function findUniqueProductCode(productName, maxAttempts = 5) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = generateProductCode(productName);
        const { data: existing, error } = await supabaseClient
            .from('products')
            .select('product_id')
            .eq('product_code', candidate)
            .limit(1)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!existing) {
            return candidate;
        }
    }

    throw new Error('Unable to generate a unique product code after multiple attempts.');
}

async function ensureProductCodeForProduct(productId, productName, currentCode) {
    if (currentCode && String(currentCode).trim()) {
        return currentCode;
    }

    const productCode = await findUniqueProductCode(productName);
    const { error: updateError } = await supabaseClient
        .from('products')
        .update({ product_code: productCode })
        .eq('product_id', productId);

    if (updateError) {
        throw updateError;
    }

    return productCode;
}

async function requireRoles(req, res, allowedRoles, errorMessage = 'Access denied.') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) {
        res.status(401).json({ error: 'Authorization token is required.' });
        return null;
    }

    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data?.user) {
        res.status(401).json({ error: 'Invalid or expired authorization token.' });
        return null;
    }

    const userId = data.user.id;
    const { data: userProfile, error: profileError } = await supabaseClient
        .from('users')
        .select('role')
        .eq('user_id', userId)
        .single();

    if (profileError || !userProfile) {
        res.status(403).json({ error: 'Unable to verify user role.' });
        return null;
    }

    const normalizedRole = (userProfile.role || '').toLowerCase();
    if (!allowedRoles.includes(normalizedRole)) {
        res.status(403).json({ error: errorMessage });
        return null;
    }

    return { user: data.user, role: normalizedRole };
}

async function requireAdmin(req, res) {
    return requireRoles(req, res, ['admin'], 'Admin access required.');
}

async function logReceiptAuditEvent({ userId, actionType, tableAffected = 'receipt_scan', recordId = null, oldValues = {}, newValues = {} }) {
    try {
        const payload = {
            user_id: userId || null,
            action_type: actionType,
            table_affected: tableAffected,
            record_id: recordId || null,
            old_values: oldValues || {},
            new_values: newValues || {},
            user_agent: 'server-receipt-scan',
            action_timestamp: new Date().toISOString()
        };

        const { error } = await supabaseClient.from('audit_logs').insert([payload]);
        if (error) {
            console.error('Receipt scan audit log write failed:', error);
        }
    } catch (error) {
        console.error('Unexpected receipt scan audit log error:', error);
    }
}

function extractJsonObject(text) {
    if (!text) return null;
    const normalized = String(text).trim();

    try {
        return JSON.parse(normalized);
    } catch (outerError) {
        const match = normalized.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch (innerError) {
            return null;
        }
    }
}

function parseDataUrl(dataUrl) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl));
    if (!match) return null;
    return {
        mediaType: match[1],
        base64Data: match[2]
    };
}

function imageExtension(mediaType) {
    switch (mediaType) {
        case 'image/png':
            return 'png';
        case 'image/gif':
            return 'gif';
        case 'image/webp':
            return 'webp';
        default:
            return 'jpg';
    }
}

async function runUnifiedVLMExtraction({ imageDataUrl, task, taskLabel }) {
    if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
        throw new Error(`Invalid ${taskLabel} image data URL.`);
    }

    const parsedImage = parseDataUrl(imageDataUrl);
    if (!parsedImage) {
        throw new Error(`Unable to parse the ${taskLabel} image data URL.`);
    }

    const vlmConfig = loadVLMConfig();
    const categories = task === 'product' ? await loadActiveCategories() : [];
    const apiKey = task === 'supplier' ? (vlmConfig.supplierApiKey || vlmConfig.apiKey) : vlmConfig.apiKey;
    if (!apiKey) {
        throw new Error(task === 'supplier'
            ? 'Supplier Details Extractor API key is not configured on the server.'
            : 'DeepSeek API key is not configured on the server.');
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${task}-vlm-`));
    const tempFile = path.join(tempDir, `${task}.${imageExtension(parsedImage.mediaType)}`);
    fs.writeFileSync(tempFile, Buffer.from(parsedImage.base64Data, 'base64'));

    try {
        const pythonEnv = {
            ...process.env,
            DEEPSEEK_API_KEY: apiKey,
            DEEPSEEK_API_ENDPOINT: vlmConfig.endpoint,
            VLM_MODEL: vlmConfig.model,
            VISION_MODEL: vlmConfig.model,
            VLM_CATEGORIES_JSON: JSON.stringify(categories.map(category => ({
                slug: category.category_slug,
                name: category.category_name,
                description: category.description || ''
            })))
        };

        const child = spawn(PYTHON_BINARY, [PYTHON_SCRIPT, tempFile, task], {
            env: pythonEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        const exitCode = await new Promise((resolve, reject) => {
            child.once('error', (error) => {
                reject(new Error(`Unable to start ${taskLabel} extraction subprocess: ${error.message}`));
            });
            child.once('close', resolve);
        });

        if (exitCode !== 0) {
            throw new Error(stderr.trim() || `${taskLabel} extraction subprocess failed without error details.`);
        }

        const parsed = extractJsonObject(stdout.trim());
        if (!parsed) {
            throw new Error(`Unable to parse JSON from the ${taskLabel} extraction output.`);
        }

        return {
            parsed: task === 'product' ? applyValidatedCategories(parsed, categories) : parsed,
            categories,
            stdout,
            stderr
        };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

router.post('/vlm-scan', async (req, res) => {
    const operator = await requireRoles(req, res, ['admin', 'manager', 'staff'], 'VLM extraction access required.');
    if (!operator) return;

    try {
        const imageDataUrl = req.body?.imageDataUrl;
        if (!imageDataUrl) {
            return res.status(400).json({ error: 'Missing imageDataUrl in request body.' });
        }

        const { parsed, categories, stdout, stderr } = await runUnifiedVLMExtraction({
            imageDataUrl,
            task: 'product',
            taskLabel: 'product'
        });

        return res.json({
            success: true,
            receipt: parsed,
            supplierDetails: parsed.supplier || {},
            categories,
            usage: parsed._usage || null,
            rawResponse: {
                stdout: parsed,
                stderr: stderr.trim()
            }
        });
    } catch (error) {
        console.error('VLM scan error:', error);
        return res.status(500).json({
            error: 'VLM scan failed on the server.',
            message: error?.message || 'Unknown error.'
        });
    }
});

router.get('/categories', async (req, res) => {
    const operator = await requireRoles(req, res, ['admin', 'manager', 'staff'], 'Category access required.');
    if (!operator) return;

    try {
        return res.json({ success: true, categories: await loadActiveCategories() });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Unable to load categories.' });
    }
});

router.get('/vlm-config', async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const config = loadVLMConfig();
    res.json({
        success: true,
        config
    });
});

router.post('/vlm-config', async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { apiKey, model, endpoint, supplierApiKey } = req.body;
    if (!apiKey || !model || !endpoint) {
        return res.status(400).json({ error: 'apiKey, model, and endpoint are required.' });
    }

    try {
        const saved = persistVLMConfig({ apiKey, model, endpoint, supplierApiKey });
        return res.json({
            success: true,
            config: saved
        });
    } catch (err) {
        console.error('Unable to save VLM config:', err);
        return res.status(500).json({ error: 'Unable to save VLM settings.' });
    }
});

router.post('/vlm-scan-supplier', async (req, res) => {
    const operator = await requireRoles(req, res, ['admin', 'manager', 'staff'], 'Supplier VLM extraction access required.');
    if (!operator) return;

    try {
        const imageDataUrl = req.body?.imageDataUrl;
        if (!imageDataUrl) {
            return res.status(400).json({ error: 'Missing imageDataUrl in request body.' });
        }

        const { parsed, stdout, stderr } = await runUnifiedVLMExtraction({
            imageDataUrl,
            task: 'supplier',
            taskLabel: 'supplier'
        });

        console.log('[supplier-vlm] extracted supplier details:', JSON.stringify(parsed, null, 2));

        return res.json({
            success: true,
            supplierDetails: parsed,
            rawResponse: {
                stdout: parsed,
                stderr: stderr.trim()
            }
        });
    } catch (error) {
        console.error('Supplier VLM scan error:', error);
        return res.status(500).json({
            error: 'Supplier VLM scan failed on the server.',
            message: error?.message || 'Unknown error.'
        });
    }
});

router.post('/save-items-to-inventory', async (req, res) => {
    const operator = await requireRoles(req, res, ['admin', 'manager', 'staff'], 'Inventory import access required.');
    if (!operator) return;

    try {
        const { items } = req.body;
        const userId = operator.user.id;
        const scanDate = new Date().toISOString();
        
        console.log('Save items request received:', items ? items.length : 'no items');
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Invalid items array. Must be non-empty.' });
        }

        const categories = await loadActiveCategories();
        const receiptItems = items.filter(item => item && typeof item === 'object');
        const acceptedItems = receiptItems.filter(item => item.accepted && !item.removed);
        const rejectedItems = receiptItems.filter(item => item.removed);
        const pendingItems = receiptItems.filter(item => !item.accepted && !item.removed);
        
        if (acceptedItems.length === 0) {
            await logReceiptAuditEvent({
                userId,
                actionType: 'receipt_scan_decision',
                tableAffected: 'receipt_scan',
                newValues: {
                    summary: {
                        totalItems: receiptItems.length,
                        acceptedItems: acceptedItems.length,
                        rejectedItems: rejectedItems.length,
                        pendingItems: pendingItems.length
                    },
                    items: receiptItems.map(item => ({
                        name: item.name || '',
                        comment: item.comment || '',
                        decision: item.removed ? 'rejected' : 'pending',
                        real_quantity: item.real_quantity ?? item.receipt_quantity ?? 1
                    }))
                }
            });

            return res.json({
                success: true,
                message: 'Receipt review decisions recorded. No items were imported into inventory.',
                results: {
                    successful: [],
                    failed: [],
                    rejected: receiptItems.filter(item => item.removed).map(item => ({
                        name: item.name || 'Unnamed item',
                        comment: item.comment || '',
                        decision: 'rejected'
                    }))
                }
            });
        }

        await logReceiptAuditEvent({
            userId,
            actionType: 'receipt_scan_decision',
            tableAffected: 'receipt_scan',
            newValues: {
                summary: {
                    totalItems: receiptItems.length,
                    acceptedItems: acceptedItems.length,
                    rejectedItems: rejectedItems.length,
                    pendingItems: pendingItems.length
                },
                items: receiptItems.map(item => ({
                    name: item.name || '',
                    comment: item.comment || '',
                    decision: item.removed ? 'rejected' : item.accepted ? 'accepted' : 'pending',
                    real_quantity: item.real_quantity ?? item.receipt_quantity ?? 1
                }))
            }
        });

        const dedupedItems = acceptedItems.map(item => {
            const productName = (item.name || '').trim().toUpperCase();
            const quantity = parseInt(item.real_quantity) || parseInt(item.receipt_quantity) || 1;
            const price = parseFloat(item.price) || 0;
            const unitPrice = Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : price;
            const sellingPrice = Number.isFinite(Number(item.selling_price)) ? Number(item.selling_price) : unitPrice;
            const unitOfMeasure = String(item.unit_of_measure || item.unit || 'unit').trim() || 'unit';
            const comment = (item.comment || '').trim();
            const { category, confidence: categoryConfidence } = resolveCategory(item, categories);
            const extractedName = String(item.original_name || item.name || '').trim();
            const nameWasEdited = Boolean(item.name_was_edited) || normalizeProductName(extractedName) !== normalizeProductName(item.name);

            return {
                ...item,
                originalName: productName,
                extractedName,
                nameWasEdited,
                quantity,
                price,
                unit_price: unitPrice,
                selling_price: sellingPrice,
                unit_of_measure: unitOfMeasure,
                thumbnailUrl: item.thumbnailUrl || null,
                category_id: category?.category_id || null,
                category_name: category?.category_name || 'Uncategorized',
                category_slug: category?.category_slug || 'uncategorized',
                category_confidence: categoryConfidence,
                comment
            };
        });

        const results = {
            successful: [],
            failed: [],
            rejected: []
        };

        for (const item of rejectedItems) {
            const comment = (item.comment || '').trim();
            results.rejected.push({
                name: item.name || 'Unnamed item',
                comment,
                decision: 'rejected'
            });

            await logReceiptAuditEvent({
                userId,
                actionType: 'receipt_scan_item_rejected',
                tableAffected: 'receipt_scan',
                newValues: {
                    itemName: item.name || 'Unnamed item',
                    comment,
                    decision: 'rejected',
                    real_quantity: item.real_quantity ?? item.receipt_quantity ?? 1
                }
            });
        }

        for (const item of dedupedItems) {
            try {
                const productName = (item.originalName || item.name || '').trim().toUpperCase();
                const price = parseFloat(item.price) || 0;
                const unitPrice = Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : price;
                const sellingPrice = Number.isFinite(Number(item.selling_price)) ? Number(item.selling_price) : unitPrice;
                const quantity = parseInt(item.quantity) || 1;
                const comment = (item.comment || '').trim();

                if (!productName || productName.length < 2) {
                    results.failed.push({
                        name: item.name,
                        error: 'Product name is too short or empty'
                    });
                    continue;
                }

                // Normalize product name for comparison and merge names with punctuation differences
                const normalizedName = normalizeProductName(productName);

                // Check if product already exists (case-insensitive, punctuation-insensitive)
                const { data: allProducts } = await supabaseClient
                    .from('products')
                    .select('product_id, product_name, product_code, category_id');

                const existingProduct = allProducts?.find(p => 
                    normalizeProductName(p.product_name) === normalizedName
                ) || null;

                let productId;
                let isNew = false;
                let previousQuantity = 0;

                if (existingProduct) {
                    if (!existingProduct.product_code) {
                        try {
                            existingProduct.product_code = await ensureProductCodeForProduct(
                                existingProduct.product_id,
                                productName,
                                existingProduct.product_code
                            );
                        } catch (codeError) {
                            console.warn('Failed to assign missing product code for existing product:', codeError);
                        }
                    }
                    // Product exists - update existing stock and pricing
                    productId = existingProduct.product_id;

                    const { data: currentStockArray } = await supabaseClient
                        .from('inventory_stock')
                        .select('stock_id, quantity')
                        .eq('product_id', productId)
                        .limit(1);

                    const currentStock = currentStockArray && currentStockArray.length > 0 ? currentStockArray[0] : null;
                    previousQuantity = currentStock?.quantity || 0;
                    const newQuantity = previousQuantity + quantity;

                    if (currentStock) {
                        const { error: updateError } = await supabaseClient
                            .from('inventory_stock')
                            .update({ 
                                quantity: newQuantity,
                                last_restock_date: new Date().toISOString()
                            })
                            .eq('stock_id', currentStock.stock_id);

                        if (updateError) throw updateError;
                    } else {
                        const { error: insertStockError } = await supabaseClient
                            .from('inventory_stock')
                            .insert([{
                                product_id: productId,
                                quantity: newQuantity,
                                last_restock_date: new Date().toISOString()
                            }]);

                        if (insertStockError) throw insertStockError;
                    }

                    const { error: updateProductError } = await supabaseClient
                        .from('products')
                        .update({
                            product_name: productName,
                            unit_price: unitPrice,
                            selling_price: sellingPrice,
                            unit_of_measure: item.unit_of_measure || 'unit',
                            category_id: existingProduct.category_id || item.category_id || null
                        })
                        .eq('product_id', productId);

                    if (updateProductError) throw updateProductError;

                    // Record stock movement
                    const { error: movementError } = await supabaseClient
                        .from('stock_movements')
                        .insert([{
                            product_id: productId,
                            movement_type: 'inbound',
                            quantity_change: quantity,
                            quantity_before: previousQuantity,
                            quantity_after: newQuantity,
                            reference_type: 'receipt_scan',
                            movement_date: scanDate,
                            performed_by: userId,
                            unit_price: unitPrice,
                            selling_price: sellingPrice,
                            notes: `Receipt scan update. Receipt qty: ${quantity}` + (comment ? `. ${comment}` : '')
                        }]);

                    if (movementError) throw movementError;

                    results.successful.push({
                        name: productName,
                        quantity: quantity,
                        previousQuantity: previousQuantity,
                        newQuantity: newQuantity,
                        productId: productId,
                        isNew: false,
                        message: `Updated stock (+${quantity} units)`
                    });

                    await logReceiptAuditEvent({
                        userId,
                        actionType: 'receipt_scan_item_accepted',
                        tableAffected: 'products',
                        recordId: productId,
                        newValues: {
                            itemName: productName,
                            originalExtractedName: item.extractedName,
                            nameWasEdited: item.nameWasEdited,
                            quantity,
                            categoryId: existingProduct.category_id || item.category_id || null,
                            categoryName: existingProduct.category_id ? 'Existing product category' : item.category_name,
                            comment,
                            decision: 'accepted',
                            previousQuantity,
                            newQuantity,
                            source: 'receipt_scan'
                        }
                    });
                } else {
                    // Product doesn't exist - create new and generate a unique product code
                    const productCode = await findUniqueProductCode(productName);
                    const reorderLevel = Math.max(5, Math.ceil(Number(quantity) / 2));
                    const { data: newProduct, error: insertError } = await supabaseClient
                        .from('products')
                        .insert([{
                            product_name: productName,
                            product_code: productCode,
                            unit_price: Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : price,
                            selling_price: Number.isFinite(Number(item.selling_price)) ? Number(item.selling_price) : price,
                            unit_of_measure: item.unit_of_measure || 'unit',
                            description: comment || `Imported from receipt scan. Qty: ${item.receipt_quantity}`,
                            reorder_level: Number.isFinite(reorderLevel) ? reorderLevel : 5,
                            maximum_stock: null,
                            category_id: item.category_id || null,
                            image_url: item.thumbnailUrl || null
                        }])
                        .select()
                        .single();

                    if (insertError) throw insertError;

                    productId = newProduct.product_id;
                    isNew = true;

                    // Insert inventory stock record
                    const { error: stockError } = await supabaseClient
                        .from('inventory_stock')
                        .insert([{
                            product_id: productId,
                            quantity: quantity,
                            last_restock_date: new Date().toISOString()
                        }]);

                    if (stockError) throw stockError;

                    // Insert stock movement record
                    const { error: movementError } = await supabaseClient
                        .from('stock_movements')
                        .insert([{
                            product_id: productId,
                            movement_type: 'inbound',
                            quantity_change: quantity,
                            quantity_before: 0,
                            quantity_after: quantity,
                            reference_type: 'receipt_scan',
                            movement_date: scanDate,
                            performed_by: userId,
                            unit_price: unitPrice,
                            selling_price: sellingPrice,
                            notes: `Receipt scan import. Receipt qty: ${item.receipt_quantity}` + (comment ? `. ${comment}` : '')
                        }]);

                    if (movementError) throw movementError;

                    results.successful.push({
                        name: productName,
                        price: price,
                        quantity: quantity,
                        categoryId: item.category_id || null,
                        categoryName: item.category_name,
                        productId: productId,
                        isNew: true,
                        message: `Created new product`
                    });

                    await logReceiptAuditEvent({
                        userId,
                        actionType: 'receipt_scan_item_accepted',
                        tableAffected: 'products',
                        recordId: productId,
                        newValues: {
                            itemName: productName,
                            originalExtractedName: item.extractedName,
                            nameWasEdited: item.nameWasEdited,
                            quantity,
                            categoryId: item.category_id || null,
                            categoryName: item.category_name,
                            comment,
                            decision: 'accepted',
                            previousQuantity: 0,
                            newQuantity: quantity,
                            source: 'receipt_scan'
                        }
                    });
                }
            } catch (itemError) {
                console.error('Error processing item:', itemError);
                results.failed.push({
                    name: item.name,
                    error: itemError.message || 'Unknown error while saving item'
                });
            }
        }

        res.json({
            success: true,
            message: `Processed ${results.successful.length} item(s)`,
            results: results
        });
    } catch (error) {
        console.error('Error saving items to inventory:', error);
        res.status(500).json({
            error: 'Failed to save items to inventory',
            message: error?.message || 'Unknown error'
        });
    }
});

module.exports = router;
