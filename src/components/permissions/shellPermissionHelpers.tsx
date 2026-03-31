import { basename, sep } from 'path';
import React, { type ReactNode } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { Text } from '../../ink.js';
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js';
import { permissionRuleExtractPrefix } from '../../utils/permissions/shellRuleMatching.js';
function commandListDisplay(commands: string[]): ReactNode {
  switch (commands.length) {
    case 0:
      return '';
    case 1:
      return <Text bold>{commands[0]}</Text>;
    case 2:
      return <Text>
          <Text bold>{commands[0]}</Text> and <Text bold>{commands[1]}</Text>
        </Text>;
    default:
      return <Text>
          <Text bold>{commands.slice(0, -1).join(', ')}</Text>, and{' '}
          <Text bold>{commands.slice(-1)[0]}</Text>
        </Text>;
  }
}
function commandListDisplayTruncated(commands: string[]): ReactNode {
  
  const plainText = commands.join(', ');
  if (plainText.length > 50) {
    return 'similar';
  }
  return commandListDisplay(commands);
}
function formatPathList(paths: string[]): ReactNode {
  if (paths.length === 0) return '';

  
  const names = paths.map(p => basename(p) || p);
  if (names.length === 1) {
    return <Text>
        <Text bold>{names[0]}</Text>
        {sep}
      </Text>;
  }
  if (names.length === 2) {
    return <Text>
        <Text bold>{names[0]}</Text>
        {sep} and <Text bold>{names[1]}</Text>
        {sep}
      </Text>;
  }

  
  return <Text>
      <Text bold>{names[0]}</Text>
      {sep}, <Text bold>{names[1]}</Text>
      {sep} and {paths.length - 2} more
    </Text>;
}

export function generateShellSuggestionsLabel(suggestions: PermissionUpdate[], shellToolName: string, commandTransform?: (command: string) => string): ReactNode | null {
  
  const allRules = suggestions.filter(s => s.type === 'addRules').flatMap(s => s.rules || []);

  
  const readRules = allRules.filter(r => r.toolName === 'Read');
  const shellRules = allRules.filter(r => r.toolName === shellToolName);

  
  const directories = suggestions.filter(s => s.type === 'addDirectories').flatMap(s => s.directories || []);

  
  const readPaths = readRules.map(r => r.ruleContent?.replace('/**', '') || '').filter(p => p);

  
  const shellCommands = [...new Set(shellRules.flatMap(rule => {
    if (!rule.ruleContent) return [];
    const command = permissionRuleExtractPrefix(rule.ruleContent) ?? rule.ruleContent;
    return commandTransform ? commandTransform(command) : command;
  }))];

  
  const hasDirectories = directories.length > 0;
  const hasReadPaths = readPaths.length > 0;
  const hasCommands = shellCommands.length > 0;

  
  if (hasReadPaths && !hasDirectories && !hasCommands) {
    
    if (readPaths.length === 1) {
      const firstPath = readPaths[0]!;
      const dirName = basename(firstPath) || firstPath;
      return <Text>
          Yes, allow reading from <Text bold>{dirName}</Text>
          {sep} from this project
        </Text>;
    }

    
    return <Text>
        Yes, allow reading from {formatPathList(readPaths)} from this project
      </Text>;
  }
  if (hasDirectories && !hasReadPaths && !hasCommands) {
    
    if (directories.length === 1) {
      const firstDir = directories[0]!;
      const dirName = basename(firstDir) || firstDir;
      return <Text>
          Yes, and always allow access to <Text bold>{dirName}</Text>
          {sep} from this project
        </Text>;
    }

    
    return <Text>
        Yes, and always allow access to {formatPathList(directories)} from this
        project
      </Text>;
  }
  if (hasCommands && !hasDirectories && !hasReadPaths) {
    
    return <Text>
        {"Yes, and don't ask again for "}
        {commandListDisplayTruncated(shellCommands)} commands in{' '}
        <Text bold>{getOriginalCwd()}</Text>
      </Text>;
  }

  
  if ((hasDirectories || hasReadPaths) && !hasCommands) {
    
    const allPaths = [...directories, ...readPaths];
    if (hasDirectories && hasReadPaths) {
      
      return <Text>
          Yes, and always allow access to {formatPathList(allPaths)} from this
          project
        </Text>;
    }
  }
  if ((hasDirectories || hasReadPaths) && hasCommands) {
    
    const allPaths = [...directories, ...readPaths];

    
    if (allPaths.length === 1 && shellCommands.length === 1) {
      return <Text>
          Yes, and allow access to {formatPathList(allPaths)} and{' '}
          {commandListDisplayTruncated(shellCommands)} commands
        </Text>;
    }
    return <Text>
        Yes, and allow {formatPathList(allPaths)} access and{' '}
        {commandListDisplayTruncated(shellCommands)} commands
      </Text>;
  }
  return null;
}
