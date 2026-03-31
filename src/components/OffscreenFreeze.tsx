import React, { useContext, useRef } from 'react';
import { useTerminalViewport } from '../ink/hooks/use-terminal-viewport.js';
import { Box } from '../ink.js';
import { InVirtualListContext } from './messageActions.js';
type Props = {
  children: React.ReactNode;
};

export function OffscreenFreeze({
  children
}: Props): React.ReactNode {
  
  
  'use no memo';

  const inVirtualList = useContext(InVirtualListContext);
  const [ref, {
    isVisible
  }] = useTerminalViewport();
  const cached = useRef(children);
  
  
  
  
  if (isVisible || inVirtualList) {
    cached.current = children;
  }
  return <Box ref={ref}>{cached.current}</Box>;
}
