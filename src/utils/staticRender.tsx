import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useLayoutEffect } from 'react';
import { PassThrough } from 'stream';
import stripAnsi from 'strip-ansi';
import { render, useApp } from '../ink.js';

function RenderOnceAndExit(t0) {
  const $ = _c(5);
  const {
    children
  } = t0;
  const {
    exit
  } = useApp();
  let t1;
  let t2;
  if ($[0] !== exit) {
    t1 = () => {
      const timer = setTimeout(exit, 0);
      return () => clearTimeout(timer);
    };
    t2 = [exit];
    $[0] = exit;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useLayoutEffect(t1, t2);
  let t3;
  if ($[3] !== children) {
    t3 = <>{children}</>;
    $[3] = children;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}

const SYNC_START = '\x1B[?2026h';
const SYNC_END = '\x1B[?2026l';

function extractFirstFrame(output: string): string {
  const startIndex = output.indexOf(SYNC_START);
  if (startIndex === -1) return output;
  const contentStart = startIndex + SYNC_START.length;
  const endIndex = output.indexOf(SYNC_END, contentStart);
  if (endIndex === -1) return output;
  return output.slice(contentStart, endIndex);
}

export function renderToAnsiString(node: React.ReactNode, columns?: number): Promise<string> {
  return new Promise(async resolve => {
    let output = '';

    
    
    
    
    const stream = new PassThrough();
    if (columns !== undefined) {
      ;
      (stream as unknown as {
        columns: number;
      }).columns = columns;
    }
    stream.on('data', chunk => {
      output += chunk.toString();
    });

    
    
    const instance = await render(<RenderOnceAndExit>{node}</RenderOnceAndExit>, {
      stdout: stream as unknown as NodeJS.WriteStream,
      patchConsole: false
    });

    
    await instance.waitUntilExit();

    
    
    await resolve(extractFirstFrame(output));
  });
}

export async function renderToString(node: React.ReactNode, columns?: number): Promise<string> {
  const output = await renderToAnsiString(node, columns);
  return stripAnsi(output);
}
