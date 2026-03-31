import React from 'react';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import { truncateToWidth } from '../utils/format.js';

const ALL_TAB_LABEL = 'All';
const TAB_PADDING = 2; 
const HASH_PREFIX_LENGTH = 1; 
const LEFT_ARROW_PREFIX = '← ';
const RIGHT_HINT_WITH_COUNT_PREFIX = '→';
const RIGHT_HINT_SUFFIX = ' (tab to cycle)';
const RIGHT_HINT_NO_COUNT = '(tab to cycle)';
const MAX_OVERFLOW_DIGITS = 2; 

const LEFT_ARROW_WIDTH = LEFT_ARROW_PREFIX.length + MAX_OVERFLOW_DIGITS + 1; 
const RIGHT_HINT_WIDTH_WITH_COUNT = RIGHT_HINT_WITH_COUNT_PREFIX.length + MAX_OVERFLOW_DIGITS + RIGHT_HINT_SUFFIX.length; 
const RIGHT_HINT_WIDTH_NO_COUNT = RIGHT_HINT_NO_COUNT.length;
type Props = {
  tabs: string[];
  selectedIndex: number;
  availableWidth: number;
  showAllProjects?: boolean;
};

function getTabWidth(tab: string, maxWidth?: number): number {
  if (tab === ALL_TAB_LABEL) {
    return ALL_TAB_LABEL.length + TAB_PADDING;
  }
  
  const tagWidth = stringWidth(tab);
  const effectiveTagWidth = maxWidth ? Math.min(tagWidth, maxWidth - TAB_PADDING - HASH_PREFIX_LENGTH) : tagWidth;
  return Math.max(0, effectiveTagWidth) + TAB_PADDING + HASH_PREFIX_LENGTH;
}

function truncateTag(tag: string, maxWidth: number): string {
  
  const availableForTag = maxWidth - TAB_PADDING - HASH_PREFIX_LENGTH;
  if (stringWidth(tag) <= availableForTag) {
    return tag;
  }
  if (availableForTag <= 1) {
    return tag.charAt(0);
  }
  return truncateToWidth(tag, availableForTag);
}
export function TagTabs({
  tabs,
  selectedIndex,
  availableWidth,
  showAllProjects = false
}: Props): React.ReactNode {
  const resumeLabel = showAllProjects ? 'Resume (All Projects)' : 'Resume';
  const resumeLabelWidth = resumeLabel.length + 1; 

  
  const rightHintWidth = Math.max(RIGHT_HINT_WIDTH_WITH_COUNT, RIGHT_HINT_WIDTH_NO_COUNT);
  const maxTabsWidth = availableWidth - resumeLabelWidth - rightHintWidth - 2; 

  
  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, tabs.length - 1));

  
  const maxSingleTabWidth = Math.max(20, Math.floor(maxTabsWidth / 2)); 
  const tabWidths = tabs.map(tab => getTabWidth(tab, maxSingleTabWidth));

  
  let startIndex = 0;
  let endIndex = tabs.length;

  
  const totalTabsWidth = tabWidths.reduce((sum, w, i) => sum + w + (i < tabWidths.length - 1 ? 1 : 0), 0); 

  if (totalTabsWidth > maxTabsWidth) {
    
    const effectiveMaxWidth = maxTabsWidth - LEFT_ARROW_WIDTH;

    
    let windowWidth = tabWidths[safeSelectedIndex] ?? 0;
    startIndex = safeSelectedIndex;
    endIndex = safeSelectedIndex + 1;

    
    while (startIndex > 0 || endIndex < tabs.length) {
      const canExpandLeft = startIndex > 0;
      const canExpandRight = endIndex < tabs.length;
      if (canExpandLeft) {
        const leftWidth = (tabWidths[startIndex - 1] ?? 0) + 1; 
        if (windowWidth + leftWidth <= effectiveMaxWidth) {
          startIndex--;
          windowWidth += leftWidth;
          continue;
        }
      }
      if (canExpandRight) {
        const rightWidth = (tabWidths[endIndex] ?? 0) + 1; 
        if (windowWidth + rightWidth <= effectiveMaxWidth) {
          endIndex++;
          windowWidth += rightWidth;
          continue;
        }
      }
      break;
    }
  }
  const hiddenLeft = startIndex;
  const hiddenRight = tabs.length - endIndex;
  const visibleTabs = tabs.slice(startIndex, endIndex);
  const visibleIndices = visibleTabs.map((_, i_0) => startIndex + i_0);
  return <Box flexDirection="row" gap={1}>
      <Text color="suggestion">{resumeLabel}</Text>
      {hiddenLeft > 0 && <Text dimColor>
          {LEFT_ARROW_PREFIX}
          {hiddenLeft}
        </Text>}
      {visibleTabs.map((tab_0, i_1) => {
      const actualIndex = visibleIndices[i_1]!;
      const isSelected = actualIndex === safeSelectedIndex;
      const displayText = tab_0 === ALL_TAB_LABEL ? tab_0 : `#${truncateTag(tab_0, maxSingleTabWidth - TAB_PADDING)}`;
      return <Text key={tab_0} backgroundColor={isSelected ? 'suggestion' : undefined} color={isSelected ? 'inverseText' : undefined} bold={isSelected}>
            {' '}
            {displayText}{' '}
          </Text>;
    })}
      {hiddenRight > 0 ? <Text dimColor>
          {RIGHT_HINT_WITH_COUNT_PREFIX}
          {hiddenRight}
          {RIGHT_HINT_SUFFIX}
        </Text> : <Text dimColor>{RIGHT_HINT_NO_COUNT}</Text>}
    </Box>;
}
