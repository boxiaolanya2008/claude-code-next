import { c as _c } from "react/compiler-runtime";
import { feature } from "../utils/bundle-mock.ts";
import figures from 'figures';
import React, { useEffect, useRef, useState } from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import type { AppState } from '../state/AppStateStore.js';
import { getGlobalConfig } from '../utils/config.js';
import { isFullscreenActive } from '../utils/fullscreen.js';
import type { Theme } from '../utils/theme.js';
import { getCompanion } from './companion.js';
import { renderFace, renderSprite, spriteFrameCount } from './sprites.js';
import { RARITY_COLORS } from './types.js';
const TICK_MS = 500;
const BUBBLE_SHOW = 20; 
const FADE_WINDOW = 6; 
const PET_BURST_MS = 2500; 

const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0];

const H = figures.heart;
const PET_HEARTS = [`   ${H}    ${H}   `, `  ${H}  ${H}   ${H}  `, ` ${H}   ${H}  ${H}   `, `${H}  ${H}      ${H} `, '·    ·   ·  '];
function wrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur.length + w.length + 1 > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function SpeechBubble(t0) {
  const $ = _c(31);
  const {
    text,
    color,
    fading,
    tail
  } = t0;
  let T0;
  let borderColor;
  let t1;
  let t2;
  let t3;
  let t4;
  let t5;
  let t6;
  if ($[0] !== color || $[1] !== fading || $[2] !== text) {
    const lines = wrap(text, 30);
    borderColor = fading ? "inactive" : color;
    T0 = Box;
    t1 = "column";
    t2 = "round";
    t3 = borderColor;
    t4 = 1;
    t5 = 34;
    let t7;
    if ($[11] !== fading) {
      t7 = (l, i) => <Text key={i} italic={true} dimColor={!fading} color={fading ? "inactive" : undefined}>{l}</Text>;
      $[11] = fading;
      $[12] = t7;
    } else {
      t7 = $[12];
    }
    t6 = lines.map(t7);
    $[0] = color;
    $[1] = fading;
    $[2] = text;
    $[3] = T0;
    $[4] = borderColor;
    $[5] = t1;
    $[6] = t2;
    $[7] = t3;
    $[8] = t4;
    $[9] = t5;
    $[10] = t6;
  } else {
    T0 = $[3];
    borderColor = $[4];
    t1 = $[5];
    t2 = $[6];
    t3 = $[7];
    t4 = $[8];
    t5 = $[9];
    t6 = $[10];
  }
  let t7;
  if ($[13] !== T0 || $[14] !== t1 || $[15] !== t2 || $[16] !== t3 || $[17] !== t4 || $[18] !== t5 || $[19] !== t6) {
    t7 = <T0 flexDirection={t1} borderStyle={t2} borderColor={t3} paddingX={t4} width={t5}>{t6}</T0>;
    $[13] = T0;
    $[14] = t1;
    $[15] = t2;
    $[16] = t3;
    $[17] = t4;
    $[18] = t5;
    $[19] = t6;
    $[20] = t7;
  } else {
    t7 = $[20];
  }
  const bubble = t7;
  if (tail === "right") {
    let t8;
    if ($[21] !== borderColor) {
      t8 = <Text color={borderColor}>─</Text>;
      $[21] = borderColor;
      $[22] = t8;
    } else {
      t8 = $[22];
    }
    let t9;
    if ($[23] !== bubble || $[24] !== t8) {
      t9 = <Box flexDirection="row" alignItems="center">{bubble}{t8}</Box>;
      $[23] = bubble;
      $[24] = t8;
      $[25] = t9;
    } else {
      t9 = $[25];
    }
    return t9;
  }
  let t8;
  if ($[26] !== borderColor) {
    t8 = <Box flexDirection="column" alignItems="flex-end" paddingRight={6}><Text color={borderColor}>╲ </Text><Text color={borderColor}>╲</Text></Box>;
    $[26] = borderColor;
    $[27] = t8;
  } else {
    t8 = $[27];
  }
  let t9;
  if ($[28] !== bubble || $[29] !== t8) {
    t9 = <Box flexDirection="column" alignItems="flex-end" marginRight={1}>{bubble}{t8}</Box>;
    $[28] = bubble;
    $[29] = t8;
    $[30] = t9;
  } else {
    t9 = $[30];
  }
  return t9;
}
export const MIN_COLS_FOR_FULL_SPRITE = 100;
const SPRITE_BODY_WIDTH = 12;
const NAME_ROW_PAD = 2; 
const SPRITE_PADDING_X = 2;
const BUBBLE_WIDTH = 36; 
const NARROW_QUIP_CAP = 24;
function spriteColWidth(nameWidth: number): number {
  return Math.max(SPRITE_BODY_WIDTH, nameWidth + NAME_ROW_PAD);
}

export function companionReservedColumns(terminalColumns: number, speaking: boolean): number {
  if (!feature('BUDDY')) return 0;
  const companion = getCompanion();
  if (!companion || getGlobalConfig().companionMuted) return 0;
  if (terminalColumns < MIN_COLS_FOR_FULL_SPRITE) return 0;
  const nameWidth = stringWidth(companion.name);
  const bubble = speaking && !isFullscreenActive() ? BUBBLE_WIDTH : 0;
  return spriteColWidth(nameWidth) + SPRITE_PADDING_X + bubble;
}
export function CompanionSprite(): React.ReactNode {
  const reaction = useAppState(s => s.companionReaction);
  const petAt = useAppState(s => s.companionPetAt);
  const focused = useAppState(s => s.footerSelection === 'companion');
  const setAppState = useSetAppState();
  const {
    columns
  } = useTerminalSize();
  const [tick, setTick] = useState(0);
  const lastSpokeTick = useRef(0);
  
  
  const [{
    petStartTick,
    forPetAt
  }, setPetStart] = useState({
    petStartTick: 0,
    forPetAt: petAt
  });
  if (petAt !== forPetAt) {
    setPetStart({
      petStartTick: tick,
      forPetAt: petAt
    });
  }
  useEffect(() => {
    const timer = setInterval(setT => setT((t: number) => t + 1), TICK_MS, setTick);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!reaction) return;
    lastSpokeTick.current = tick;
    const timer = setTimeout(setA => setA((prev: AppState) => prev.companionReaction === undefined ? prev : {
      ...prev,
      companionReaction: undefined
    }), BUBBLE_SHOW * TICK_MS, setAppState);
    return () => clearTimeout(timer);
    
  }, [reaction, setAppState]);
  if (!feature('BUDDY')) return null;
  const companion = getCompanion();
  if (!companion || getGlobalConfig().companionMuted) return null;
  const color = RARITY_COLORS[companion.rarity];
  const colWidth = spriteColWidth(stringWidth(companion.name));
  const bubbleAge = reaction ? tick - lastSpokeTick.current : 0;
  const fading = reaction !== undefined && bubbleAge >= BUBBLE_SHOW - FADE_WINDOW;
  const petAge = petAt ? tick - petStartTick : Infinity;
  const petting = petAge * TICK_MS < PET_BURST_MS;

  
  
  if (columns < MIN_COLS_FOR_FULL_SPRITE) {
    const quip = reaction && reaction.length > NARROW_QUIP_CAP ? reaction.slice(0, NARROW_QUIP_CAP - 1) + '…' : reaction;
    const label = quip ? `"${quip}"` : focused ? ` ${companion.name} ` : companion.name;
    return <Box paddingX={1} alignSelf="flex-end">
        <Text>
          {petting && <Text color="autoAccept">{figures.heart} </Text>}
          <Text bold color={color}>
            {renderFace(companion)}
          </Text>{' '}
          <Text italic dimColor={!focused && !reaction} bold={focused} inverse={focused && !reaction} color={reaction ? fading ? 'inactive' : color : focused ? color : undefined}>
            {label}
          </Text>
        </Text>
      </Box>;
  }
  const frameCount = spriteFrameCount(companion.species);
  const heartFrame = petting ? PET_HEARTS[petAge % PET_HEARTS.length] : null;
  let spriteFrame: number;
  let blink = false;
  if (reaction || petting) {
    
    spriteFrame = tick % frameCount;
  } else {
    const step = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length]!;
    if (step === -1) {
      spriteFrame = 0;
      blink = true;
    } else {
      spriteFrame = step % frameCount;
    }
  }
  const body = renderSprite(companion, spriteFrame).map(line => blink ? line.replaceAll(companion.eye, '-') : line);
  const sprite = heartFrame ? [heartFrame, ...body] : body;

  
  
  
  
  
  const spriteColumn = <Box flexDirection="column" flexShrink={0} alignItems="center" width={colWidth}>
      {sprite.map((line, i) => <Text key={i} color={i === 0 && heartFrame ? 'autoAccept' : color}>
          {line}
        </Text>)}
      <Text italic bold={focused} dimColor={!focused} color={focused ? color : undefined} inverse={focused}>
        {focused ? ` ${companion.name} ` : companion.name}
      </Text>
    </Box>;
  if (!reaction) {
    return <Box paddingX={1}>{spriteColumn}</Box>;
  }

  
  
  
  
  
  if (isFullscreenActive()) {
    return <Box paddingX={1}>{spriteColumn}</Box>;
  }
  return <Box flexDirection="row" alignItems="flex-end" paddingX={1} flexShrink={0}>
      <SpeechBubble text={reaction} color={color} fading={fading} tail="right" />
      {spriteColumn}
    </Box>;
}

export function CompanionFloatingBubble() {
  const $ = _c(8);
  const reaction = useAppState(_temp);
  let t0;
  if ($[0] !== reaction) {
    t0 = {
      tick: 0,
      forReaction: reaction
    };
    $[0] = reaction;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  const [t1, setTick] = useState(t0);
  const {
    tick,
    forReaction
  } = t1;
  if (reaction !== forReaction) {
    setTick({
      tick: 0,
      forReaction: reaction
    });
  }
  let t2;
  let t3;
  if ($[2] !== reaction) {
    t2 = () => {
      if (!reaction) {
        return;
      }
      const timer = setInterval(_temp3, TICK_MS, setTick);
      return () => clearInterval(timer);
    };
    t3 = [reaction];
    $[2] = reaction;
    $[3] = t2;
    $[4] = t3;
  } else {
    t2 = $[3];
    t3 = $[4];
  }
  useEffect(t2, t3);
  if (!feature("BUDDY") || !reaction) {
    return null;
  }
  const companion = getCompanion();
  if (!companion || getGlobalConfig().companionMuted) {
    return null;
  }
  const t4 = tick >= BUBBLE_SHOW - FADE_WINDOW;
  let t5;
  if ($[5] !== reaction || $[6] !== t4) {
    t5 = <SpeechBubble text={reaction} color={RARITY_COLORS[companion.rarity]} fading={t4} tail="down" />;
    $[5] = reaction;
    $[6] = t4;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  return t5;
}
function _temp3(set) {
  return set(_temp2);
}
function _temp2(s_0) {
  return {
    ...s_0,
    tick: s_0.tick + 1
  };
}
function _temp(s) {
  return s.companionReaction;
}
