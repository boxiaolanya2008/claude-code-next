import { c as _c } from "react/compiler-runtime";
import { diffWordsWithSpace, type StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { useMemo } from 'react';
import type { ThemeName } from 'src/utils/theme.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, NoSelect, Text, useTheme, wrapText } from '../../ink.js';

interface DiffLine {
  code: string;
  type: 'add' | 'remove' | 'nochange';
  i: number;
  originalCode: string;
  wordDiff?: boolean; 
  matchedLine?: DiffLine;
}

export interface LineObject {
  code: string;
  i: number;
  type: 'add' | 'remove' | 'nochange';
  originalCode: string;
  wordDiff?: boolean;
  matchedLine?: LineObject;
}

interface DiffPart {
  added?: boolean;
  removed?: boolean;
  value: string;
}
type Props = {
  patch: StructuredPatchHunk;
  dim: boolean;
  width: number;
};

const CHANGE_THRESHOLD = 0.4;
export function StructuredDiffFallback(t0) {
  const $ = _c(10);
  const {
    patch,
    dim,
    width
  } = t0;
  const [theme] = useTheme();
  let t1;
  if ($[0] !== dim || $[1] !== patch.lines || $[2] !== patch.oldStart || $[3] !== theme || $[4] !== width) {
    t1 = formatDiff(patch.lines, patch.oldStart, width, dim, theme);
    $[0] = dim;
    $[1] = patch.lines;
    $[2] = patch.oldStart;
    $[3] = theme;
    $[4] = width;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  const diff = t1;
  let t2;
  if ($[6] !== diff) {
    t2 = diff.map(_temp);
    $[6] = diff;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  let t3;
  if ($[8] !== t2) {
    t3 = <Box flexDirection="column" flexGrow={1}>{t2}</Box>;
    $[8] = t2;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  return t3;
}

function _temp(node, i) {
  return <Box key={i}>{node}</Box>;
}
export function transformLinesToObjects(lines: string[]): LineObject[] {
  return lines.map(code => {
    if (code.startsWith('+')) {
      return {
        code: code.slice(1),
        i: 0,
        type: 'add',
        originalCode: code.slice(1)
      };
    }
    if (code.startsWith('-')) {
      return {
        code: code.slice(1),
        i: 0,
        type: 'remove',
        originalCode: code.slice(1)
      };
    }
    return {
      code: code.slice(1),
      i: 0,
      type: 'nochange',
      originalCode: code.slice(1)
    };
  });
}

export function processAdjacentLines(lineObjects: LineObject[]): LineObject[] {
  const processedLines: LineObject[] = [];
  let i = 0;
  while (i < lineObjects.length) {
    const current = lineObjects[i];
    if (!current) {
      i++;
      continue;
    }

    
    if (current.type === 'remove') {
      const removeLines: LineObject[] = [current];
      let j = i + 1;

      
      while (j < lineObjects.length && lineObjects[j]?.type === 'remove') {
        const line = lineObjects[j];
        if (line) {
          removeLines.push(line);
        }
        j++;
      }

      
      const addLines: LineObject[] = [];
      while (j < lineObjects.length && lineObjects[j]?.type === 'add') {
        const line = lineObjects[j];
        if (line) {
          addLines.push(line);
        }
        j++;
      }

      
      if (removeLines.length > 0 && addLines.length > 0) {
        
        const pairCount = Math.min(removeLines.length, addLines.length);

        
        for (let k = 0; k < pairCount; k++) {
          const removeLine = removeLines[k];
          const addLine = addLines[k];
          if (removeLine && addLine) {
            removeLine.wordDiff = true;
            addLine.wordDiff = true;

            
            removeLine.matchedLine = addLine;
            addLine.matchedLine = removeLine;
          }
        }

        
        processedLines.push(...removeLines.filter(Boolean));

        
        processedLines.push(...addLines.filter(Boolean));
        i = j; 
      } else {
        
        processedLines.push(current);
        i++;
      }
    } else {
      
      processedLines.push(current);
      i++;
    }
  }
  return processedLines;
}

export function calculateWordDiffs(oldText: string, newText: string): DiffPart[] {
  
  
  const result = diffWordsWithSpace(oldText, newText, {
    ignoreCase: false
  });
  return result;
}

function generateWordDiffElements(item: DiffLine, width: number, maxWidth: number, dim: boolean, overrideTheme?: ThemeName): React.ReactNode[] | null {
  const {
    type,
    i,
    wordDiff,
    matchedLine,
    originalCode
  } = item;
  if (!wordDiff || !matchedLine) {
    return null; 
  }
  const removedLineText = type === 'remove' ? originalCode : matchedLine.originalCode;
  const addedLineText = type === 'remove' ? matchedLine.originalCode : originalCode;
  const wordDiffs = calculateWordDiffs(removedLineText, addedLineText);

  
  const totalLength = removedLineText.length + addedLineText.length;
  const changedLength = wordDiffs.filter(part => part.added || part.removed).reduce((sum, part) => sum + part.value.length, 0);
  const changeRatio = changedLength / totalLength;
  if (changeRatio > CHANGE_THRESHOLD || dim) {
    return null; 
  }

  
  const diffPrefix = type === 'add' ? '+' : '-';
  const diffPrefixWidth = diffPrefix.length;
  const availableContentWidth = Math.max(1, width - maxWidth - 1 - diffPrefixWidth);

  
  const wrappedLines: {
    content: React.ReactNode[];
    contentWidth: number;
  }[] = [];
  let currentLine: React.ReactNode[] = [];
  let currentLineWidth = 0;
  wordDiffs.forEach((part, partIndex) => {
    
    let shouldShow = false;
    let partBgColor: 'diffAddedWord' | 'diffRemovedWord' | undefined;
    if (type === 'add') {
      if (part.added) {
        shouldShow = true;
        partBgColor = 'diffAddedWord';
      } else if (!part.removed) {
        shouldShow = true;
      }
    } else if (type === 'remove') {
      if (part.removed) {
        shouldShow = true;
        partBgColor = 'diffRemovedWord';
      } else if (!part.added) {
        shouldShow = true;
      }
    }
    if (!shouldShow) return;

    
    const partWrapped = wrapText(part.value, availableContentWidth, 'wrap');
    const partLines = partWrapped.split('\n');
    partLines.forEach((partLine, lineIdx) => {
      if (!partLine) return;

      
      if (lineIdx > 0 || currentLineWidth + stringWidth(partLine) > availableContentWidth) {
        if (currentLine.length > 0) {
          wrappedLines.push({
            content: [...currentLine],
            contentWidth: currentLineWidth
          });
          currentLine = [];
          currentLineWidth = 0;
        }
      }
      currentLine.push(<Text key={`part-${partIndex}-${lineIdx}`} backgroundColor={partBgColor}>
          {partLine}
        </Text>);
      currentLineWidth += stringWidth(partLine);
    });
  });
  if (currentLine.length > 0) {
    wrappedLines.push({
      content: currentLine,
      contentWidth: currentLineWidth
    });
  }

  
  return wrappedLines.map(({
    content,
    contentWidth
  }, lineIndex) => {
    const key = `${type}-${i}-${lineIndex}`;
    const lineBgColor = type === 'add' ? dim ? 'diffAddedDimmed' : 'diffAdded' : dim ? 'diffRemovedDimmed' : 'diffRemoved';
    const lineNum = lineIndex === 0 ? i : undefined;
    const lineNumStr = (lineNum !== undefined ? lineNum.toString().padStart(maxWidth) : ' '.repeat(maxWidth)) + ' ';
    
    const usedWidth = lineNumStr.length + diffPrefixWidth + contentWidth;
    const padding = Math.max(0, width - usedWidth);
    return <Box key={key} flexDirection="row">
        <NoSelect fromLeftEdge>
          <Text color={overrideTheme ? 'text' : undefined} backgroundColor={lineBgColor} dimColor={dim}>
            {lineNumStr}
            {diffPrefix}
          </Text>
        </NoSelect>
        <Text color={overrideTheme ? 'text' : undefined} backgroundColor={lineBgColor} dimColor={dim}>
          {content}
          {' '.repeat(padding)}
        </Text>
      </Box>;
  });
}
function formatDiff(lines: string[], startingLineNumber: number, width: number, dim: boolean, overrideTheme?: ThemeName): React.ReactNode[] {
  
  const safeWidth = Math.max(1, Math.floor(width));

  
  const lineObjects = transformLinesToObjects(lines);

  
  const processedLines = processAdjacentLines(lineObjects);

  
  const ls = numberDiffLines(processedLines, startingLineNumber);

  
  const maxLineNumber = Math.max(...ls.map(({
    i
  }) => i), 0);
  const maxWidth = Math.max(maxLineNumber.toString().length + 1, 0);

  
  return ls.flatMap((item): React.ReactNode[] => {
    const {
      type,
      code,
      i,
      wordDiff,
      matchedLine
    } = item;

    
    if (wordDiff && matchedLine) {
      const wordDiffElements = generateWordDiffElements(item, safeWidth, maxWidth, dim, overrideTheme);

      
      
      if (wordDiffElements !== null) {
        return wordDiffElements;
      }
    }

    
    
    const diffPrefixWidth = 2; 
    const availableContentWidth = Math.max(1, safeWidth - maxWidth - 1 - diffPrefixWidth); 
    const wrappedText = wrapText(code, availableContentWidth, 'wrap');
    const wrappedLines = wrappedText.split('\n');
    return wrappedLines.map((line, lineIndex) => {
      const key = `${type}-${i}-${lineIndex}`;
      const lineNum = lineIndex === 0 ? i : undefined;
      const lineNumStr = (lineNum !== undefined ? lineNum.toString().padStart(maxWidth) : ' '.repeat(maxWidth)) + ' ';
      const sigil = type === 'add' ? '+' : type === 'remove' ? '-' : ' ';
      
      const contentWidth = lineNumStr.length + 1 + stringWidth(line); 
      const padding = Math.max(0, safeWidth - contentWidth);
      const bgColor = type === 'add' ? dim ? 'diffAddedDimmed' : 'diffAdded' : type === 'remove' ? dim ? 'diffRemovedDimmed' : 'diffRemoved' : undefined;

      
      
      
      return <Box key={key} flexDirection="row">
          <NoSelect fromLeftEdge>
            <Text color={overrideTheme ? 'text' : undefined} backgroundColor={bgColor} dimColor={dim || type === 'nochange'}>
              {lineNumStr}
              {sigil}
            </Text>
          </NoSelect>
          <Text color={overrideTheme ? 'text' : undefined} backgroundColor={bgColor} dimColor={dim}>
            {line}
            {' '.repeat(padding)}
          </Text>
        </Box>;
    });
  });
}
export function numberDiffLines(diff: LineObject[], startLine: number): DiffLine[] {
  let i = startLine;
  const result: DiffLine[] = [];
  const queue = [...diff];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const {
      code,
      type,
      originalCode,
      wordDiff,
      matchedLine
    } = current;
    const line = {
      code,
      type,
      i,
      originalCode,
      wordDiff,
      matchedLine
    };

    
    switch (type) {
      case 'nochange':
        i++;
        result.push(line);
        break;
      case 'add':
        i++;
        result.push(line);
        break;
      case 'remove':
        {
          result.push(line);
          let numRemoved = 0;
          while (queue[0]?.type === 'remove') {
            i++;
            const current = queue.shift()!;
            const {
              code,
              type,
              originalCode,
              wordDiff,
              matchedLine
            } = current;
            const line = {
              code,
              type,
              i,
              originalCode,
              wordDiff,
              matchedLine
            };
            result.push(line);
            numRemoved++;
          }
          i -= numRemoved;
          break;
        }
    }
  }
  return result;
}
