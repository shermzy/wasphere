import { All, Controller, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { McpPrincipal, McpService } from './mcp.service';

interface McpRequest extends Request {
  user?: Partial<McpPrincipal>;
  body: unknown;
}

@Controller('mcp')
@UseGuards(CombinedAuthGuard)
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @All()
  @ApiExcludeEndpoint()
  async handle(@Req() req: McpRequest, @Res() res: Response): Promise<void> {
    const user = req.user;
    if (!user?.apiKeyId || !user.userId || !user.workspaceId || !user.permissions) {
      throw new UnauthorizedException('MCP requires a project-routing API key');
    }

    const server = this.mcp.createServer(user as McpPrincipal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      void server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      await server.close().catch(() => undefined);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' });
      }
    }
  }
}
