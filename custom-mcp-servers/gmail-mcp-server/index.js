import { Server } from '@modelcontextprotocol/sdk';
import { google } from 'googleapis';
import Database from '../shared/oauth-db/database.js';
import 'dotenv/config';

// ------------------ Tools description ------------------
const tools = [
  {
    name: 'authenticate_gmail',
    description:
      'Runs the OAuth flow. Execute this once per user to link their Gmail account.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'send_email',
    description: 'Send an e-mail from the authenticated Gmail account.',
    parameters: {
      type: 'object',
      required: ['to', 'subject', 'body'],
      properties: {
        to: { type: 'string', description: 'comma-separated recipients' },
        subject: { type: 'string' },
        body: { type: 'string' }
      }
    }
  },
  {
    name: 'read_emails',
    description: 'Read the latest messages in the inbox.',
    parameters: {
      type: 'object',
      properties: {
        max: { type: 'integer', default: 5, description: 'max results' }
      }
    }
  }
];

// ------------------ Server ------------------
const server = new Server({ tools });

function getOAuthClient(userId) {
  const db = Database.open(process.env.OAUTH_DB_PATH);
  const tokens = db.getTokens(userId);
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials(tokens);
  return client;
}

server.setRequestHandler('authenticate_gmail', async ({ headers }) => {
  const userId = headers['x-user-id'];
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI.replace('{USER_ID}', userId)
  );
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.modify']
  });
  return { authorization_url: url };
});

server.setRequestHandler('send_email', async ({ headers, to, subject, body }) => {
  const userId = headers['x-user-id'];
  const auth = getOAuthClient(userId);
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`)
        .toString('base64url')
    }
  });
  return { status: 'sent' };
});

server.setRequestHandler('read_emails', async ({ headers, max = 5 }) => {
  const userId = headers['x-user-id'];
  const auth = getOAuthClient(userId);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.list({ userId: 'me', maxResults: max });
  return data.messages ?? [];
});

server.listenStdio();
