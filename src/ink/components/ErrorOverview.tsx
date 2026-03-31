import codeExcerpt, { type CodeExcerpt } from 'code-excerpt';
import { readFileSync } from 'fs';
import React from 'react';
import StackUtils from 'stack-utils';
import Box from './Box.js';
import Text from './Text.js';

const cleanupPath = (path: string | undefined): string | undefined => {
  return path?.replace(`file://${process.cwd()}/`, '');
};
let stackUtils: StackUtils | undefined;
function getStackUtils(): StackUtils {
  return stackUtils ??= new StackUtils({
    cwd: process.cwd(),
    internals: StackUtils.nodeInternals()
  });
}

type Props = {
  readonly error: Error;
};
export default function ErrorOverview({
  error
}: Props) {
  const stack = error.stack ? error.stack.split('\n').slice(1) : undefined;
  const origin = stack ? getStackUtils().parseLine(stack[0]!) : undefined;
  const filePath = cleanupPath(origin?.file);
  let excerpt: CodeExcerpt[] | undefined;
  let lineWidth = 0;
  if (filePath && origin?.line) {
    try {
      
      const sourceCode = readFileSync(filePath, 'utf8');
      excerpt = codeExcerpt(sourceCode, origin.line);
      if (excerpt) {
        for (const {
          line
        } of excerpt) {
          lineWidth = Math.max(lineWidth, String(line).length);
        }
      }
    } catch {
      
    }
  }
  return <Box flexDirection="column" padding={1}>
      <Box>
        <Text backgroundColor="ansi:red" color="ansi:white">
          {' '}
          ERROR{' '}
        </Text>

        <Text> {error.message}</Text>
      </Box>

      {origin && filePath && <Box marginTop={1}>
          <Text dim>
            {filePath}:{origin.line}:{origin.column}
          </Text>
        </Box>}

      {origin && excerpt && <Box marginTop={1} flexDirection="column">
          {excerpt.map(({
        line: line_0,
        value
      }) => <Box key={line_0}>
              <Box width={lineWidth + 1}>
                <Text dim={line_0 !== origin.line} backgroundColor={line_0 === origin.line ? 'ansi:red' : undefined} color={line_0 === origin.line ? 'ansi:white' : undefined}>
                  {String(line_0).padStart(lineWidth, ' ')}:
                </Text>
              </Box>

              <Text key={line_0} backgroundColor={line_0 === origin.line ? 'ansi:red' : undefined} color={line_0 === origin.line ? 'ansi:white' : undefined}>
                {' ' + value}
              </Text>
            </Box>)}
        </Box>}

      {error.stack && <Box marginTop={1} flexDirection="column">
          {error.stack.split('\n').slice(1).map(line_1 => {
        const parsedLine = getStackUtils().parseLine(line_1);

        
        if (!parsedLine) {
          return <Box key={line_1}>
                    <Text dim>- </Text>
                    <Text bold>{line_1}</Text>
                  </Box>;
        }
        return <Box key={line_1}>
                  <Text dim>- </Text>
                  <Text bold>{parsedLine.function}</Text>
                  <Text dim>
                    {' '}
                    ({cleanupPath(parsedLine.file) ?? ''}:{parsedLine.line}:
                    {parsedLine.column})
                  </Text>
                </Box>;
      })}
        </Box>}
    </Box>;
}
