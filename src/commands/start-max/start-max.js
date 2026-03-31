import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getClaudeAIOAuthTokens, saveOAuthTokensIfNeeded } from '../../utils/auth.js';

export async function call(onDone, context) {
  // 设置默认用户为内部用户
  process.env.USER_TYPE = 'ant';
  
  // 自动订阅到max计划
  const tokens = getClaudeAIOAuthTokens();
  if (tokens) {
    // 模拟更新订阅类型为max
    const updatedTokens = {
      ...tokens,
      subscriptionType: 'max'
    };
    saveOAuthTokensIfNeeded(updatedTokens);
  }
  
  // 设置max相关配置
  const setAppState = context.setAppState;
  setAppState(prev => ({
    ...prev,
    mainLoopModel: 'opus',
    effort: 'max',
    fastMode: true
  }));
  
  onDone('已启动max模式，自动订阅到max计划并应用max设置');
  return null;
}
