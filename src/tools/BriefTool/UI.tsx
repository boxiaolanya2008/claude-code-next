import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React from 'react';
import { Markdown } from '../../components/Markdown.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text } from '../../ink.js';
import type { ProgressMessage } from '../../types/message.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatFileSize } from '../../utils/format.js';
import { formatBriefTimestamp } from '../../utils/formatBriefTimestamp.js';
import type { Output } from './BriefTool.js';
export function renderToolUseMessage(): React.ReactNode {
  return '';
}
export function renderToolResultMessage(output: Output, _progressMessages: ProgressMessage[], options?: {
  isTranscriptMode?: boolean;
  isBriefOnly?: boolean;
}): React.ReactNode {
  const hasAttachments = (output.attachments?.length ?? 0) > 0;
  if (!output.message && !hasAttachments) {
    return null;
  }

  
  
  if (options?.isTranscriptMode) {
    return <Box flexDirection="row" marginTop={1}>
        <Box minWidth={2}>
          <Text color="text">{BLACK_CIRCLE}</Text>
        </Box>
        <Box flexDirection="column">
          {output.message ? <Markdown>{output.message}</Markdown> : null}
          <AttachmentList attachments={output.attachments} />
        </Box>
      </Box>;
  }

  
  
  
  if (options?.isBriefOnly) {
    const ts = output.sentAt ? formatBriefTimestamp(output.sentAt) : '';
    return <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        <Box flexDirection="row">
          <Text color="briefLabelClaude">Claude</Text>
          {ts ? <Text dimColor> {ts}</Text> : null}
        </Box>
        <Box flexDirection="column">
          {output.message ? <Markdown>{output.message}</Markdown> : null}
          <AttachmentList attachments={output.attachments} />
        </Box>
      </Box>;
  }

  
  
  
  
  
  
  return <Box flexDirection="row" marginTop={1}>
      <Box minWidth={2} />
      <Box flexDirection="column">
        {output.message ? <Markdown>{output.message}</Markdown> : null}
        <AttachmentList attachments={output.attachments} />
      </Box>
    </Box>;
}
type AttachmentListProps = {
  attachments: Output['attachments'];
};
export function AttachmentList(t0) {
  const $ = _c(4);
  const {
    attachments
  } = t0;
  if (!attachments || attachments.length === 0) {
    return null;
  }
  let t1;
  if ($[0] !== attachments) {
    t1 = attachments.map(_temp);
    $[0] = attachments;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== t1) {
    t2 = <Box flexDirection="column" marginTop={1}>{t1}</Box>;
    $[2] = t1;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
function _temp(att) {
  return <Box key={att.path} flexDirection="row"><Text dimColor={true}>{figures.pointerSmall} {att.isImage ? "[image]" : "[file]"}{" "}</Text><Text>{getDisplayPath(att.path)}</Text><Text dimColor={true}> ({formatFileSize(att.size)})</Text></Box>;
}
