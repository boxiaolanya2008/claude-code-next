import type { Token, Tokens } from 'marked';
import React from 'react';
import stripAnsi from 'strip-ansi';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { wrapAnsi } from '../ink/wrapAnsi.js';
import { Ansi, useTheme } from '../ink.js';
import type { CliHighlight } from '../utils/cliHighlight.js';
import { formatToken, padAligned } from '../utils/markdown.js';

const SAFETY_MARGIN = 4;

const MIN_COLUMN_WIDTH = 3;

const MAX_ROW_LINES = 4;

const ANSI_BOLD_START = '\x1b[1m';
const ANSI_BOLD_END = '\x1b[22m';
type Props = {
  token: Tokens.Table;
  highlight: CliHighlight | null;
  
  forceWidth?: number;
};

function wrapText(text: string, width: number, options?: {
  hard?: boolean;
}): string[] {
  if (width <= 0) return [text];
  
  
  
  const trimmedText = text.trimEnd();
  const wrapped = wrapAnsi(trimmedText, width, {
    hard: options?.hard ?? false,
    trim: false,
    wordWrap: true
  });
  
  
  const lines = wrapped.split('\n').filter(line => line.length > 0);
  
  return lines.length > 0 ? lines : [''];
}

export function MarkdownTable({
  token,
  highlight,
  forceWidth
}: Props): React.ReactNode {
  const [theme] = useTheme();
  const {
    columns: actualTerminalWidth
  } = useTerminalSize();
  const terminalWidth = forceWidth ?? actualTerminalWidth;

  
  function formatCell(tokens: Token[] | undefined): string {
    return tokens?.map(_ => formatToken(_, theme, 0, null, null, highlight)).join('') ?? '';
  }

  
  function getPlainText(tokens_0: Token[] | undefined): string {
    return stripAnsi(formatCell(tokens_0));
  }

  
  function getMinWidth(tokens_1: Token[] | undefined): number {
    const text = getPlainText(tokens_1);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return MIN_COLUMN_WIDTH;
    return Math.max(...words.map(w_0 => stringWidth(w_0)), MIN_COLUMN_WIDTH);
  }

  
  function getIdealWidth(tokens_2: Token[] | undefined): number {
    return Math.max(stringWidth(getPlainText(tokens_2)), MIN_COLUMN_WIDTH);
  }

  
  
  const minWidths = token.header.map((header, colIndex) => {
    let maxMinWidth = getMinWidth(header.tokens);
    for (const row of token.rows) {
      maxMinWidth = Math.max(maxMinWidth, getMinWidth(row[colIndex]?.tokens));
    }
    return maxMinWidth;
  });
  const idealWidths = token.header.map((header_0, colIndex_0) => {
    let maxIdeal = getIdealWidth(header_0.tokens);
    for (const row_0 of token.rows) {
      maxIdeal = Math.max(maxIdeal, getIdealWidth(row_0[colIndex_0]?.tokens));
    }
    return maxIdeal;
  });

  
  
  const numCols = token.header.length;
  const borderOverhead = 1 + numCols * 3; 
  
  const availableWidth = Math.max(terminalWidth - borderOverhead - SAFETY_MARGIN, numCols * MIN_COLUMN_WIDTH);

  
  const totalMin = minWidths.reduce((sum, w_1) => sum + w_1, 0);
  const totalIdeal = idealWidths.reduce((sum_0, w_2) => sum_0 + w_2, 0);

  
  let needsHardWrap = false;
  let columnWidths: number[];
  if (totalIdeal <= availableWidth) {
    
    columnWidths = idealWidths;
  } else if (totalMin <= availableWidth) {
    
    const extraSpace = availableWidth - totalMin;
    const overflows = idealWidths.map((ideal, i) => ideal - minWidths[i]!);
    const totalOverflow = overflows.reduce((sum_1, o) => sum_1 + o, 0);
    columnWidths = minWidths.map((min, i_0) => {
      if (totalOverflow === 0) return min;
      const extra = Math.floor(overflows[i_0]! / totalOverflow * extraSpace);
      return min + extra;
    });
  } else {
    
    
    needsHardWrap = true;
    const scaleFactor = availableWidth / totalMin;
    columnWidths = minWidths.map(w_3 => Math.max(Math.floor(w_3 * scaleFactor), MIN_COLUMN_WIDTH));
  }

  
  function calculateMaxRowLines(): number {
    let maxLines = 1;
    
    for (let i_1 = 0; i_1 < token.header.length; i_1++) {
      const content = formatCell(token.header[i_1]!.tokens);
      const wrapped = wrapText(content, columnWidths[i_1]!, {
        hard: needsHardWrap
      });
      maxLines = Math.max(maxLines, wrapped.length);
    }
    
    for (const row_1 of token.rows) {
      for (let i_2 = 0; i_2 < row_1.length; i_2++) {
        const content_0 = formatCell(row_1[i_2]?.tokens);
        const wrapped_0 = wrapText(content_0, columnWidths[i_2]!, {
          hard: needsHardWrap
        });
        maxLines = Math.max(maxLines, wrapped_0.length);
      }
    }
    return maxLines;
  }

  
  const maxRowLines = calculateMaxRowLines();
  const useVerticalFormat = maxRowLines > MAX_ROW_LINES;

  
  
  function renderRowLines(cells: Array<{
    tokens?: Token[];
  }>, isHeader: boolean): string[] {
    
    const cellLines = cells.map((cell, colIndex_1) => {
      const formattedText = formatCell(cell.tokens);
      const width = columnWidths[colIndex_1]!;
      return wrapText(formattedText, width, {
        hard: needsHardWrap
      });
    });

    
    const maxLines_0 = Math.max(...cellLines.map(lines => lines.length), 1);

    
    const verticalOffsets = cellLines.map(lines_0 => Math.floor((maxLines_0 - lines_0.length) / 2));

    
    const result: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines_0; lineIdx++) {
      let line = '│';
      for (let colIndex_2 = 0; colIndex_2 < cells.length; colIndex_2++) {
        const lines_1 = cellLines[colIndex_2]!;
        const offset = verticalOffsets[colIndex_2]!;
        const contentLineIdx = lineIdx - offset;
        const lineText = contentLineIdx >= 0 && contentLineIdx < lines_1.length ? lines_1[contentLineIdx]! : '';
        const width_0 = columnWidths[colIndex_2]!;
        
        const align = isHeader ? 'center' : token.align?.[colIndex_2] ?? 'left';
        line += ' ' + padAligned(lineText, stringWidth(lineText), width_0, align) + ' │';
      }
      result.push(line);
    }
    return result;
  }

  
  function renderBorderLine(type: 'top' | 'middle' | 'bottom'): string {
    const [left, mid, cross, right] = {
      top: ['┌', '─', '┬', '┐'],
      middle: ['├', '─', '┼', '┤'],
      bottom: ['└', '─', '┴', '┘']
    }[type] as [string, string, string, string];
    let line_0 = left;
    columnWidths.forEach((width_1, colIndex_3) => {
      line_0 += mid.repeat(width_1 + 2);
      line_0 += colIndex_3 < columnWidths.length - 1 ? cross : right;
    });
    return line_0;
  }

  
  function renderVerticalFormat(): string {
    const lines_2: string[] = [];
    const headers = token.header.map(h => getPlainText(h.tokens));
    const separatorWidth = Math.min(terminalWidth - 1, 40);
    const separator = '─'.repeat(separatorWidth);
    
    const wrapIndent = '  ';
    token.rows.forEach((row_2, rowIndex) => {
      if (rowIndex > 0) {
        lines_2.push(separator);
      }
      row_2.forEach((cell_0, colIndex_4) => {
        const label = headers[colIndex_4] || `Column ${colIndex_4 + 1}`;
        
        const rawValue = formatCell(cell_0.tokens).trimEnd();
        const value = rawValue.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

        
        const firstLineWidth = terminalWidth - stringWidth(label) - 3;
        const subsequentLineWidth = terminalWidth - wrapIndent.length - 1;

        
        
        const firstPassLines = wrapText(value, Math.max(firstLineWidth, 10));
        const firstLine = firstPassLines[0] || '';
        let wrappedValue: string[];
        if (firstPassLines.length <= 1 || subsequentLineWidth <= firstLineWidth) {
          wrappedValue = firstPassLines;
        } else {
          
          const remainingText = firstPassLines.slice(1).map(l => l.trim()).join(' ');
          const rewrapped = wrapText(remainingText, subsequentLineWidth);
          wrappedValue = [firstLine, ...rewrapped];
        }

        
        lines_2.push(`${ANSI_BOLD_START}${label}:${ANSI_BOLD_END} ${wrappedValue[0] || ''}`);

        
        for (let i_3 = 1; i_3 < wrappedValue.length; i_3++) {
          const line_1 = wrappedValue[i_3]!;
          if (!line_1.trim()) continue;
          lines_2.push(`${wrapIndent}${line_1}`);
        }
      });
    });
    return lines_2.join('\n');
  }

  
  if (useVerticalFormat) {
    return <Ansi>{renderVerticalFormat()}</Ansi>;
  }

  
  const tableLines: string[] = [];
  tableLines.push(renderBorderLine('top'));
  tableLines.push(...renderRowLines(token.header, true));
  tableLines.push(renderBorderLine('middle'));
  token.rows.forEach((row_3, rowIndex_0) => {
    tableLines.push(...renderRowLines(row_3, false));
    if (rowIndex_0 < token.rows.length - 1) {
      tableLines.push(renderBorderLine('middle'));
    }
  });
  tableLines.push(renderBorderLine('bottom'));

  
  
  
  const maxLineWidth = Math.max(...tableLines.map(line_2 => stringWidth(stripAnsi(line_2))));

  
  
  if (maxLineWidth > terminalWidth - SAFETY_MARGIN) {
    return <Ansi>{renderVerticalFormat()}</Ansi>;
  }

  
  return <Ansi>{tableLines.join('\n')}</Ansi>;
}
