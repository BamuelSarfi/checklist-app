const crypto = require('crypto');

// Meta's WhatsApp Cloud API has no synchronous "does this number have WhatsApp" lookup -
// the real mechanism (see the code review that led to this design) is sending an actual
// approved template message and reading the async delivery-status webhook: 'sent'/
// 'delivered' means the number is real, 'failed' means it isn't. This service only wraps
// that send call and the webhook's signature check/parsing - the actual pending/verified/
// failed bookkeeping lives in testerPromotion.js.

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

function isConfigured() {
    return Boolean(
        process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_TEMPLATE_NAME &&
        process.env.WHATSAPP_TEMPLATE_LANGUAGE
    );
}

// Sends the approved verification template to `toPhone` (normalized, digits only, UK
// national format e.g. "07700900461" - Meta wants international format with no leading
// zero/plus, so this converts 0xxxxxxxxxx -> 44xxxxxxxxxx).
function toWhatsAppFormat(phone) {
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    if (digits.startsWith('44')) return digits;
    if (digits.startsWith('0')) return `44${digits.slice(1)}`;
    return digits;
}

async function sendVerificationTemplate({ toPhone, shopName }) {
    if (!isConfigured()) {
        return { success: false, error: 'WhatsApp is not configured (missing env vars)' };
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: toWhatsAppFormat(toPhone),
                type: 'template',
                template: {
                    name: process.env.WHATSAPP_TEMPLATE_NAME,
                    language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE },
                    components: [
                        {
                            type: 'body',
                            parameters: [{ type: 'text', text: shopName || "Uncle's Market" }],
                        },
                    ],
                },
            }),
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            // A rejection here (invalid number, not a WhatsApp user in some cases, rate
            // limit, etc.) is itself useful signal - the caller treats this as an immediate
            // failure rather than waiting for a webhook that will never arrive.
            console.error('[whatsappService] template send rejected', response.status, JSON.stringify(body));
            return { success: false, error: body?.error?.message || `Meta API returned ${response.status}` };
        }

        const wamid = body?.messages?.[0]?.id || null;
        if (!wamid) {
            return { success: false, error: 'Meta API accepted the request but returned no message id' };
        }

        return { success: true, wamid };
    } catch (err) {
        console.error('[whatsappService] template send failed', err);
        return { success: false, error: err.message };
    }
}

// Meta signs every webhook POST body with your App Secret (HMAC-SHA256, hex, prefixed
// "sha256=") in the X-Hub-Signature-256 header - without checking this, anyone who finds the
// webhook URL could forge a "delivered" status and hand out free testers with no real
// WhatsApp check at all.
function verifyWebhookSignature(rawBody, signatureHeader) {
    if (!process.env.WHATSAPP_APP_SECRET || !signatureHeader) {
        return false;
    }

    const expected = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;

    const a = Buffer.from(expected);
    const b = Buffer.from(String(signatureHeader));
    if (a.length !== b.length) {
        return false;
    }

    return crypto.timingSafeEqual(a, b);
}

// Meta's delivery-status webhook nests statuses under entry[].changes[].value.statuses[].
// Each entry has { id: wamid, status: 'sent'|'delivered'|'read'|'failed', ... }. 'sent' or
// 'delivered' both confirm the number is real and reachable; only 'failed' means it isn't -
// 'read' would also confirm it (a step further than delivered) but isn't specially handled
// since 'delivered' already resolved the verification by the time 'read' could arrive.
function parseDeliveryStatuses(webhookBody) {
    const statuses = [];

    for (const entry of webhookBody?.entry || []) {
        for (const change of entry?.changes || []) {
            for (const status of change?.value?.statuses || []) {
                if (status?.id && status?.status) {
                    statuses.push({ wamid: status.id, status: status.status });
                }
            }
        }
    }

    return statuses;
}

module.exports = {
    isConfigured,
    sendVerificationTemplate,
    verifyWebhookSignature,
    parseDeliveryStatuses,
};
