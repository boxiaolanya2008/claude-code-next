import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React from 'react';
import { Box, Text } from '../../ink.js';
import type { PastedContent } from '../../utils/config.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import type { OptionWithDescription } from './select.js';
import { SelectInputOption } from './select-input-option.js';
import { SelectOption } from './select-option.js';
import { useMultiSelectState } from './use-multi-select-state.js';
export type SelectMultiProps<T> = {
  readonly isDisabled?: boolean;
  readonly visibleOptionCount?: number;
  readonly options: OptionWithDescription<T>[];
  readonly defaultValue?: T[];
  readonly onCancel: () => void;
  readonly onChange?: (values: T[]) => void;
  readonly onFocus?: (value: T) => void;
  readonly focusValue?: T;
  

  readonly submitButtonText?: string;
  

  readonly onSubmit?: (values: T[]) => void;
  

  readonly hideIndexes?: boolean;
  

  readonly onDownFromLastItem?: () => void;
  

  readonly onUpFromFirstItem?: () => void;
  

  readonly initialFocusLast?: boolean;
  

  readonly onOpenEditor?: (currentValue: string, setValue: (value: string) => void) => void;
  readonly onImagePaste?: (base64Image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, sourcePath?: string) => void;
  readonly pastedContents?: Record<number, PastedContent>;
  readonly onRemoveImage?: (id: number) => void;
};
export function SelectMulti(t0) {
  const $ = _c(44);
  const {
    isDisabled: t1,
    visibleOptionCount: t2,
    options,
    defaultValue: t3,
    onCancel,
    onChange,
    onFocus,
    focusValue,
    submitButtonText,
    onSubmit,
    onDownFromLastItem,
    onUpFromFirstItem,
    initialFocusLast,
    onOpenEditor,
    hideIndexes: t4,
    onImagePaste,
    pastedContents,
    onRemoveImage
  } = t0;
  const isDisabled = t1 === undefined ? false : t1;
  const visibleOptionCount = t2 === undefined ? 5 : t2;
  let t5;
  if ($[0] !== t3) {
    t5 = t3 === undefined ? [] : t3;
    $[0] = t3;
    $[1] = t5;
  } else {
    t5 = $[1];
  }
  const defaultValue = t5;
  const hideIndexes = t4 === undefined ? false : t4;
  let t6;
  if ($[2] !== defaultValue || $[3] !== focusValue || $[4] !== hideIndexes || $[5] !== initialFocusLast || $[6] !== isDisabled || $[7] !== onCancel || $[8] !== onChange || $[9] !== onDownFromLastItem || $[10] !== onFocus || $[11] !== onSubmit || $[12] !== onUpFromFirstItem || $[13] !== options || $[14] !== submitButtonText || $[15] !== visibleOptionCount) {
    t6 = {
      isDisabled,
      visibleOptionCount,
      options,
      defaultValue,
      onChange,
      onCancel,
      onFocus,
      focusValue,
      submitButtonText,
      onSubmit,
      onDownFromLastItem,
      onUpFromFirstItem,
      initialFocusLast,
      hideIndexes
    };
    $[2] = defaultValue;
    $[3] = focusValue;
    $[4] = hideIndexes;
    $[5] = initialFocusLast;
    $[6] = isDisabled;
    $[7] = onCancel;
    $[8] = onChange;
    $[9] = onDownFromLastItem;
    $[10] = onFocus;
    $[11] = onSubmit;
    $[12] = onUpFromFirstItem;
    $[13] = options;
    $[14] = submitButtonText;
    $[15] = visibleOptionCount;
    $[16] = t6;
  } else {
    t6 = $[16];
  }
  const state = useMultiSelectState(t6);
  let T0;
  let T1;
  let t7;
  let t8;
  let t9;
  if ($[17] !== hideIndexes || $[18] !== isDisabled || $[19] !== onCancel || $[20] !== onImagePaste || $[21] !== onOpenEditor || $[22] !== onRemoveImage || $[23] !== options.length || $[24] !== pastedContents || $[25] !== state) {
    const maxIndexWidth = options.length.toString().length;
    T1 = Box;
    t9 = "column";
    T0 = Box;
    t7 = "column";
    t8 = state.visibleOptions.map((option, index) => {
      const isOptionFocused = !isDisabled && state.focusedValue === option.value && !state.isSubmitFocused;
      const isSelected = state.selectedValues.includes(option.value);
      const isFirstVisibleOption = option.index === state.visibleFromIndex;
      const isLastVisibleOption = option.index === state.visibleToIndex - 1;
      const areMoreOptionsBelow = state.visibleToIndex < options.length;
      const areMoreOptionsAbove = state.visibleFromIndex > 0;
      const i = state.visibleFromIndex + index + 1;
      if (option.type === "input") {
        const inputValue = state.inputValues.get(option.value) || "";
        return <Box key={String(option.value)} gap={1}><SelectInputOption option={option} isFocused={isOptionFocused} isSelected={false} shouldShowDownArrow={areMoreOptionsBelow && isLastVisibleOption} shouldShowUpArrow={areMoreOptionsAbove && isFirstVisibleOption} maxIndexWidth={maxIndexWidth} index={i} inputValue={inputValue} onInputChange={value => {
            state.updateInputValue(option.value, value);
          }} onSubmit={_temp} onExit={() => {
            onCancel();
          }} layout="compact" onOpenEditor={onOpenEditor} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage}><Text color={isSelected ? "success" : undefined}>[{isSelected ? figures.tick : " "}]{" "}</Text></SelectInputOption></Box>;
      }
      return <Box key={String(option.value)} gap={1}><SelectOption isFocused={isOptionFocused} isSelected={false} shouldShowDownArrow={areMoreOptionsBelow && isLastVisibleOption} shouldShowUpArrow={areMoreOptionsAbove && isFirstVisibleOption} description={option.description}>{!hideIndexes && <Text dimColor={true}>{`${i}.`.padEnd(maxIndexWidth)}</Text>}<Text color={isSelected ? "success" : undefined}>[{isSelected ? figures.tick : " "}]</Text><Text color={isOptionFocused ? "suggestion" : undefined}>{option.label}</Text></SelectOption></Box>;
    });
    $[17] = hideIndexes;
    $[18] = isDisabled;
    $[19] = onCancel;
    $[20] = onImagePaste;
    $[21] = onOpenEditor;
    $[22] = onRemoveImage;
    $[23] = options.length;
    $[24] = pastedContents;
    $[25] = state;
    $[26] = T0;
    $[27] = T1;
    $[28] = t7;
    $[29] = t8;
    $[30] = t9;
  } else {
    T0 = $[26];
    T1 = $[27];
    t7 = $[28];
    t8 = $[29];
    t9 = $[30];
  }
  let t10;
  if ($[31] !== T0 || $[32] !== t7 || $[33] !== t8) {
    t10 = <T0 flexDirection={t7}>{t8}</T0>;
    $[31] = T0;
    $[32] = t7;
    $[33] = t8;
    $[34] = t10;
  } else {
    t10 = $[34];
  }
  let t11;
  if ($[35] !== onSubmit || $[36] !== state.isSubmitFocused || $[37] !== submitButtonText) {
    t11 = submitButtonText && onSubmit && <Box marginTop={0} gap={1}>{state.isSubmitFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}<Box marginLeft={3}><Text color={state.isSubmitFocused ? "suggestion" : undefined} bold={true}>{submitButtonText}</Text></Box></Box>;
    $[35] = onSubmit;
    $[36] = state.isSubmitFocused;
    $[37] = submitButtonText;
    $[38] = t11;
  } else {
    t11 = $[38];
  }
  let t12;
  if ($[39] !== T1 || $[40] !== t10 || $[41] !== t11 || $[42] !== t9) {
    t12 = <T1 flexDirection={t9}>{t10}{t11}</T1>;
    $[39] = T1;
    $[40] = t10;
    $[41] = t11;
    $[42] = t9;
    $[43] = t12;
  } else {
    t12 = $[43];
  }
  return t12;
}
function _temp() {}
