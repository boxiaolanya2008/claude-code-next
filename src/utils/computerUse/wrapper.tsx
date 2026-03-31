

import { bindSessionContext, type ComputerUseSessionContext, type CuCallToolResult, type CuPermissionRequest, type CuPermissionResponse, DEFAULT_GRANT_FLAGS, type ScreenshotDims } from '@ant/computer-use-mcp';
import * as React from 'react';
import { getSessionId } from '../../bootstrap/state.js';
import { ComputerUseApproval } from '../../components/permissions/ComputerUseApproval/ComputerUseApproval.js';
import type { Tool, ToolUseContext } from '../../Tool.js';
import { logForDebugging } from '../debug.js';
import { checkComputerUseLock, tryAcquireComputerUseLock } from './computerUseLock.js';
import { registerEscHotkey } from './escHotkey.js';
import { getChicagoCoordinateMode } from './gates.js';
import { getComputerUseHostAdapter } from './hostAdapter.js';
import { getComputerUseMCPRenderingOverrides } from './toolRendering.js';
type CallOverride = Pick<Tool, 'call'>['call'];
type Binding = {
  ctx: ComputerUseSessionContext;
  dispatch: (name: string, args: unknown) => Promise<CuCallToolResult>;
};

let binding: Binding | undefined;
let currentToolUseContext: ToolUseContext | undefined;
function tuc(): ToolUseContext {
  
  
  return currentToolUseContext!;
}
function formatLockHeld(holder: string): string {
  return `Computer use is in use by another Claude session (${holder.slice(0, 8)}…). Wait for that session to finish or run /exit there.`;
}
export function buildSessionContext(): ComputerUseSessionContext {
  return {
    
    getAllowedApps: () => tuc().getAppState().computerUseMcpState?.allowedApps ?? [],
    getGrantFlags: () => tuc().getAppState().computerUseMcpState?.grantFlags ?? DEFAULT_GRANT_FLAGS,
    
    getUserDeniedBundleIds: () => [],
    getSelectedDisplayId: () => tuc().getAppState().computerUseMcpState?.selectedDisplayId,
    getDisplayPinnedByModel: () => tuc().getAppState().computerUseMcpState?.displayPinnedByModel ?? false,
    getDisplayResolvedForApps: () => tuc().getAppState().computerUseMcpState?.displayResolvedForApps,
    getLastScreenshotDims: (): ScreenshotDims | undefined => {
      const d = tuc().getAppState().computerUseMcpState?.lastScreenshotDims;
      return d ? {
        ...d,
        displayId: d.displayId ?? 0,
        originX: d.originX ?? 0,
        originY: d.originY ?? 0
      } : undefined;
    },
    
    
    
    
    
    
    onPermissionRequest: (req, _dialogSignal) => runPermissionDialog(req),
    
    onAllowedAppsChanged: (apps, flags) => tuc().setAppState(prev => {
      const cu = prev.computerUseMcpState;
      const prevApps = cu?.allowedApps;
      const prevFlags = cu?.grantFlags;
      const sameApps = prevApps?.length === apps.length && apps.every((a, i) => prevApps[i]?.bundleId === a.bundleId);
      const sameFlags = prevFlags?.clipboardRead === flags.clipboardRead && prevFlags?.clipboardWrite === flags.clipboardWrite && prevFlags?.systemKeyCombos === flags.systemKeyCombos;
      return sameApps && sameFlags ? prev : {
        ...prev,
        computerUseMcpState: {
          ...cu,
          allowedApps: [...apps],
          grantFlags: flags
        }
      };
    }),
    onAppsHidden: ids => {
      if (ids.length === 0) return;
      tuc().setAppState(prev => {
        const cu = prev.computerUseMcpState;
        const existing = cu?.hiddenDuringTurn;
        if (existing && ids.every(id => existing.has(id))) return prev;
        return {
          ...prev,
          computerUseMcpState: {
            ...cu,
            hiddenDuringTurn: new Set([...(existing ?? []), ...ids])
          }
        };
      });
    },
    
    
    
    
    onResolvedDisplayUpdated: id => tuc().setAppState(prev => {
      const cu = prev.computerUseMcpState;
      if (cu?.selectedDisplayId === id && !cu.displayPinnedByModel && cu.displayResolvedForApps === undefined) {
        return prev;
      }
      return {
        ...prev,
        computerUseMcpState: {
          ...cu,
          selectedDisplayId: id,
          displayPinnedByModel: false,
          displayResolvedForApps: undefined
        }
      };
    }),
    
    
    onDisplayPinned: id => tuc().setAppState(prev => {
      const cu = prev.computerUseMcpState;
      const pinned = id !== undefined;
      const nextResolvedFor = pinned ? cu?.displayResolvedForApps : undefined;
      if (cu?.selectedDisplayId === id && cu?.displayPinnedByModel === pinned && cu?.displayResolvedForApps === nextResolvedFor) {
        return prev;
      }
      return {
        ...prev,
        computerUseMcpState: {
          ...cu,
          selectedDisplayId: id,
          displayPinnedByModel: pinned,
          displayResolvedForApps: nextResolvedFor
        }
      };
    }),
    onDisplayResolvedForApps: key => tuc().setAppState(prev => {
      const cu = prev.computerUseMcpState;
      if (cu?.displayResolvedForApps === key) return prev;
      return {
        ...prev,
        computerUseMcpState: {
          ...cu,
          displayResolvedForApps: key
        }
      };
    }),
    onScreenshotCaptured: dims => tuc().setAppState(prev => {
      const cu = prev.computerUseMcpState;
      const p = cu?.lastScreenshotDims;
      return p?.width === dims.width && p?.height === dims.height && p?.displayWidth === dims.displayWidth && p?.displayHeight === dims.displayHeight && p?.displayId === dims.displayId && p?.originX === dims.originX && p?.originY === dims.originY ? prev : {
        ...prev,
        computerUseMcpState: {
          ...cu,
          lastScreenshotDims: dims
        }
      };
    }),
    
    
    
    
    
    checkCuLock: async () => {
      const c = await checkComputerUseLock();
      switch (c.kind) {
        case 'free':
          return {
            holder: undefined,
            isSelf: false
          };
        case 'held_by_self':
          return {
            holder: getSessionId(),
            isSelf: true
          };
        case 'blocked':
          return {
            holder: c.by,
            isSelf: false
          };
      }
    },
    
    
    
    
    
    
    acquireCuLock: async () => {
      const r = await tryAcquireComputerUseLock();
      if (r.kind === 'blocked') {
        throw new Error(formatLockHeld(r.by));
      }
      if (r.fresh) {
        
        
        
        
        const escRegistered = registerEscHotkey(() => {
          logForDebugging('[cu-esc] user escape, aborting turn');
          tuc().abortController.abort();
        });
        tuc().sendOSNotification?.({
          message: escRegistered ? 'Claude is using your computer · press Esc to stop' : 'Claude is using your computer · press Ctrl+C to stop',
          notificationType: 'computer_use_enter'
        });
      }
    },
    formatLockHeldMessage: formatLockHeld
  };
}
function getOrBind(): Binding {
  if (binding) return binding;
  const ctx = buildSessionContext();
  binding = {
    ctx,
    dispatch: bindSessionContext(getComputerUseHostAdapter(), getChicagoCoordinateMode(), ctx)
  };
  return binding;
}

type ComputerUseMCPToolOverrides = ReturnType<typeof getComputerUseMCPRenderingOverrides> & {
  call: CallOverride;
};
export function getComputerUseMCPToolOverrides(toolName: string): ComputerUseMCPToolOverrides {
  const call: CallOverride = async (args, context: ToolUseContext) => {
    currentToolUseContext = context;
    const {
      dispatch
    } = getOrBind();
    const {
      telemetry,
      ...result
    } = await dispatch(toolName, args);
    if (telemetry?.error_kind) {
      logForDebugging(`[Computer Use MCP] ${toolName} error_kind=${telemetry.error_kind}`);
    }

    
    
    
    
    
    
    const data = Array.isArray(result.content) ? result.content.map(item => item.type === 'image' ? {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: item.mimeType ?? 'image/jpeg',
        data: item.data
      }
    } : {
      type: 'text' as const,
      text: item.type === 'text' ? item.text : ''
    }) : result.content;
    return {
      data
    };
  };
  return {
    ...getComputerUseMCPRenderingOverrides(toolName),
    call
  };
}

async function runPermissionDialog(req: CuPermissionRequest): Promise<CuPermissionResponse> {
  const context = tuc();
  const setToolJSX = context.setToolJSX;
  if (!setToolJSX) {
    
    return {
      granted: [],
      denied: [],
      flags: DEFAULT_GRANT_FLAGS
    };
  }
  try {
    return await new Promise<CuPermissionResponse>((resolve, reject) => {
      const signal = context.abortController.signal;
      
      
      if (signal.aborted) {
        reject(new Error('Computer Use permission dialog aborted'));
        return;
      }
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Computer Use permission dialog aborted'));
      };
      signal.addEventListener('abort', onAbort);
      setToolJSX({
        jsx: React.createElement(ComputerUseApproval, {
          request: req,
          onDone: (resp: CuPermissionResponse) => {
            signal.removeEventListener('abort', onAbort);
            resolve(resp);
          }
        }),
        shouldHidePromptInput: true
      });
    });
  } finally {
    setToolJSX(null);
  }
}
