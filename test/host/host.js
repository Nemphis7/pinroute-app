// A stand-in for Claude: embeds the planner in an iframe and connects it to the real Pinroute server through
// the MCP Apps host bridge, recording what the planner asks the host to do. Like Claude, it resizes the frame when
// the planner asks for full screen and tells the planner its new display mode.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

window.__messages = []; window.__links = []; window.__context = []; window.__modes = [];

// opts: { inline: [w, h], full: [w, h], modes: ['inline', 'fullscreen'], tool: 'open_planner' }
window.startHost = async (mcpUrl, args, theme = 'light', opts = {}) => {
  const inline = opts.inline || [760, 1500], full = opts.full || [1100, 760];
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  const res = await client.readResource({ uri: 'ui://pinroute/planner' });

  const iframe = document.createElement('iframe');
  iframe.id = 'planner';
  const size = ([w, h]) => { iframe.style.cssText = `width:${w}px;height:${h}px;border:0;display:block`; };
  size(inline);
  document.body.append(iframe);

  let hostContext = { theme, displayMode: 'inline', availableDisplayModes: opts.modes || ['inline', 'fullscreen'], locale: 'en-GB' };
  // The starting context goes in at construction: setHostContext() before connecting would notify a view that isn't there yet
  const bridge = new AppBridge(client, { name: 'TestHost', version: '1.0.0' },
    { openLinks: {}, serverTools: {}, logging: {}, updateModelContext: { text: {} }, message: { text: {} } },
    { hostContext });
  bridge.onmessage = async (p) => { window.__messages.push(p); return {}; };
  bridge.onopenlink = async (p) => { window.__links.push(p.url); return {}; };
  bridge.onupdatemodelcontext = async (p) => { window.__context.push(p); return {}; };
  bridge.onrequestdisplaymode = async (p) => {
    window.__modes.push(p.mode);
    hostContext = { ...hostContext, displayMode: p.mode };
    size(p.mode === 'fullscreen' ? full : inline);
    setTimeout(() => bridge.setHostContext(hostContext), 0);
    return { mode: p.mode };
  };
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: args });
    const result = await client.callTool({ name: opts.tool || 'open_planner', arguments: args });
    await bridge.sendToolResult(result);
  };
  // Listen before the page loads, so the planner's first handshake is not missed
  await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
  iframe.srcdoc = res.contents[0].text;
  window.__bridge = bridge; window.__client = client;
};
