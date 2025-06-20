/**
 * custom-mcp-servers/gmail-mcp-server/oauth-handler.js
 *
 * Stand-alone Express HTTP server that carries out Google OAuth for Gmail.
 * It is started by index.js via startOAuthServer(port).
 *
 * After successful OAuth the refresh/access tokens are stored via the shared
 * database util so that any MCP server can reuse them.
 */
import express from 'express';
import { google } from 'googleapis';
import {
  saveTokens,
  updateAccessToken,
} from '../shared/oauth-db/database.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

let started = false; // prevent double-starts

export function startOAuthServer(port = 3001) {
  if (started) return; // already running
  started = true;

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('⚠️  GOOGLE_CLIENT_ID / SECRET env vars missing – OAuth server NOT started');
    return;
  }

  const app = express();

  /* STEP 1: Redirect user to Google */
  app.get('/auth/start', (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).send('Missing user param');

    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      `http://localhost:${port}/auth/callback`
    );

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state: userId,
    });

    res.redirect(url);
  });

  /* STEP 2: OAuth callback */
  app.get('/auth/callback', async (req, res) => {
    const { code, state: userId } = req.query;
    if (!code || !userId) return res.status(400).send('Missing code/state');

    try {
      const oauth2Client = new google.auth.OAuth2(
        CLIENT_ID,
        CLIENT_SECRET,
        `http://localhost:${port}/auth/callback`
      );

      const { tokens } = await oauth2Client.getToken(code);
      // Persist tokens (refresh is guaranteed because access_type=offline & prompt=consent)
      saveTokens(userId, 'gmail', tokens, SCOPES);

      res.send(`
        <h2>✅ Gmail connected!</h2>
        <p>You may now close this tab and return to LibreChat.</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      `);
    } catch (e) {
      console.error('OAuth callback error:', e);
      res.status(500).send('OAuth failed');
    }
  });

  /* TOKEN REFRESH endpoint (optional – not used by MCP directly) */
  app.get('/auth/refresh', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).send('Missing user');
    const refreshToken = req.query.refresh;
    if (!refreshToken) return res.status(400).send('Missing refresh');

    try {
      const oauth2Client = new google.auth.OAuth2(
        CLIENT_ID,
        CLIENT_SECRET,
        `http://localhost:${port}/auth/callback`
      );
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await oauth2Client.refreshAccessToken();
      updateAccessToken(userId, 'gmail', credentials.access_token, credentials.expiry_date / 1000 - Date.now() / 1000);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(port, () => console.error(`OAuth HTTP listening on ${port}`));
}
