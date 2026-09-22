const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function requirePOSUser(req, res) {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Authorization token is required.' });
    return null;
  }

  let { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);

  // Some Supabase configurations can reject /auth/v1/user while PostgREST
  // still accepts the same freshly issued JWT. In that case, validate the
  // signature and expiry through PostgREST before trusting its subject.
  if (authError || !authData.user) {
    try {
      const payloadPart = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(payloadPart || '', 'base64').toString('utf8'));
      if (!/^[0-9a-f-]{36}$/i.test(payload.sub || '')) throw new Error('Invalid token subject.');
      const profileUrl = new URL('/rest/v1/users', SUPABASE_URL);
      profileUrl.searchParams.set('select', 'user_id');
      profileUrl.searchParams.set('user_id', `eq.${payload.sub}`);
      const verificationResponse = await fetch(profileUrl, {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.pgrst.object+json'
        }
      });
      if (!verificationResponse.ok) {
        const reason = await verificationResponse.text();
        throw new Error(`PostgREST verification failed (${verificationResponse.status}): ${reason.slice(0, 200)}`);
      }
      const verifiedProfile = await verificationResponse.json();
      if (!verifiedProfile?.user_id) throw new Error('User profile not found.');
      authData = { user: { id: payload.sub } };
      authError = null;
    } catch (verificationError) {
      console.warn('POS session verification failed:', authError?.message || verificationError.message);
      res.status(401).json({ error: 'Your session is invalid or expired.' });
      return null;
    }
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('role, is_active')
    .eq('user_id', authData.user.id)
    .single();

  const role = String(profile?.role || '').toLowerCase();
  if (profileError || !profile?.is_active || !['cashier', 'admin'].includes(role)) {
    res.status(403).json({ error: 'You are not allowed to access POS sales.' });
    return null;
  }

  return { id: authData.user.id, role };
}


router.get('/pos/transactions', async (req, res, next) => {
  try {
    const user = await requirePOSUser(req, res);
    if (!user) return;
    const { search = '', from = '', to = '', cashier = '', payment = '', status = '', sort = 'newest' } = req.query;
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const validDate = value => typeof value === 'string' && (!value ||
      (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
       Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value));
    if (![search, cashier, payment, status, sort].every(value => typeof value === 'string') ||
        search.length > 200 || !Number.isSafeInteger(page) || page < 1 ||
        ![10, 20, 50].includes(limit) || !Number.isSafeInteger(page * limit) ||
        !validDate(from) || !validDate(to) || (from && to && from >= to) ||
        !['', 'cash', 'bank_transfer'].includes(payment) ||
        !['', 'completed', 'voided'].includes(status) || !['newest', 'oldest'].includes(sort) ||
        (cashier && !/^[0-9a-f-]{36}$/i.test(cashier))) {
      return res.status(400).json({ error: 'Invalid sales history filters.' });
    }
    let query = supabaseAdmin.from('pos_transactions')
      .select('*, pos_transaction_items(*)', { count: 'exact' });
    if (user.role === 'cashier') query = query.eq('cashier_id', user.id);
    else if (cashier) query = query.eq('cashier_id', cashier);
    if (search.trim()) query = query.ilike('transaction_number', `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`);
    if (from) query = query.gte('transaction_datetime', from);
    if (to) query = query.lt('transaction_datetime', to);
    if (payment) query = query.eq('payment_method', payment);
    if (status === 'voided') query = query.or('is_voided.eq.true,is_active.eq.false');
    if (status === 'completed') query = query.or('is_voided.eq.false,is_voided.is.null').or('is_active.eq.true,is_active.is.null');
    const { data, count, error } = await query
      .order('transaction_datetime', { ascending: sort === 'oldest' })
      .order('transaction_id', { ascending: sort === 'oldest' })
      .range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    // Retain inactive and former cashiers for historical attribution.
    let people = supabaseAdmin.from('users').select('user_id, first_name, last_name');
    if (user.role !== 'admin') people = people.eq('user_id', user.id);
    const { data: cashiers, error: peopleError } = await people;
    if (peopleError) throw peopleError;
    res.json({ transactions: data, total: count, page, limit, cashiers });
  } catch (error) { next(error); }
});

router.get('/pos/transactions/:transactionId', async (req, res, next) => {
  try {
    const user = await requirePOSUser(req, res);
    if (!user) return;
    if (!/^[0-9a-f-]{36}$/i.test(req.params.transactionId)) return res.status(400).json({ error: 'Invalid transaction ID.' });
    let query = supabaseAdmin.from('pos_transactions').select('*, pos_transaction_items(*)')
      .eq('transaction_id', req.params.transactionId);
    if (user.role === 'cashier') query = query.eq('cashier_id', user.id);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Transaction not found.' });
    res.json(data);
  } catch (error) { next(error); }
});

router.post('/pos/transactions/:transactionId/finalize', async (req, res, next) => {
  try {
    const user = await requirePOSUser(req, res);
    if (!user) return;

    const transactionId = req.params.transactionId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transactionId)) {
      return res.status(400).json({ error: 'Invalid transaction ID.' });
    }

    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from('pos_transactions')
      .select('transaction_id, cashier_id, is_active, pos_transaction_items(product_id, quantity)')
      .eq('transaction_id', transactionId)
      .single();

    if (transactionError) throw transactionError;
    if (!transaction.is_active) return res.status(409).json({ error: 'This transaction is not active.' });
    if (user.role === 'cashier' && transaction.cashier_id !== user.id) {
      return res.status(403).json({ error: 'Cashiers may only finalize their own sales.' });
    }

    const items = transaction.pos_transaction_items || [];
    if (!items.length) return res.status(400).json({ error: 'The transaction has no line items.' });

    const updatedItems = [];
    for (const item of items) {
      const soldQuantity = Number(item.quantity);
      if (!item.product_id || !Number.isInteger(soldQuantity) || soldQuantity <= 0) {
        return res.status(400).json({ error: 'The transaction contains an invalid line item.' });
      }

      // A client may retry after losing the HTTP response. Do not deduct twice.
      const { data: existingMovement, error: movementReadError } = await supabaseAdmin
        .from('stock_movements')
        .select('quantity_after')
        .eq('reference_id', transactionId)
        .eq('product_id', item.product_id)
        .maybeSingle();
      if (movementReadError) throw movementReadError;
      if (existingMovement) {
        updatedItems.push({ productId: item.product_id, quantity: Number(existingMovement.quantity_after) });
        continue;
      }

      const { data: stock, error: stockError } = await supabaseAdmin
        .from('inventory_stock')
        .select('stock_id, quantity')
        .eq('product_id', item.product_id)
        .single();
      if (stockError) throw stockError;

      const quantityBefore = Number(stock.quantity);
      const quantityAfter = quantityBefore - soldQuantity;
      if (quantityAfter < 0) {
        return res.status(409).json({ error: `Insufficient stock for product ${item.product_id}.` });
      }

      const now = new Date().toISOString();
      const { data: updatedStock, error: updateError } = await supabaseAdmin
        .from('inventory_stock')
        .update({ quantity: quantityAfter, last_sale_date: now, updated_at: now })
        .eq('stock_id', stock.stock_id)
        .eq('quantity', quantityBefore)
        .select('quantity')
        .single();
      if (updateError || Number(updatedStock?.quantity) !== quantityAfter) {
        const error = updateError || new Error('Stock changed while the sale was being finalized.');
        error.status = 409;
        throw error;
      }

      const { error: movementError } = await supabaseAdmin.from('stock_movements').insert({
        product_id: item.product_id,
        movement_type: 'outbound',
        quantity_change: -soldQuantity,
        quantity_before: quantityBefore,
        quantity_after: quantityAfter,
        movement_date: now,
        reference_type: 'outbound_order',
        reference_id: transactionId,
        performed_by: user.id,
        notes: 'Point of sale transaction'
      });
      if (movementError) {
        // Restore this row if its matching audit movement could not be recorded.
        await supabaseAdmin
          .from('inventory_stock')
          .update({ quantity: quantityBefore, updated_at: new Date().toISOString() })
          .eq('stock_id', stock.stock_id)
          .eq('quantity', quantityAfter);
        throw movementError;
      }

      updatedItems.push({ productId: item.product_id, quantity: quantityAfter });
    }

    res.json({ success: true, inventory: updatedItems });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
