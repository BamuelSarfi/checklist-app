const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const QRCode = require('qrcode');
const testerPromotion = require('../services/testerPromotion');
const { saveGeneratedRecord } = require('../services/generatedRecords');

function getEmployee(req) {
    const employee = req.employee || req.session?.employee;
    if (!employee) return null;
    return { id: employee.id, name: employee.name || employee.full_name || '' };
}

exports.showForm = (req, res) => {
    res.sendFile(path.join(__dirname, '../views/tester_promotion.html'));
};

function todayLabel() {
    return new Date().toLocaleDateString('en-GB');
}

async function buildRunPayload(run) {
    const claimedCount = await testerPromotion.getClaimCount(run.id);
    const recent = await testerPromotion.listRecentClaims(run.id, 10);
    const remaining = Math.max(0, run.stock - claimedCount);

    const startedAt = new Date(run.created_at);
    const hoursElapsed = Math.max(1 / 60, (Date.now() - startedAt.getTime()) / (1000 * 60 * 60));

    return {
        id: run.id,
        tester_name: run.tester_name,
        stock: run.stock,
        starts_at: run.starts_at,
        ends_at: run.ends_at,
        staff_name: run.staff_name,
        status: run.status,
        claimed_count: claimedCount,
        remaining,
        claims_per_hour: Number((claimedCount / hoursElapsed).toFixed(1)),
        recent_claims: recent.map((c) => ({
            id: c.id,
            time: new Date(c.claimed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            note: 'WhatsApp verified',
        })),
    };
}

exports.getStatus = async (req, res) => {
    try {
        const run = await testerPromotion.getLiveRun();
        if (!run) {
            return res.json({ success: true, run: null });
        }

        return res.json({ success: true, run: await buildRunPayload(run) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.startRun = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const existing = await testerPromotion.getLiveRun();
        if (existing) {
            return res.status(409).json({ success: false, message: 'A tester run is already live. End it before starting another.' });
        }

        const testerName = String(req.body.tester_name || '').trim();
        const stock = parseInt(req.body.stock, 10);
        const startsAt = String(req.body.starts_at || '').trim();
        const endsAt = String(req.body.ends_at || '').trim();
        const staffName = String(req.body.staff_name || employee.name || '').trim();

        if (!testerName) {
            return res.status(400).json({ success: false, message: 'Give the tester a name' });
        }
        if (!Number.isInteger(stock) || stock < 1) {
            return res.status(400).json({ success: false, message: 'Enter how many testers you have' });
        }
        if (!startsAt || !endsAt) {
            return res.status(400).json({ success: false, message: 'Set a start and end time' });
        }

        const run = await testerPromotion.createRun({
            testerName,
            stock,
            startsAt,
            endsAt,
            staffEmployeeId: employee.id,
            staffName,
        });

        return res.json({ success: true, run: await buildRunPayload(run) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.endRun = async (req, res) => {
    try {
        const employee = getEmployee(req);
        if (!employee) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const run = await testerPromotion.getLiveRun();
        if (!run) {
            return res.status(404).json({ success: false, message: 'No live run to end' });
        }

        const payload = await buildRunPayload(run);
        await testerPromotion.endRun(run.id);

        const fileName = await generateRunPdf(payload);

        if (fileName) {
            await saveGeneratedRecord({
                fileName: fileName.fileName,
                recordType: 'TESTER_PROMOTION',
                recordDate: new Date().toISOString().slice(0, 10),
                employeeId: employee.id,
                employeeName: employee.name,
                payload,
                pdfBuffer: fileName.pdfBuffer,
            });
        }

        return res.json({
            success: true,
            summary: {
                customers_served: payload.claimed_count,
                testers_given_out: payload.claimed_count,
                left_in_box: payload.remaining,
            },
            pdfUrl: fileName ? `/records/${encodeURIComponent(fileName.fileName)}` : null,
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// Matches the rest of this app's PDF convention (pdf-lib, not pdfkit - see fillSc2.js etc.):
// build a page with drawText/drawRectangle calls and get a Buffer straight back from
// doc.save(), no stream/response involved at all.
async function generateRunPdf(payload) {
    try {
        const doc = await PDFDocument.create();
        const page = doc.addPage([595.28, 841.89]); // A4 in points
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        let y = 780;
        const left = 48;
        const black = rgb(0, 0, 0);
        const grey = rgb(0.35, 0.35, 0.35);

        const line = (text, { size = 11, bold = false, color = black, gap = 18 } = {}) => {
            page.drawText(text, { x: left, y, size, font: bold ? fontBold : font, color });
            y -= gap;
        };

        line('Tester Promotion Run', { size: 20, bold: true, gap: 26 });
        line(`${todayLabel()} · ${payload.tester_name}`, { size: 11, color: grey, gap: 30 });

        line('Run details', { size: 13, bold: true, gap: 20 });
        line(`Tester: ${payload.tester_name}`);
        line(`Window: ${payload.starts_at} - ${payload.ends_at}`);
        line(`On the counter: ${payload.staff_name}`);
        line(`Stock at start: ${payload.stock}`, { gap: 26 });

        line('Summary', { size: 13, bold: true, gap: 20 });
        line(`Customers served: ${payload.claimed_count}`);
        line(`Testers given out: ${payload.claimed_count}`);
        line(`Left in the box: ${payload.remaining}`, { gap: 26 });

        line('Claim log', { size: 13, bold: true, gap: 20 });
        if (payload.recent_claims.length === 0) {
            line('No claims recorded this run.', { size: 10, color: grey });
        } else {
            payload.recent_claims.slice().reverse().forEach((claim) => {
                if (y < 60) return; // simple single-page cap - a promo runs dozens, not hundreds, of claims
                line(`${claim.time} - ${claim.note}`, { size: 10, gap: 15 });
            });
        }

        const pdfBytes = await doc.save();
        const sanitizedName = String(payload.staff_name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_');
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `TESTER-PROMOTION-${dateStr}-${sanitizedName}-${Date.now()}.pdf`;

        return { fileName, pdfBuffer: Buffer.from(pdfBytes) };
    } catch (err) {
        console.error('[testerPromotion] PDF generation failed', err);
        return null;
    }
}

// Renders the till's QR code as a PNG data URL for the setup screen to display/print.
// Encodes a real, openable URL (not a bare custom-scheme string) - a customer's first
// instinct is to point their phone's own native camera app at any QR code they see, not to
// already be on the Naa Tester Claim page with its in-page scanner open. A bare string
// decodes to inert text with no "open" action, which is why the code "didn't do anything"
// when tried with a normal camera. The in-page camera scanner (naa_tester_claim.html) still
// works too, as a fallback for a customer who's already mid-flow on the Eligible screen -
// it just parses the same ?till= param back out of this URL instead of a custom scheme.
exports.getTillQr = async (req, res) => {
    try {
        const tillId = String(req.query.till_id || testerPromotion.DEFAULT_TILL_ID);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const claimUrl = `${baseUrl}/naa-tester-claim?till=${encodeURIComponent(tillId)}`;
        const dataUrl = await QRCode.toDataURL(claimUrl, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 480,
        });

        return res.json({ success: true, till_id: tillId, qr_data_url: dataUrl, payload: claimUrl });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
