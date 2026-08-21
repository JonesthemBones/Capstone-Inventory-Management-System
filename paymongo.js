const express = require('express');

const router = express.Router();
const PAYMONGO_API = 'https://api.paymongo.com/v1';

function authorizationHeader() {
  const secret = process.env.PAYMONGO_SECRET_KEY;
  if (!secret || !secret.startsWith('sk_test_')) {
    throw new Error(
      'PAYMONGO_SECRET_KEY is missing or is not a test key. Save .env and restart the Node server.'
    );
  }
  return `Basic ${Buffer.from(`${secret}:`).toString('base64')}`;
}

async function paymongoRequest(path, options = {}) {
  const response = await fetch(`${PAYMONGO_API}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      authorization: authorizationHeader(),
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) {
    const message = body.errors?.[0]?.detail || 'PayMongo request failed.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body.data;
}

router.post('/paymongo/checkout', async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    const referenceNumber = String(req.body.referenceNumber || '').trim();
    if (!Number.isInteger(amount) || amount < 100 || !/^TXN-[A-Za-z0-9-]+$/.test(referenceNumber)) {
      return res.status(400).json({ error: 'Invalid checkout amount or transaction reference.' });
    }

    const returnBase = `${req.protocol}://${req.get('host')}/pages/pos.html`;
    const session = await paymongoRequest('/checkout_sessions', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          attributes: {
            reference_number: referenceNumber,
            description: `Amacar Hardware POS ${referenceNumber}`,
            payment_method_types: ['gcash', 'paymaya'],
            line_items: [{
              name: `POS Order ${referenceNumber}`,
              description: 'Hardware store purchase',
              amount,
              currency: 'PHP',
              quantity: 1
            }],
            merchant: 'Amacar Hardware',
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            success_url: `${returnBase}?paymongo=success`,
            cancel_url: `${returnBase}?paymongo=cancelled`
          }
        }
      })
    });

    res.json({
      checkoutId: session.id,
      checkoutUrl: session.attributes.checkout_url,
      referenceNumber
    });
  } catch (error) {
    next(error);
  }
});

router.get('/paymongo/checkout/:checkoutId', async (req, res, next) => {
  try {
    if (!/^cs_[A-Za-z0-9]+$/.test(req.params.checkoutId)) {
      return res.status(400).json({ error: 'Invalid checkout session ID.' });
    }
    const session = await paymongoRequest(`/checkout_sessions/${req.params.checkoutId}`);
    const payments = session.attributes.payments || [];
    const paidPayment = payments.find(payment => payment.attributes?.status === 'paid');
    res.json({
      paid: Boolean(paidPayment),
      referenceNumber: session.attributes.reference_number,
      paymentId: paidPayment?.id || null
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
