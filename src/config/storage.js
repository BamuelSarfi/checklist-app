const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DEFAULT_SIGNED_URL_EXPIRES_IN = Number(process.env.R2_SIGNED_URL_EXPIRES_IN || 300);

let r2Client;

function hasR2Config() {
    return Boolean(
        process.env.R2_ACCOUNT_ID &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        process.env.R2_BUCKET_NAME
    );
}

function getR2Endpoint() {
    return String(process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).trim();
}

function getR2Client() {
    if (!hasR2Config()) {
        throw new Error('R2 storage is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME)');
    }

    if (!r2Client) {
        r2Client = new S3Client({
            region: 'auto',
            endpoint: getR2Endpoint(),
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            },
            forcePathStyle: true,
        });
    }

    return r2Client;
}

function getBucketName() {
    return String(process.env.R2_BUCKET_NAME || '').trim();
}

function sanitizeSegment(value) {
    return String(value || 'item')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'item';
}

function buildFileKey({ recordType, recordDate, employeeName, extension }) {
    const stamp = crypto.randomUUID();
    return `records/${sanitizeSegment(recordType)}-${stamp}-${sanitizeSegment(recordDate)}-${sanitizeSegment(employeeName)}.${extension}`;
}

function buildPdfKey({ recordType, recordDate, employeeName }) {
    return buildFileKey({ recordType, recordDate, employeeName, extension: 'pdf' });
}

async function uploadFile(key, buffer, contentType) {
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    await getR2Client().send(new PutObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
    }));

    return key;
}

async function uploadPdf(key, buffer) {
    return uploadFile(key, buffer, 'application/pdf');
}

async function deleteObject(key) {
    if (!key) {
        return false;
    }

    await getR2Client().send(new DeleteObjectCommand({
        Bucket: getBucketName(),
        Key: key,
    }));

    return true;
}

async function getDownloadUrl(key, { downloadName, expiresIn = DEFAULT_SIGNED_URL_EXPIRES_IN, contentType = 'application/pdf', disposition = 'inline' } = {}) {
    const command = new GetObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: downloadName ? `${disposition}; filename="${downloadName.replace(/"/g, '')}"` : undefined,
    });

    return getSignedUrl(getR2Client(), command, { expiresIn });
}

// Unlike getDownloadUrl, this never hands the client a URL pointing at the real R2 key - the
// key embeds the employee name (buildFileKey above), so redirecting a public/unauthenticated
// caller to a presigned URL for it would leak that name via the browser's address bar/network
// tab even with a redacted Content-Disposition header. Used by the public library route,
// which streams the bytes through this server instead and sets its own redacted filename.
async function getObjectStream(key) {
    const response = await getR2Client().send(new GetObjectCommand({
        Bucket: getBucketName(),
        Key: key,
    }));

    return { body: response.Body, contentLength: response.ContentLength };
}

module.exports = {
    hasR2Config,
    buildFileKey,
    buildPdfKey,
    uploadFile,
    uploadPdf,
    deleteObject,
    getDownloadUrl,
    getObjectStream,
};
