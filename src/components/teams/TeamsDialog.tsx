import { c as _c } from "react/compiler-runtime";
import { randomUUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInterval } from 'usehooks-ts';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { stringWidth } from '../../ink/stringWidth.js';

import { Box, Text, useInput } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { type AppState, useAppState, useSetAppState } from '../../state/AppState.js';
import { getEmptyToolPermissionContext } from '../../Tool.js';
import { AGENT_COLOR_TO_THEME_COLOR } from '../../tools/AgentTool/agentColorManager.js';
import { logForDebugging } from '../../utils/debug.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import { truncateToWidth } from '../../utils/format.js';
import { getNextPermissionMode } from '../../utils/permissions/getNextPermissionMode.js';
import { getModeColor, type PermissionMode, permissionModeFromString, permissionModeSymbol } from '../../utils/permissions/PermissionMode.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import { IT2_COMMAND, isInsideTmuxSync } from '../../utils/swarm/backends/detection.js';
import { ensureBackendsRegistered, getBackendByType, getCachedBackend } from '../../utils/swarm/backends/registry.js';
import type { PaneBackendType } from '../../utils/swarm/backends/types.js';
import { getSwarmSocketName, TMUX_COMMAND } from '../../utils/swarm/constants.js';
import { addHiddenPaneId, removeHiddenPaneId, removeMemberFromTeam, setMemberMode, setMultipleMemberModes } from '../../utils/swarm/teamHelpers.js';
import { listTasks, type Task, unassignTeammateTasks } from '../../utils/tasks.js';
import { getTeammateStatuses, type TeammateStatus, type TeamSummary } from '../../utils/teamDiscovery.js';
import { createModeSetRequestMessage, sendShutdownRequestToMailbox, writeToMailbox } from '../../utils/teammateMailbox.js';
import { Dialog } from '../design-system/Dialog.js';
import ThemedText from '../design-system/ThemedText.js';
type Props = {
  initialTeams?: TeamSummary[];
  onDone: () => void;
};
type DialogLevel = {
  type: 'teammateList';
  teamName: string;
} | {
  type: 'teammateDetail';
  teamName: string;
  memberName: string;
};

export function TeamsDialog({
  initialTeams,
  onDone
}: Props): React.ReactNode {
  
  useRegisterOverlay('teams-dialog');

  
  const setAppState = useSetAppState();

  
  const firstTeamName = initialTeams?.[0]?.name ?? '';
  const [dialogLevel, setDialogLevel] = useState<DialogLevel>({
    type: 'teammateList',
    teamName: firstTeamName
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  
  

  const teammateStatuses = useMemo(() => {
    return getTeammateStatuses(dialogLevel.teamName);
    
    
  }, [dialogLevel.teamName, refreshKey]);

  
  useInterval(() => {
    setRefreshKey(k => k + 1);
  }, 1000);
  const currentTeammate = useMemo(() => {
    if (dialogLevel.type !== 'teammateDetail') return null;
    return teammateStatuses.find(t => t.name === dialogLevel.memberName) ?? null;
  }, [dialogLevel, teammateStatuses]);

  
  const isBypassAvailable = useAppState(s => s.toolPermissionContext.isBypassPermissionsModeAvailable);
  const goBackToList = (): void => {
    setDialogLevel({
      type: 'teammateList',
      teamName: dialogLevel.teamName
    });
    setSelectedIndex(0);
  };

  
  const handleCycleMode = useCallback(() => {
    if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
      
      cycleTeammateMode(currentTeammate, dialogLevel.teamName, isBypassAvailable);
      setRefreshKey(k => k + 1);
    } else if (dialogLevel.type === 'teammateList' && teammateStatuses.length > 0) {
      
      cycleAllTeammateModes(teammateStatuses, dialogLevel.teamName, isBypassAvailable);
      setRefreshKey(k => k + 1);
    }
  }, [dialogLevel, currentTeammate, teammateStatuses, isBypassAvailable]);

  
  useKeybindings({
    'confirm:cycleMode': handleCycleMode
  }, {
    context: 'Confirmation'
  });
  useInput((input, key) => {
    
    if (key.leftArrow) {
      if (dialogLevel.type === 'teammateDetail') {
        goBackToList();
      }
      return;
    }

    
    if (key.upArrow || key.downArrow) {
      const maxIndex = getMaxIndex();
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else {
        setSelectedIndex(prev => Math.min(maxIndex, prev + 1));
      }
      return;
    }

    
    if (key.return) {
      if (dialogLevel.type === 'teammateList' && teammateStatuses[selectedIndex]) {
        setDialogLevel({
          type: 'teammateDetail',
          teamName: dialogLevel.teamName,
          memberName: teammateStatuses[selectedIndex].name
        });
      } else if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
        
        void viewTeammateOutput(currentTeammate.tmuxPaneId, currentTeammate.backendType);
        onDone();
      }
      return;
    }

    
    if (input === 'k') {
      if (dialogLevel.type === 'teammateList' && teammateStatuses[selectedIndex]) {
        void killTeammate(teammateStatuses[selectedIndex].tmuxPaneId, teammateStatuses[selectedIndex].backendType, dialogLevel.teamName, teammateStatuses[selectedIndex].agentId, teammateStatuses[selectedIndex].name, setAppState).then(() => {
          setRefreshKey(k => k + 1);
          
          setSelectedIndex(prev => Math.max(0, Math.min(prev, teammateStatuses.length - 2)));
        });
      } else if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
        void killTeammate(currentTeammate.tmuxPaneId, currentTeammate.backendType, dialogLevel.teamName, currentTeammate.agentId, currentTeammate.name, setAppState);
        goBackToList();
      }
      return;
    }

    
    if (input === 's') {
      if (dialogLevel.type === 'teammateList' && teammateStatuses[selectedIndex]) {
        const teammate = teammateStatuses[selectedIndex];
        void sendShutdownRequestToMailbox(teammate.name, dialogLevel.teamName, 'Graceful shutdown requested by team lead');
      } else if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
        void sendShutdownRequestToMailbox(currentTeammate.name, dialogLevel.teamName, 'Graceful shutdown requested by team lead');
        goBackToList();
      }
      return;
    }

    
    if (input === 'h') {
      const backend = getCachedBackend();
      const teammate = dialogLevel.type === 'teammateList' ? teammateStatuses[selectedIndex] : dialogLevel.type === 'teammateDetail' ? currentTeammate : null;
      if (teammate && backend?.supportsHideShow) {
        void toggleTeammateVisibility(teammate, dialogLevel.teamName).then(() => {
          
          setRefreshKey(k => k + 1);
        });
        if (dialogLevel.type === 'teammateDetail') {
          goBackToList();
        }
      }
      return;
    }

    
    if (input === 'H' && dialogLevel.type === 'teammateList') {
      const backend = getCachedBackend();
      if (backend?.supportsHideShow && teammateStatuses.length > 0) {
        
        const anyVisible = teammateStatuses.some(t => !t.isHidden);
        void Promise.all(teammateStatuses.map(t => anyVisible ? hideTeammate(t, dialogLevel.teamName) : showTeammate(t, dialogLevel.teamName))).then(() => {
          
          setRefreshKey(k => k + 1);
        });
      }
      return;
    }

    
    if (input === 'p' && dialogLevel.type === 'teammateList') {
      const idleTeammates = teammateStatuses.filter(t => t.status === 'idle');
      if (idleTeammates.length > 0) {
        void Promise.all(idleTeammates.map(t => killTeammate(t.tmuxPaneId, t.backendType, dialogLevel.teamName, t.agentId, t.name, setAppState))).then(() => {
          setRefreshKey(k => k + 1);
          setSelectedIndex(prev => Math.max(0, Math.min(prev, teammateStatuses.length - idleTeammates.length - 1)));
        });
      }
      return;
    }

    
  });
  function getMaxIndex(): number {
    if (dialogLevel.type === 'teammateList') {
      return Math.max(0, teammateStatuses.length - 1);
    }
    return 0;
  }

  
  if (dialogLevel.type === 'teammateList') {
    return <TeamDetailView teamName={dialogLevel.teamName} teammates={teammateStatuses} selectedIndex={selectedIndex} onCancel={onDone} />;
  }
  if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
    return <TeammateDetailView teammate={currentTeammate} teamName={dialogLevel.teamName} onCancel={goBackToList} />;
  }
  return null;
}
type TeamDetailViewProps = {
  teamName: string;
  teammates: TeammateStatus[];
  selectedIndex: number;
  onCancel: () => void;
};
function TeamDetailView(t0) {
  const $ = _c(13);
  const {
    teamName,
    teammates,
    selectedIndex,
    onCancel
  } = t0;
  const subtitle = `${teammates.length} ${teammates.length === 1 ? "teammate" : "teammates"}`;
  const supportsHideShow = getCachedBackend()?.supportsHideShow ?? false;
  const cycleModeShortcut = useShortcutDisplay("confirm:cycleMode", "Confirmation", "shift+tab");
  const t1 = `Team ${teamName}`;
  let t2;
  if ($[0] !== selectedIndex || $[1] !== teammates) {
    t2 = teammates.length === 0 ? <Text dimColor={true}>No teammates</Text> : <Box flexDirection="column">{teammates.map((teammate, index) => <TeammateListItem key={teammate.agentId} teammate={teammate} isSelected={index === selectedIndex} />)}</Box>;
    $[0] = selectedIndex;
    $[1] = teammates;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== onCancel || $[4] !== subtitle || $[5] !== t1 || $[6] !== t2) {
    t3 = <Dialog title={t1} subtitle={subtitle} onCancel={onCancel} color="background" hideInputGuide={true}>{t2}</Dialog>;
    $[3] = onCancel;
    $[4] = subtitle;
    $[5] = t1;
    $[6] = t2;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  let t4;
  if ($[8] !== cycleModeShortcut) {
    t4 = <Box marginLeft={1}><Text dimColor={true}>{figures.arrowUp}/{figures.arrowDown} select · Enter view · k kill · s shutdown · p prune idle{supportsHideShow && " \xB7 h hide/show \xB7 H hide/show all"}{" \xB7 "}{cycleModeShortcut} sync cycle modes for all · Esc close</Text></Box>;
    $[8] = cycleModeShortcut;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] !== t3 || $[11] !== t4) {
    t5 = <>{t3}{t4}</>;
    $[10] = t3;
    $[11] = t4;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  return t5;
}
type TeammateListItemProps = {
  teammate: TeammateStatus;
  isSelected: boolean;
};
function TeammateListItem(t0) {
  const $ = _c(21);
  const {
    teammate,
    isSelected
  } = t0;
  const isIdle = teammate.status === "idle";
  const shouldDim = isIdle && !isSelected;
  let modeSymbol;
  let t1;
  if ($[0] !== teammate.mode) {
    const mode = teammate.mode ? permissionModeFromString(teammate.mode) : "default";
    modeSymbol = permissionModeSymbol(mode);
    t1 = getModeColor(mode);
    $[0] = teammate.mode;
    $[1] = modeSymbol;
    $[2] = t1;
  } else {
    modeSymbol = $[1];
    t1 = $[2];
  }
  const modeColor = t1;
  const t2 = isSelected ? "suggestion" : undefined;
  const t3 = isSelected ? figures.pointer + " " : "  ";
  let t4;
  if ($[3] !== teammate.isHidden) {
    t4 = teammate.isHidden && <Text dimColor={true}>[hidden] </Text>;
    $[3] = teammate.isHidden;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] !== isIdle) {
    t5 = isIdle && <Text dimColor={true}>[idle] </Text>;
    $[5] = isIdle;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] !== modeColor || $[8] !== modeSymbol) {
    t6 = modeSymbol && <Text color={modeColor}>{modeSymbol} </Text>;
    $[7] = modeColor;
    $[8] = modeSymbol;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] !== teammate.model) {
    t7 = teammate.model && <Text dimColor={true}> ({teammate.model})</Text>;
    $[10] = teammate.model;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  let t8;
  if ($[12] !== shouldDim || $[13] !== t2 || $[14] !== t3 || $[15] !== t4 || $[16] !== t5 || $[17] !== t6 || $[18] !== t7 || $[19] !== teammate.name) {
    t8 = <Text color={t2} dimColor={shouldDim}>{t3}{t4}{t5}{t6}@{teammate.name}{t7}</Text>;
    $[12] = shouldDim;
    $[13] = t2;
    $[14] = t3;
    $[15] = t4;
    $[16] = t5;
    $[17] = t6;
    $[18] = t7;
    $[19] = teammate.name;
    $[20] = t8;
  } else {
    t8 = $[20];
  }
  return t8;
}
type TeammateDetailViewProps = {
  teammate: TeammateStatus;
  teamName: string;
  onCancel: () => void;
};
function TeammateDetailView(t0) {
  const $ = _c(39);
  const {
    teammate,
    teamName,
    onCancel
  } = t0;
  const [promptExpanded, setPromptExpanded] = useState(false);
  const cycleModeShortcut = useShortcutDisplay("confirm:cycleMode", "Confirmation", "shift+tab");
  const themeColor = teammate.color ? AGENT_COLOR_TO_THEME_COLOR[teammate.color as keyof typeof AGENT_COLOR_TO_THEME_COLOR] : undefined;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const [teammateTasks, setTeammateTasks] = useState(t1);
  let t2;
  let t3;
  if ($[1] !== teamName || $[2] !== teammate.agentId || $[3] !== teammate.name) {
    t2 = () => {
      let cancelled = false;
      listTasks(teamName).then(allTasks => {
        if (cancelled) {
          return;
        }
        setTeammateTasks(allTasks.filter(task => task.owner === teammate.agentId || task.owner === teammate.name));
      });
      return () => {
        cancelled = true;
      };
    };
    t3 = [teamName, teammate.agentId, teammate.name];
    $[1] = teamName;
    $[2] = teammate.agentId;
    $[3] = teammate.name;
    $[4] = t2;
    $[5] = t3;
  } else {
    t2 = $[4];
    t3 = $[5];
  }
  useEffect(t2, t3);
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = input => {
      if (input === "p") {
        setPromptExpanded(_temp);
      }
    };
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  useInput(t4);
  const workingPath = teammate.worktreePath || teammate.cwd;
  let subtitleParts;
  if ($[7] !== teammate.model || $[8] !== teammate.worktreePath || $[9] !== workingPath) {
    subtitleParts = [];
    if (teammate.model) {
      subtitleParts.push(teammate.model);
    }
    if (workingPath) {
      subtitleParts.push(teammate.worktreePath ? `worktree: ${workingPath}` : workingPath);
    }
    $[7] = teammate.model;
    $[8] = teammate.worktreePath;
    $[9] = workingPath;
    $[10] = subtitleParts;
  } else {
    subtitleParts = $[10];
  }
  const subtitle = subtitleParts.join(" \xB7 ") || undefined;
  let modeSymbol;
  let t5;
  if ($[11] !== teammate.mode) {
    const mode = teammate.mode ? permissionModeFromString(teammate.mode) : "default";
    modeSymbol = permissionModeSymbol(mode);
    t5 = getModeColor(mode);
    $[11] = teammate.mode;
    $[12] = modeSymbol;
    $[13] = t5;
  } else {
    modeSymbol = $[12];
    t5 = $[13];
  }
  const modeColor = t5;
  let t6;
  if ($[14] !== modeColor || $[15] !== modeSymbol) {
    t6 = modeSymbol && <Text color={modeColor}>{modeSymbol} </Text>;
    $[14] = modeColor;
    $[15] = modeSymbol;
    $[16] = t6;
  } else {
    t6 = $[16];
  }
  let t7;
  if ($[17] !== teammate.name || $[18] !== themeColor) {
    t7 = themeColor ? <ThemedText color={themeColor}>{`@${teammate.name}`}</ThemedText> : `@${teammate.name}`;
    $[17] = teammate.name;
    $[18] = themeColor;
    $[19] = t7;
  } else {
    t7 = $[19];
  }
  let t8;
  if ($[20] !== t6 || $[21] !== t7) {
    t8 = <>{t6}{t7}</>;
    $[20] = t6;
    $[21] = t7;
    $[22] = t8;
  } else {
    t8 = $[22];
  }
  const title = t8;
  let t9;
  if ($[23] !== teammateTasks) {
    t9 = teammateTasks.length > 0 && <Box flexDirection="column"><Text bold={true}>Tasks</Text>{teammateTasks.map(_temp2)}</Box>;
    $[23] = teammateTasks;
    $[24] = t9;
  } else {
    t9 = $[24];
  }
  let t10;
  if ($[25] !== promptExpanded || $[26] !== teammate.prompt) {
    t10 = teammate.prompt && <Box flexDirection="column"><Text bold={true}>Prompt</Text><Text>{promptExpanded ? teammate.prompt : truncateToWidth(teammate.prompt, 80)}{stringWidth(teammate.prompt) > 80 && !promptExpanded && <Text dimColor={true}> (p to expand)</Text>}</Text></Box>;
    $[25] = promptExpanded;
    $[26] = teammate.prompt;
    $[27] = t10;
  } else {
    t10 = $[27];
  }
  let t11;
  if ($[28] !== onCancel || $[29] !== subtitle || $[30] !== t10 || $[31] !== t9 || $[32] !== title) {
    t11 = <Dialog title={title} subtitle={subtitle} onCancel={onCancel} color="background" hideInputGuide={true}>{t9}{t10}</Dialog>;
    $[28] = onCancel;
    $[29] = subtitle;
    $[30] = t10;
    $[31] = t9;
    $[32] = title;
    $[33] = t11;
  } else {
    t11 = $[33];
  }
  let t12;
  if ($[34] !== cycleModeShortcut) {
    t12 = <Box marginLeft={1}><Text dimColor={true}>{figures.arrowLeft} back · Esc close · k kill · s shutdown{getCachedBackend()?.supportsHideShow && " \xB7 h hide/show"}{" \xB7 "}{cycleModeShortcut} cycle mode</Text></Box>;
    $[34] = cycleModeShortcut;
    $[35] = t12;
  } else {
    t12 = $[35];
  }
  let t13;
  if ($[36] !== t11 || $[37] !== t12) {
    t13 = <>{t11}{t12}</>;
    $[36] = t11;
    $[37] = t12;
    $[38] = t13;
  } else {
    t13 = $[38];
  }
  return t13;
}
function _temp2(task_0) {
  return <Text key={task_0.id} color={task_0.status === "completed" ? "success" : undefined}>{task_0.status === "completed" ? figures.tick : "\u25FC"}{" "}{task_0.subject}</Text>;
}
function _temp(prev) {
  return !prev;
}
async function killTeammate(paneId: string, backendType: PaneBackendType | undefined, teamName: string, teammateId: string, teammateName: string, setAppState: (f: (prev: AppState) => AppState) => void): Promise<void> {
  
  
  
  if (backendType) {
    try {
      
      
      
      await ensureBackendsRegistered();
      await getBackendByType(backendType).killPane(paneId, !isInsideTmuxSync());
    } catch (error) {
      logForDebugging(`[TeamsDialog] Failed to kill pane ${paneId}: ${error}`);
    }
  } else {
    
    
    
    logForDebugging(`[TeamsDialog] Skipping pane kill for ${paneId}: no backendType recorded`);
  }
  
  removeMemberFromTeam(teamName, paneId);

  
  const {
    notificationMessage
  } = await unassignTeammateTasks(teamName, teammateId, teammateName, 'terminated');

  
  setAppState(prev => {
    if (!prev.teamContext?.teammates) return prev;
    if (!(teammateId in prev.teamContext.teammates)) return prev;
    const {
      [teammateId]: _,
      ...remainingTeammates
    } = prev.teamContext.teammates;
    return {
      ...prev,
      teamContext: {
        ...prev.teamContext,
        teammates: remainingTeammates
      },
      inbox: {
        messages: [...prev.inbox.messages, {
          id: randomUUID(),
          from: 'system',
          text: jsonStringify({
            type: 'teammate_terminated',
            message: notificationMessage
          }),
          timestamp: new Date().toISOString(),
          status: 'pending' as const
        }]
      }
    };
  });
  logForDebugging(`[TeamsDialog] Removed ${teammateId} from teamContext`);
}
async function viewTeammateOutput(paneId: string, backendType: PaneBackendType | undefined): Promise<void> {
  if (backendType === 'iterm2') {
    
    await execFileNoThrow(IT2_COMMAND, ['session', 'focus', '-s', paneId]);
  } else {
    
    
    
    const args = isInsideTmuxSync() ? ['select-pane', '-t', paneId] : ['-L', getSwarmSocketName(), 'select-pane', '-t', paneId];
    await execFileNoThrow(TMUX_COMMAND, args);
  }
}

async function toggleTeammateVisibility(teammate: TeammateStatus, teamName: string): Promise<void> {
  if (teammate.isHidden) {
    await showTeammate(teammate, teamName);
  } else {
    await hideTeammate(teammate, teamName);
  }
}

async function hideTeammate(teammate: TeammateStatus, teamName: string): Promise<void> {}

async function showTeammate(teammate: TeammateStatus, teamName: string): Promise<void> {}

function sendModeChangeToTeammate(teammateName: string, teamName: string, targetMode: PermissionMode): void {
  
  setMemberMode(teamName, teammateName, targetMode);

  
  const message = createModeSetRequestMessage({
    mode: targetMode,
    from: 'team-lead'
  });
  void writeToMailbox(teammateName, {
    from: 'team-lead',
    text: jsonStringify(message),
    timestamp: new Date().toISOString()
  }, teamName);
  logForDebugging(`[TeamsDialog] Sent mode change to ${teammateName}: ${targetMode}`);
}

function cycleTeammateMode(teammate: TeammateStatus, teamName: string, isBypassAvailable: boolean): void {
  const currentMode = teammate.mode ? permissionModeFromString(teammate.mode) : 'default';
  const context = {
    ...getEmptyToolPermissionContext(),
    mode: currentMode,
    isBypassPermissionsModeAvailable: isBypassAvailable
  };
  const nextMode = getNextPermissionMode(context);
  sendModeChangeToTeammate(teammate.name, teamName, nextMode);
}

function cycleAllTeammateModes(teammates: TeammateStatus[], teamName: string, isBypassAvailable: boolean): void {
  if (teammates.length === 0) return;
  const modes = teammates.map(t => t.mode ? permissionModeFromString(t.mode) : 'default');
  const allSame = modes.every(m => m === modes[0]);

  
  const targetMode = !allSame ? 'default' : getNextPermissionMode({
    ...getEmptyToolPermissionContext(),
    mode: modes[0] ?? 'default',
    isBypassPermissionsModeAvailable: isBypassAvailable
  });

  
  const modeUpdates = teammates.map(t => ({
    memberName: t.name,
    mode: targetMode
  }));
  setMultipleMemberModes(teamName, modeUpdates);

  
  for (const teammate of teammates) {
    const message = createModeSetRequestMessage({
      mode: targetMode,
      from: 'team-lead'
    });
    void writeToMailbox(teammate.name, {
      from: 'team-lead',
      text: jsonStringify(message),
      timestamp: new Date().toISOString()
    }, teamName);
  }
  logForDebugging(`[TeamsDialog] Sent mode change to all ${teammates.length} teammates: ${targetMode}`);
}
