/**
 * gmail-api.js
 * Lightweight helpers that hit Gmail REST endpoints using googleapis.
 */
import { google } from 'googleapis';

// Build gmail client from raw access token
function buildClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth });
}

export async function sendEmail(accessToken, { to, subject, body }) {
  const gmail = buildClient(accessToken);
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    body,
  ];
  const encodedMessage = Buffer.from(messageParts.join('\n')).toString('base64url');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });
  return '📧 Email sent successfully!';
}

export async function readEmails(accessToken, { query = '', maxResults = 10 }) {
  const gmail = buildClient(accessToken);
  // List message IDs
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });
  const ids = listRes.data.messages?.map((m) => m.id) || [];
  const messages = [];
  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
    messages.push({ id, snippet: msg.data.snippet, headers: msg.data.payload?.headers });
  }
  return messages;
}
