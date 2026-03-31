import { c as _c } from "react/compiler-runtime";
import { feature } from "../utils/bundle-mock.ts";
import figures from 'figures';
import * as React from 'react';
import type { z } from 'zod/v4';
import { ProgressBar } from '../../components/design-system/ProgressBar.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { linkifyUrlsInText, OutputLine } from '../../components/shell/OutputLine.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Ansi, Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import type { MCPProgress } from '../../types/tools.js';
import { formatNumber } from '../../utils/format.js';
import { createHyperlink } from '../../utils/hyperlink.js';
import { getContentSizeEstimate, type MCPToolResult } from '../../utils/mcpValidation.js';
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js';
import type { inputSchema } from './MCPTool.js';

const MCP_OUTPUT_WARNING_THRESHOLD_TOKENS = 10_000;

const MAX_INPUT_VALUE_CHARS = 80;

const MAX_FLAT_JSON_KEYS = 12;

const MAX_FLAT_JSON_CHARS = 5_000;

const MAX_JSON_PARSE_CHARS = 200_000;

const UNWRAP_MIN_STRING_LEN = 200;
export function renderToolUseMessage(input: z.infer<ReturnType<typeof inputSchema>>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (Object.keys(input).length === 0) {
    return '';
  }
  return Object.entries(input).map(([key, value]) => {
    let rendered = jsonStringify(value);
    if (feature('MCP_RICH_OUTPUT') && !verbose && rendered.length > MAX_INPUT_VALUE_CHARS) {
      rendered = rendered.slice(0, MAX_INPUT_VALUE_CHARS).trimEnd() + '…';
    }
    return `${key}: ${rendered}`;
  }).join(', ');
}
export function renderToolUseProgressMessage(progressMessagesForMessage: ProgressMessage<MCPProgress>[]): React.ReactNode {
  const lastProgress = progressMessagesForMessage.at(-1);
  if (!lastProgress?.data) {
    return <MessageResponse height={1}>
        <Text dimColor>Running…</Text>
      </MessageResponse>;
  }
  const {
    progress,
    total,
    progressMessage
  } = lastProgress.data;
  if (progress === undefined) {
    return <MessageResponse height={1}>
        <Text dimColor>Running…</Text>
      </MessageResponse>;
  }
  if (total !== undefined && total > 0) {
    const ratio = Math.min(1, Math.max(0, progress / total));
    const percentage = Math.round(ratio * 100);
    return <MessageResponse>
        <Box flexDirection="column">
          {progressMessage && <Text dimColor>{progressMessage}</Text>}
          <Box flexDirection="row" gap={1}>
            <ProgressBar ratio={ratio} width={20} />
            <Text dimColor>{percentage}%</Text>
          </Box>
        </Box>
      </MessageResponse>;
  }
  return <MessageResponse height={1}>
      <Text dimColor>{progressMessage ?? `Processing… ${progress}`}</Text>
    </MessageResponse>;
}
export function renderToolResultMessage(output: string | MCPToolResult, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], {
  verbose,
  input
}: {
  verbose: boolean;
  input?: unknown;
}): React.ReactNode {
  const mcpOutput = output as MCPToolResult;
  if (!verbose) {
    const slackSend = trySlackSendCompact(mcpOutput, input);
    if (slackSend !== null) {
      return <MessageResponse height={1}>
          <Text>
            Sent a message to{' '}
            <Ansi>{createHyperlink(slackSend.url, slackSend.channel)}</Ansi>
          </Text>
        </MessageResponse>;
    }
  }
  const estimatedTokens = getContentSizeEstimate(mcpOutput);
  const showWarning = estimatedTokens > MCP_OUTPUT_WARNING_THRESHOLD_TOKENS;
  const warningMessage = showWarning ? `${figures.warning} Large MCP response (~${formatNumber(estimatedTokens)} tokens), this can fill up context quickly` : null;
  let contentElement: React.ReactNode;
  if (Array.isArray(mcpOutput)) {
    const contentBlocks = mcpOutput.map((item, i) => {
      if (item.type === 'image') {
        return <Box key={i} justifyContent="space-between" overflowX="hidden" width="100%">
            <MessageResponse height={1}>
              <Text>[Image]</Text>
            </MessageResponse>
          </Box>;
      }
      
      const textContent = item.type === 'text' && 'text' in item && item.text !== null && item.text !== undefined ? String(item.text) : '';
      return feature('MCP_RICH_OUTPUT') ? <MCPTextOutput key={i} content={textContent} verbose={verbose} /> : <OutputLine key={i} content={textContent} verbose={verbose} />;
    });

    
    contentElement = <Box flexDirection="column" width="100%">
        {contentBlocks}
      </Box>;
  } else if (!mcpOutput) {
    contentElement = <Box justifyContent="space-between" overflowX="hidden" width="100%">
        <MessageResponse height={1}>
          <Text dimColor>(No content)</Text>
        </MessageResponse>
      </Box>;
  } else {
    contentElement = feature('MCP_RICH_OUTPUT') ? <MCPTextOutput content={mcpOutput} verbose={verbose} /> : <OutputLine content={mcpOutput} verbose={verbose} />;
  }
  if (warningMessage) {
    return <Box flexDirection="column">
        <MessageResponse height={1}>
          <Text color="warning">{warningMessage}</Text>
        </MessageResponse>
        {contentElement}
      </Box>;
  }
  return contentElement;
}

function MCPTextOutput(t0) {
  const $ = _c(18);
  const {
    content,
    verbose
  } = t0;
  let t1;
  if ($[0] !== content || $[1] !== verbose) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const unwrapped = tryUnwrapTextPayload(content);
      if (unwrapped !== null) {
        const t2 = unwrapped.extras.length > 0 && <Text dimColor={true}>{unwrapped.extras.map(_temp).join(" \xB7 ")}</Text>;
        let t3;
        if ($[3] !== unwrapped || $[4] !== verbose) {
          t3 = <OutputLine content={unwrapped.body} verbose={verbose} linkifyUrls={true} />;
          $[3] = unwrapped;
          $[4] = verbose;
          $[5] = t3;
        } else {
          t3 = $[5];
        }
        let t4;
        if ($[6] !== t2 || $[7] !== t3) {
          t4 = <MessageResponse><Box flexDirection="column">{t2}{t3}</Box></MessageResponse>;
          $[6] = t2;
          $[7] = t3;
          $[8] = t4;
        } else {
          t4 = $[8];
        }
        t1 = t4;
        break bb0;
      }
    }
    $[0] = content;
    $[1] = verbose;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
  let t2;
  if ($[9] !== content) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb1: {
      const flat = tryFlattenJson(content);
      if (flat !== null) {
        const maxKeyWidth = Math.max(...flat.map(_temp2));
        let t3;
        if ($[11] !== maxKeyWidth) {
          t3 = (t4, i) => {
            const [key, value] = t4;
            return <Text key={i}><Text dimColor={true}>{key.padEnd(maxKeyWidth)}: </Text><Ansi>{linkifyUrlsInText(value)}</Ansi></Text>;
          };
          $[11] = maxKeyWidth;
          $[12] = t3;
        } else {
          t3 = $[12];
        }
        const t4 = <Box flexDirection="column">{flat.map(t3)}</Box>;
        let t5;
        if ($[13] !== t4) {
          t5 = <MessageResponse>{t4}</MessageResponse>;
          $[13] = t4;
          $[14] = t5;
        } else {
          t5 = $[14];
        }
        t2 = t5;
        break bb1;
      }
    }
    $[9] = content;
    $[10] = t2;
  } else {
    t2 = $[10];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  let t3;
  if ($[15] !== content || $[16] !== verbose) {
    t3 = <OutputLine content={content} verbose={verbose} linkifyUrls={true} />;
    $[15] = content;
    $[16] = verbose;
    $[17] = t3;
  } else {
    t3 = $[17];
  }
  return t3;
}

function _temp2(t0) {
  const [k_0] = t0;
  return stringWidth(k_0);
}
function _temp(t0) {
  const [k, v] = t0;
  return `${k}: ${v}`;
}
function parseJsonEntries(content: string, {
  maxChars,
  maxKeys
}: {
  maxChars: number;
  maxKeys: number;
}): [string, unknown][] | null {
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > maxChars || trimmed[0] !== '{') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = jsonParse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > maxKeys) {
    return null;
  }
  return entries;
}

export function tryFlattenJson(content: string): [string, string][] | null {
  const entries = parseJsonEntries(content, {
    maxChars: MAX_FLAT_JSON_CHARS,
    maxKeys: MAX_FLAT_JSON_KEYS
  });
  if (entries === null) return null;
  const result: [string, string][] = [];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      result.push([key, value]);
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      result.push([key, String(value)]);
    } else if (typeof value === 'object') {
      const compact = jsonStringify(value);
      if (compact.length > 120) return null;
      result.push([key, compact]);
    } else {
      return null;
    }
  }
  return result;
}

export function tryUnwrapTextPayload(content: string): {
  body: string;
  extras: [string, string][];
} | null {
  const entries = parseJsonEntries(content, {
    maxChars: MAX_JSON_PARSE_CHARS,
    maxKeys: 4
  });
  if (entries === null) return null;
  
  
  let body: string | null = null;
  const extras: [string, string][] = [];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      const t = value.trimEnd();
      const isDominant = t.length > UNWRAP_MIN_STRING_LEN || t.includes('\n') && t.length > 50;
      if (isDominant) {
        if (body !== null) return null; 
        body = t;
        continue;
      }
      if (t.length > 150) return null;
      extras.push([key, t.replace(/\s+/g, ' ')]);
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      extras.push([key, String(value)]);
    } else {
      return null; 
    }
  }
  if (body === null) return null;
  return {
    body,
    extras
  };
}
const SLACK_ARCHIVES_RE = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p\d+$/;

export function trySlackSendCompact(output: string | MCPToolResult, input: unknown): {
  channel: string;
  url: string;
} | null {
  let text: unknown = output;
  if (Array.isArray(output)) {
    const block = output.find(b => b.type === 'text');
    text = block && 'text' in block ? block.text : undefined;
  }
  if (typeof text !== 'string' || !text.includes('"message_link"')) {
    return null;
  }
  const entries = parseJsonEntries(text, {
    maxChars: 2000,
    maxKeys: 6
  });
  const url = entries?.find(([k]) => k === 'message_link')?.[1];
  if (typeof url !== 'string') return null;
  const m = SLACK_ARCHIVES_RE.exec(url);
  if (!m) return null;
  const inp = input as {
    channel_id?: unknown;
    channel?: unknown;
  } | undefined;
  const raw = inp?.channel_id ?? inp?.channel ?? m[1];
  const label = typeof raw === 'string' && raw ? raw : 'slack';
  return {
    channel: label.startsWith('#') ? label : `#${label}`,
    url
  };
}
