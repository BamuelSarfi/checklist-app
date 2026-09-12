const path = require('path');
const testerPromotion = require('../services/testerPromotion');
const whatsappService = require('../services/whatsappService');

// A verification stuck 'pending' this long is treated as failed - the safe direction (per
// the product rule: "no verified number, no tester"). This is enforced server-side (not just
// a client-side poll giving up) so a webhook that never arrives can't leave a verification
// usable-forever in limbo; claimTester() only ever accepts status === 'verified' anyway, so
// this just turns an indefinite hang into a bounded, honest answer for the customer.
const VERIFICATION_TIMEOUT_MS = 25000;

exports.showApp = (req, res) => {
    res.sendFile(path.join(__dirname, '../views/naa_tester_claim.html'));
};

exports.register = async (req, res) => {
    try {
        const firstName = String(req.body.first_name || '').trim();
        const phone = String(req.body.phone || '').trim();
        const optedIn = Boolean(req.body.opted_in);
        const digits = testerPromotion.normalizePhone(phone);

        if (!firstName) {
            return res.status(400).json({ success: false, message: 'Enter your first name' });
        }
        if (digits.length < 10) {
            return res.status(400).json({ success: false, message: 'Enter a full mobile number that uses WhatsApp' });
        }

        const verification = await testerPromotion.createVerification({ firstName, phone, optedIn });

        if (!whatsappService.isConfigured()) {
            // Simulated mode - no real Meta credentials yet. Resolve as verified after a
            // short delay so the rest of the flow can be built and tested end-to-end before
            // real credentials arrive; this path stops running the moment WHATSAPP_* env
            // vars are set (isConfigured() flips to true and the real send path below runs).
            setTimeout(() => {
                testerPromotion.markVerificationSimulatedVerified(verification.id).catch((err) => {
                    console.error('[naaTesterClaim] simulated verification resolve failed', err);
                });
            }, 1500);

            return res.json({ success: true, verification_id: verification.id, simulated: true });
        }

        const sendResult = await whatsappService.sendVerificationTemplate({ toPhone: phone, shopName: "Uncle's Market" });

        if (!sendResult.success) {
            await testerPromotion.markVerificationFailed(verification.id);
            return res.json({ success: true, verification_id: verification.id });
        }

        await testerPromotion.attachWamid(verification.id, sendResult.wamid);
        return res.json({ success: true, verification_id: verification.id });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.getVerifyStatus = async (req, res) => {
    try {
        const verification = await testerPromotion.getVerification(req.params.id);
        if (!verification) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }

        if (verification.status === 'pending' && Date.now() - new Date(verification.created_at).getTime() > VERIFICATION_TIMEOUT_MS) {
            await testerPromotion.markVerificationFailed(verification.id);
            return res.json({ success: true, status: 'failed' });
        }

        return res.json({ success: true, status: verification.status });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.claim = async (req, res) => {
    try {
        const verificationId = String(req.body.verification_id || '').trim();
        const tillId = String(req.body.till_id || testerPromotion.DEFAULT_TILL_ID).trim();

        if (!verificationId) {
            return res.status(400).json({ success: false, message: 'Missing verification' });
        }

        const result = await testerPromotion.claimTester({ verificationId, tillId });

        if (result.outcome === 'success') {
            const claimedAt = new Date(result.claim.claimed_at);
            return res.json({
                success: true,
                outcome: 'success',
                claim_time: claimedAt.toLocaleTimeString('en-GB'),
                claim_date: claimedAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
            });
        }

        if (result.outcome === 'already_claimed') {
            const claimedAt = new Date(result.claim.claimed_at);
            return res.json({
                success: true,
                outcome: 'already_claimed',
                previous_time: claimedAt.toLocaleTimeString('en-GB'),
                claim_date: claimedAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
            });
        }

        const messages = {
            not_verified: 'This registration is not verified. Please register again.',
            no_live_run: 'There is no tester promotion running right now.',
            outside_window: "This promotion isn't running at this time.",
            sold_out: 'All testers have been claimed for this run.',
        };

        return res.json({ success: true, outcome: result.outcome, message: messages[result.outcome] || 'Unable to claim right now.' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// Meta calls this once (GET) when you register the webhook URL in the App Dashboard, to
// prove you control the endpoint before it'll send real events to it.
exports.webhookVerify = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
};

exports.webhookReceive = async (req, res) => {
    try {
        const signature = req.headers['x-hub-signature-256'];
        // req.body is the raw Buffer here (see server.js - this route is registered with
        // express.raw() ahead of the global express.json() parser, specifically so the
        // signature check below runs against the exact bytes Meta signed).
        if (!whatsappService.verifyWebhookSignature(req.body, signature)) {
            console.warn('[naaTesterClaim] webhook signature check failed');
            return res.sendStatus(401);
        }

        const payload = JSON.parse(req.body.toString('utf8'));
        const statuses = whatsappService.parseDeliveryStatuses(payload);

        for (const { wamid, status } of statuses) {
            if (status === 'failed') {
                // eslint-disable-next-line no-await-in-loop
                await testerPromotion.resolveVerificationByWamid(wamid, 'failed');
            } else if (status === 'sent' || status === 'delivered') {
                // eslint-disable-next-line no-await-in-loop
                await testerPromotion.resolveVerificationByWamid(wamid, 'verified');
            }
        }

        return res.sendStatus(200);
    } catch (err) {
        console.error('[naaTesterClaim] webhook processing failed', err);
        // Still 200 - Meta retries aggressively on non-2xx, and a processing bug here
        // shouldn't turn into a retry storm against this endpoint.
        return res.sendStatus(200);
    }
};
