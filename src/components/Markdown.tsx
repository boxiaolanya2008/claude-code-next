import { c as _c } from "react/compiler-runtime";
import { marked, type Token, type Tokens } from 'marked';
import React, { Suspense, use, useMemo, useRef } from 'react';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, useTheme } from '../ink.js';
import { type CliHighlight, getCliHighlightPromise } from '../utils/cliHighlight.js';
import { hashContent } from '../utils/hash.js';
import { configureMarked, formatToken } from '../utils/markdown.js';
import { stripPromptXMLTags } from '../utils/messages.js';
import { MarkdownTable } from './MarkdownTable.js';
type Props = {
  children: string;
  
  dimColor?: boolean;
};

const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, Token[]>();

const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;
function hasMarkdownSyntax(s: string): boolean {
  
  
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}
function cachedLexer(content: string): Token[] {
  
  
  
  
  if (!hasMarkdownSyntax(content)) {
    return [{
      type: 'paragraph',
      raw: content,
      text: content,
      tokens: [{
        type: 'text',
        raw: content,
        text: content
      }]
    } as Token];
  }
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
    
    
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = marked.lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

export function Markdown(props) {
  const $ = _c(4);
  const settings = useSettings();
  if (settings.syntaxHighlightingDisabled) {
    let t0;
    if ($[0] !== props) {
      t0 = <MarkdownBody {...props} highlight={null} />;
      $[0] = props;
      $[1] = t0;
    } else {
      t0 = $[1];
    }
    return t0;
  }
  let t0;
  if ($[2] !== props) {
    t0 = <Suspense fallback={<MarkdownBody {...props} highlight={null} />}><MarkdownWithHighlight {...props} /></Suspense>;
    $[2] = props;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  return t0;
}
function MarkdownWithHighlight(props) {
  const $ = _c(4);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = getCliHighlightPromise();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const highlight = use(t0);
  let t1;
  if ($[1] !== highlight || $[2] !== props) {
    t1 = <MarkdownBody {...props} highlight={highlight} />;
    $[1] = highlight;
    $[2] = props;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  return t1;
}
function MarkdownBody(t0) {
  const $ = _c(7);
  const {
    children,
    dimColor,
    highlight
  } = t0;
  const [theme] = useTheme();
  configureMarked();
  let elements;
  if ($[0] !== children || $[1] !== dimColor || $[2] !== highlight || $[3] !== theme) {
    const tokens = cachedLexer(stripPromptXMLTags(children));
    elements = [];
    let nonTableContent = "";
    const flushNonTableContent = function flushNonTableContent() {
      if (nonTableContent) {
        elements.push(<Ansi key={elements.length} dimColor={dimColor}>{nonTableContent.trim()}</Ansi>);
        nonTableContent = "";
      }
    };
    for (const token of tokens) {
      if (token.type === "table") {
        flushNonTableContent();
        elements.push(<MarkdownTable key={elements.length} token={token as Tokens.Table} highlight={highlight} />);
      } else {
        nonTableContent = nonTableContent + formatToken(token, theme, 0, null, null, highlight);
        nonTableContent;
      }
    }
    flushNonTableContent();
    $[0] = children;
    $[1] = dimColor;
    $[2] = highlight;
    $[3] = theme;
    $[4] = elements;
  } else {
    elements = $[4];
  }
  const elements_0 = elements;
  let t1;
  if ($[5] !== elements_0) {
    t1 = <Box flexDirection="column" gap={1}>{elements_0}</Box>;
    $[5] = elements_0;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  return t1;
}
type StreamingProps = {
  children: string;
};

export function StreamingMarkdown({
  children
}: StreamingProps): React.ReactNode {
  
  
  
  
  
  'use no memo';

  configureMarked();

  
  
  
  
  const stripped = stripPromptXMLTags(children);
  const stablePrefixRef = useRef('');

  
  if (!stripped.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = '';
  }

  
  const boundary = stablePrefixRef.current.length;
  const tokens = marked.lexer(stripped.substring(boundary));

  
  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === 'space') {
    lastContentIdx--;
  }
  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tokens[i]!.raw.length;
  }
  if (advance > 0) {
    stablePrefixRef.current = stripped.substring(0, boundary + advance);
  }
  const stablePrefix = stablePrefixRef.current;
  const unstableSuffix = stripped.substring(stablePrefix.length);

  
  
  return <Box flexDirection="column" gap={1}>
      {stablePrefix && <Markdown>{stablePrefix}</Markdown>}
      {unstableSuffix && <Markdown>{unstableSuffix}</Markdown>}
    </Box>;
}
