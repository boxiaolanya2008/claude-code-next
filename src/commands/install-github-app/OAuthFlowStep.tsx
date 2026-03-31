import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { Spinner } from '../../components/Spinner.js';
import TextInput from '../../components/TextInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { setClipboard } from '../../ink/termio/osc.js';
import { Box, Link, Text } from '../../ink.js';
import { OAuthService } from '../../services/oauth/index.js';
import { saveOAuthTokensIfNeeded } from '../../utils/auth.js';
import { logError } from '../../utils/log.js';
interface OAuthFlowStepProps {
  onSuccess: (token: string) => void;
  onCancel: () => void;
}
type OAuthStatus = {
  state: 'starting';
} | {
  state: 'waiting_for_login';
  url: string;
} | {
  state: 'processing';
} | {
  state: 'success';
  token: string;
} | {
  state: 'error';
  message: string;
  toRetry?: OAuthStatus;
} | {
  state: 'about_to_retry';
  nextState: OAuthStatus;
};
const PASTE_HERE_MSG = 'Paste code here if prompted > ';
export function OAuthFlowStep({
  onSuccess,
  onCancel
}: OAuthFlowStepProps): React.ReactNode {
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>({
    state: 'starting'
  });
  const [oauthService] = useState(() => new OAuthService());
  const [pastedCode, setPastedCode] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [showPastePrompt, setShowPastePrompt] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const timersRef = useRef<Set<NodeJS.Timeout>>(new Set());
  
  const urlCopiedTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const terminalSize = useTerminalSize();
  const textInputColumns = Math.max(50, terminalSize.columns - PASTE_HERE_MSG.length - 4);
  function handleKeyDown(e: KeyboardEvent): void {
    if (oauthStatus.state !== 'error') return;
    e.preventDefault();
    if (e.key === 'return' && oauthStatus.toRetry) {
      setPastedCode('');
      setCursorOffset(0);
      setOAuthStatus({
        state: 'about_to_retry',
        nextState: oauthStatus.toRetry
      });
    } else {
      onCancel();
    }
  }
  async function handleSubmitCode(value: string, url: string) {
    try {
      
      const [authorizationCode, state] = value.split('#');
      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied',
          toRetry: {
            state: 'waiting_for_login',
            url
          }
        });
        return;
      }

      
      logEvent('tengu_oauth_manual_entry', {});
      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state
      });
    } catch (err: unknown) {
      logError(err);
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: {
          state: 'waiting_for_login',
          url
        }
      });
    }
  }
  const startOAuth = useCallback(async () => {
    
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
    try {
      const result = await oauthService.startOAuthFlow(async url_0 => {
        setOAuthStatus({
          state: 'waiting_for_login',
          url: url_0
        });
        const timer_0 = setTimeout(setShowPastePrompt, 3000, true);
        timersRef.current.add(timer_0);
      }, {
        loginWithClaudeAi: true,
        
        inferenceOnly: true,
        expiresIn: 365 * 24 * 60 * 60 
      });

      
      setOAuthStatus({
        state: 'processing'
      });

      
      
      
      saveOAuthTokensIfNeeded(result);

      
      const timer1 = setTimeout((setOAuthStatus_0, accessToken, onSuccess_0, timersRef_0) => {
        setOAuthStatus_0({
          state: 'success',
          token: accessToken
        });
        
        const timer2 = setTimeout(onSuccess_0, 1000, accessToken);
        timersRef_0.current.add(timer2);
      }, 100, setOAuthStatus, result.accessToken, onSuccess, timersRef);
      timersRef.current.add(timer1);
    } catch (err_0) {
      const errorMessage = (err_0 as Error).message;
      setOAuthStatus({
        state: 'error',
        message: errorMessage,
        toRetry: {
          state: 'starting'
        } 
      });
      logError(err_0);
      logEvent('tengu_oauth_error', {
        error: errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }, [oauthService, onSuccess]);
  useEffect(() => {
    if (oauthStatus.state === 'starting') {
      void startOAuth();
    }
  }, [oauthStatus.state, startOAuth]);

  
  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer_1 = setTimeout((nextState, setShowPastePrompt_0, setOAuthStatus_1) => {
        
        setShowPastePrompt_0(nextState.state === 'waiting_for_login');
        setOAuthStatus_1(nextState);
      }, 500, oauthStatus.nextState, setShowPastePrompt, setOAuthStatus);
      timersRef.current.add(timer_1);
    }
  }, [oauthStatus]);
  useEffect(() => {
    if (pastedCode === 'c' && oauthStatus.state === 'waiting_for_login' && showPastePrompt && !urlCopied) {
      void setClipboard(oauthStatus.url).then(raw => {
        if (raw) process.stdout.write(raw);
        setUrlCopied(true);
        clearTimeout(urlCopiedTimerRef.current);
        urlCopiedTimerRef.current = setTimeout(setUrlCopied, 2000, false);
      });
      setPastedCode('');
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied]);

  
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      oauthService.cleanup();
      
      timers.forEach(timer_2 => clearTimeout(timer_2));
      timers.clear();
      clearTimeout(urlCopiedTimerRef.current);
    };
  }, [oauthService]);

  
  function renderStatusMessage(): React.ReactNode {
    switch (oauthStatus.state) {
      case 'starting':
        return <Box>
            <Spinner />
            <Text>Starting authentication…</Text>
          </Box>;
      case 'waiting_for_login':
        return <Box flexDirection="column" gap={1}>
            {!showPastePrompt && <Box>
                <Spinner />
                <Text>
                  Opening browser to sign in with your Claude account…
                </Text>
              </Box>}

            {showPastePrompt && <Box>
                <Text>{PASTE_HERE_MSG}</Text>
                <TextInput value={pastedCode} onChange={setPastedCode} onSubmit={(value_0: string) => handleSubmitCode(value_0, oauthStatus.url)} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} columns={textInputColumns} />
              </Box>}
          </Box>;
      case 'processing':
        return <Box>
            <Spinner />
            <Text>Processing authentication…</Text>
          </Box>;
      case 'success':
        return <Box flexDirection="column" gap={1}>
            <Text color="success">
              ✓ Authentication token created successfully!
            </Text>
            <Text dimColor>Using token for GitHub Actions setup…</Text>
          </Box>;
      case 'error':
        return <Box flexDirection="column" gap={1}>
            <Text color="error">OAuth error: {oauthStatus.message}</Text>
            {oauthStatus.toRetry ? <Text dimColor>
                Press Enter to try again, or any other key to cancel
              </Text> : <Text dimColor>Press any key to return to API key selection</Text>}
          </Box>;
      case 'about_to_retry':
        return <Box flexDirection="column" gap={1}>
            <Text color="permission">Retrying…</Text>
          </Box>;
      default:
        return null;
    }
  }
  return <Box flexDirection="column" gap={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      {}
      {oauthStatus.state === 'starting' && <Box flexDirection="column" gap={1} paddingBottom={1}>
          <Text bold>Create Authentication Token</Text>
          <Text dimColor>Creating a long-lived token for GitHub Actions</Text>
        </Box>}
      {}
      {oauthStatus.state !== 'success' && oauthStatus.state !== 'starting' && oauthStatus.state !== 'processing' && <Box key="header" flexDirection="column" gap={1} paddingBottom={1}>
            <Text bold>Create Authentication Token</Text>
            <Text dimColor>Creating a long-lived token for GitHub Actions</Text>
          </Box>}
      {}
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt && <Box flexDirection="column" key="urlToCopy" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor>
              Browser didn&apos;t open? Use the url below to sign in{' '}
            </Text>
            {urlCopied ? <Text color="success">(Copied!)</Text> : <Text dimColor>
                <KeyboardShortcutHint shortcut="c" action="copy" parens />
              </Text>}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor>{oauthStatus.url}</Text>
          </Link>
        </Box>}
      <Box paddingLeft={1} flexDirection="column" gap={1}>
        {renderStatusMessage()}
      </Box>
    </Box>;
}
