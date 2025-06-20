#!/usr/bin/env node
/**
 * custom-mcp-servers/gmail-mcp-server/index.js
 *
 *  • Runs as an MCP stdio server (child-process managed by LibreChat)
 *  • Exposes three tools: authenticate_gmail, send_email, read_emails
 *  • Uses the shared SQLite token DB (../shared/oauth-db/database.js)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  hasRefreshToken,
  getValidAccessToken,
} from '../shared/oauth-db/database.js';

import { startOAuthServer } from './oauth-handler.js';
import { sendEmail, readEmails } from './gmail-api.js';

/************************  CONFIG  ************************/ 
const PROVIDER = 'gmail';
const OAUTH_PORT = process.env.GMAIL_OAUTH_PORT || 3001; // can override in env
const OAUTH_BASE = `http://localhost:${OAUTH_PORT}`;

/*********************  START OAUTH HTTP  *****************/
startOAuthServer(OAUTH_PORT);
console.error(`OAuth server listening on ${OAUTH_BASE}`);

/*********************  MCP SERVER INIT  *****************/
const mcpServer = new Server({
  name: 'gmail-mcp-server',
  version: '1.0.0',
});

/*********************  TOOLS DECLARATION  *****************/
const tools = [
  {
    name: 'authenticate_gmail',
    description: 'Connect your Gmail account to enable Gmail tools',
  },
  {
    name: 'send_email',
    description: 'Send an email via Gmail',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain-text body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'read_emails',
    description: 'Read your most recent Gmail messages',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        maxResults: { type: 'number', description: 'How many emails (default 10)' },
      },
    },
  },
];

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
  const userId = process.env.LIBRECHAT_USER_ID;
  if (!userId) throw new Error('LIBRECHAT_USER_ID env missing');

  const { name: toolName, arguments: args = {} } = req.params;

  // 1) AUTHENTICATE
  if (toolName === 'authenticate_gmail') {
    const connected = hasRefreshToken(userId, PROVIDER);
    if (connected) {
      return {
        content: [
          { type: 'text', text: '✅ Gmail already connected!' },
        ],
      };
    }
    const url = `${OAUTH_BASE}/auth/start?user=${encodeURIComponent(userId)}`;
    return {
      content: [
        {
          type: 'text',
          text: `🔐 Gmail not connected yet.\n\nClick the link below to authenticate: \n${url}\n\nAfter completing the process, re-run your Gmail command.`,
        },
      ],
    };
  }

  // All other tools require valid token
  const accessToken = await getValidAccessToken(userId, PROVIDER);
  if (!accessToken) {
    return {
      content: [
        {
          type: 'text',
          text: '❌ Gmail not connected. Run "authenticate_gmail" first.',
        },
      ],
    };
  }

  // 2) SEND EMAIL
  if (toolName === 'send_email') {
    const { to, subject, body } = args;
    const result = await sendEmail(accessToken, { to, subject, body });
    return { content: [{ type: 'text', text: result }] };
  }

  // 3) READ EMAILS
  if (toolName === 'read_emails') {
    const { query = '', maxResults = 10 } = args;
    const messages = await readEmails(accessToken, { query, maxResults });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(messages, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${toolName}`);
});

/*********************  START TRANSPORT  *****************/
(async () => {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('gmail-mcp-server ready (stdio)');
})();
