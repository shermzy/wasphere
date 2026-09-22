import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { InboxService } from '../inbox/inbox.service';
import { hasPermission, isValidPermissions, PermissionScope, WILDCARD_PERMISSION } from '../lib/permissions';
import { normalizeProjectRouteKey } from '../projects/project-route-key';

export interface McpPrincipal {
  userId: string;
  workspaceId: string;
  apiKeyId: string;
  permissions: (PermissionScope | typeof WILDCARD_PERMISSION)[];
  sessionScope: string | null;
}

type RouteKeyArgs = { routeKey: string };
type SendProjectUpdateArgs = RouteKeyArgs & { text: string };
type ToolRegistration = {
  title: string;
  description: string;
  inputSchema: unknown;
  annotations?: Record<string, boolean>;
};

type RouteMatch = {
  id: string;
  sessionId: string;
  sessionDeletedAt: Date | null;
  contact: { name: string; jid: string };
};

const ROUTE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function normalizeRouteKey(value: string): string {
  const routeKey = normalizeProjectRouteKey(value);
  if (!ROUTE_KEY_PATTERN.test(routeKey)) {
    throw new BadRequestException('Route key must be 1–40 characters.');
  }
  return routeKey;
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpException && error.getStatus() < 500) {
    return typeof error.message === 'string' ? error.message : fallback;
  }
  return fallback;
}

function snapshotPrincipal(input: McpPrincipal): McpPrincipal {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    !input.userId ||
    typeof input.workspaceId !== 'string' ||
    !input.workspaceId ||
    typeof input.apiKeyId !== 'string' ||
    !input.apiKeyId ||
    !isValidPermissions(input.permissions) ||
    (input.sessionScope !== null &&
      (typeof input.sessionScope !== 'string' || !input.sessionScope))
  ) {
    throw new UnauthorizedException('MCP requires a valid project-routing API key');
  }

  return Object.freeze({
    userId: input.userId,
    workspaceId: input.workspaceId,
    apiKeyId: input.apiKeyId,
    permissions: [...input.permissions],
    sessionScope: input.sessionScope,
  });
}

function requireRouteMatch(value: unknown, principal: McpPrincipal): RouteMatch {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new ConflictException('Project route ownership changed or is not assigned.');
  }

  const candidate = value[0] as Partial<RouteMatch> | null;
  const contact = candidate?.contact as Partial<RouteMatch['contact']> | undefined;
  if (
    !candidate ||
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    typeof candidate.sessionId !== 'string' ||
    !candidate.sessionId ||
    !Object.prototype.hasOwnProperty.call(candidate, 'sessionDeletedAt') ||
    (candidate.sessionDeletedAt !== null && !(candidate.sessionDeletedAt instanceof Date)) ||
    !contact ||
    typeof contact.name !== 'string' ||
    typeof contact.jid !== 'string' ||
    !contact.jid
  ) {
    throw new ConflictException('Project route has no valid workspace/session assignment.');
  }
  if (principal.sessionScope !== null && candidate.sessionId !== principal.sessionScope) {
    throw new ConflictException('Project route is outside this API key session scope.');
  }
  if (candidate.sessionDeletedAt !== null) {
    throw new ServiceUnavailableException('Project route session is disconnected.');
  }

  return candidate as RouteMatch;
}

function sameRoute(left: RouteMatch, right: RouteMatch): boolean {
  const leftDeletedAt = left.sessionDeletedAt?.getTime() ?? null;
  const rightDeletedAt = right.sessionDeletedAt?.getTime() ?? null;
  return left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.contact.jid === right.contact.jid &&
    leftDeletedAt === rightDeletedAt;
}

@Injectable()
export class McpService {
  constructor(private readonly inbox: InboxService) {}

  createServer(input: McpPrincipal): McpServer {
    const principal = snapshotPrincipal(input);
    const server = new McpServer(
      { name: 'wasphere-project-routing', version: '1.0.0' },
      {
        instructions:
          'Use resolve_project_route before sending when the target is ambiguous. Use send_project_update for approved text updates. Project mappings are managed in the WaSphere dashboard, not through MCP. Never request or invent a WhatsApp JID or session ID.',
      },
    );
    const registerTool = (
      server as unknown as {
        registerTool: (
          name: string,
          config: ToolRegistration,
          handler: (args: Record<string, unknown>) => Promise<CallToolResult>,
        ) => void;
      }
    ).registerTool.bind(server);

    registerTool(
      'resolve_project_route',
      {
        title: 'Resolve project route',
        description:
          'Resolve a project route such as #fairbreeze to its assigned WhatsApp conversation. This is read-only and does not expose manual JID routing.',
        inputSchema: z.object({
          routeKey: z.string().trim().min(1).max(41).describe('Project route, for example #fairbreeze'),
        }).strict(),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args) => {
        const { routeKey } = args as unknown as RouteKeyArgs;
        if (!hasPermission(principal.permissions, 'messages:read')) {
          return toolError('API key missing required permission: messages:read');
        }

        try {
          const normalized = normalizeRouteKey(routeKey);
          const conversation = await this.lookupRoute(principal, normalized);
          const result = {
            routeKey: `#${normalized}`,
            conversationId: conversation.id,
            sessionId: conversation.sessionId,
            targetName: conversation.contact.name,
            targetJid: conversation.contact.jid,
            availability: 'configured',
          };
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toolError(safeErrorMessage(error, 'Unable to resolve the project route.'));
        }
      },
    );

    registerTool(
      'send_project_update',
      {
        title: 'Send project update',
        description:
          'Send a text update to the WhatsApp conversation assigned to a project route such as #fairbreeze. This sends an external message. Use only after the user has approved the message content.',
        inputSchema: z.object({
          routeKey: z.string().trim().min(1).max(41).describe('Project route, for example #fairbreeze'),
          text: z.string().trim().min(1).max(4096).describe('Text message to send'),
        }).strict(),
        annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
      },
      async (args) => {
        const { routeKey, text } = args as unknown as SendProjectUpdateArgs;
        if (!hasPermission(principal.permissions, 'messages:send')) {
          return toolError('API key missing required permission: messages:send');
        }

        try {
          const normalized = normalizeRouteKey(routeKey);
          const beforeSend = await this.lookupRoute(principal, normalized);
          const immediatelyBeforeSend = await this.lookupRoute(principal, normalized);
          if (!sameRoute(beforeSend, immediatelyBeforeSend)) {
            throw new ConflictException('Project route changed while this request was being authorized.');
          }
          const message = await this.inbox.sendToRoute(
            principal.userId,
            principal.workspaceId,
            normalized,
            { kind: 'text', text },
            principal.sessionScope,
          );
          const result = {
            sent: true,
            routeKey: `#${normalized}`,
            messageId: typeof message === 'object' && message !== null && 'id' in message ? message.id : null,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toolError(safeErrorMessage(error, 'Unable to send the project update.'));
        }
      },
    );

    return server;
  }

  private async lookupRoute(principal: McpPrincipal, routeKey: string): Promise<RouteMatch> {
    return requireRouteMatch(
      await this.inbox.listRouteMatches(
        principal.userId,
        principal.workspaceId,
        routeKey,
        principal.sessionScope,
      ),
      principal,
    );
  }
}
